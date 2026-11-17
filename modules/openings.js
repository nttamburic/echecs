// Module « Ouvertures » : répertoires d'ouverture, événements de maîtrise.
//
// Modèle de données (synchronisé comme les analyses, via store.js / sync.js) :
//   openingRepertoire / <id> : { name, color: 'w'|'b', root (FEN complète), edges: [Edge], createdAt }
//     Edge = { fenBefore (EPD), uci, san, fenAfter (EPD), disabled?, note?, auto? }
//       disabled : coup gardé mais ni entraîné ni compté dans la maîtrise (absent = actif)
//       note     : commentaire de l'utilisateur (texte libre)
//       auto     : ajouté par le remplissage automatique (peut être retiré en bloc)
//     Les champs optionnels sont absents des anciens répertoires : toujours les lire avec un défaut.
//     Le répertoire est un ensemble d'arêtes, pas un arbre imbriqué : deux chemins qui mènent à la
//     même position (transposition) se rejoignent simplement sur la même EPD.
//   openingEvents / <id> : { repId, epd, uci, correct, date, source: 'game'|'train', gameId?, ply? }
//     Un enregistrement par coup évalué. Pour une partie, l'id est gameId-ply-repId : recalculer
//     une partie réécrit les mêmes enregistrements au lieu de les compter deux fois.
import { Chess } from '../vendor/chess.js';
import { epd } from '../analysis.js';
import * as store from '../core/store.js';
import { review, startOfDay } from '../core/srs.js';

export const REP = 'openingRepertoire';
export const EVT = 'openingEvents';
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const REP_FILE = 'openings/repertoires.json';
const evtFile = (date) => `openings/events-${new Date(date).toISOString().slice(0, 7)}.json`;

// EPD → FEN complète, pour rejouer un coup avec chess.js.
export const fenOf = (e) => (e.split(' ').length >= 6 ? e : `${e} 0 1`);
const keyOf = (fenBefore, uci) => `${epd(fenBefore)}|${uci}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ------------------------------------------------------------------ fonctions pures sur un répertoire
export function newRepertoire({ name, color, root = START_FEN }) {
  return { id: 'r' + uid(), name: String(name || '').trim() || 'Répertoire', color: color === 'b' ? 'b' : 'w', root, edges: [], createdAt: Date.now() };
}

// Ajoute le coup move (SAN, UCI ou { from, to, promotion }) depuis fenBefore. Renvoie l'arête
// (existante ou nouvelle), ou null si le coup est illégal.
export function addMove(rep, fenBefore, move) {
  const c = new Chess(fenOf(fenBefore));
  let m = null;
  try {
    if (typeof move === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) m = c.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
    else m = c.move(move);
  } catch { m = null; }
  if (!m) return null;
  const uci = m.from + m.to + (m.promotion || '');
  const k = keyOf(fenBefore, uci);
  const old = rep.edges.find((e) => keyOf(e.fenBefore, e.uci) === k);
  if (old) return old;
  const edge = { fenBefore: epd(fenBefore), uci, san: m.san, fenAfter: epd(c.fen()) };
  rep.edges.push(edge);
  return edge;
}

// Ajoute une suite de coups (SAN ou UCI) depuis fen (par défaut la racine). Renvoie les arêtes, ou
// null au premier coup illégal (les coups précédents restent ajoutés).
export function addLine(rep, moves, fen = rep.root) {
  const out = [];
  let cur = epd(fen);
  for (const mv of moves) {
    const e = addMove(rep, cur, mv);
    if (!e) return null;
    out.push(e);
    cur = e.fenAfter;
  }
  return out;
}

// ------------------------------------------------------------------ import PGN (arbre complet)
// Ajoute à rep tous les coups d'un texte PGN : ligne principale, variantes et sous-variantes, pour
// une ou plusieurs parties. Un commentaire {…} devient la note du coup qui le précède (sans écraser
// une note existante) ; commentaires ;…, annotations $n, !?, numéros et résultats ignorés.
// Une partie qui part d'une autre position que la racine du répertoire est ignorée ; un coup
// illégal interrompt seulement la ligne où il se trouve.
export function importPgn(rep, text) {
  const out = { added: 0, games: 0, skipped: 0, notes: 0, errors: [] };
  const before = rep.edges.length;
  const games = String(text || '').replace(/\r/g, '').split(/\n(?=\s*\[Event\s)/);
  for (const g of games) {
    const fenTag = /\[FEN\s+"([^"]+)"\]/.exec(g);
    const body = g.replace(/^\s*\[[^\]]*\]\s*$/gm, ' ');
    const comments = [];
    const tokens = body
      .replace(/\{([^}]*)\}/g, (_, c) => ` \u0001${comments.push(c.replace(/\s+/g, ' ').trim()) - 1} `)
      .replace(/;[^\n]*/g, ' ')
      .replace(/\(/g, ' ( ').replace(/\)/g, ' ) ')
      .split(/\s+/).filter(Boolean);
    if (!tokens.some((t) => /^[a-hNBRQKO0]/.test(t))) continue;
    let lastEdge = null;
    if (fenTag && epd(fenTag[1]) !== epd(rep.root)) { out.skipped++; continue; }
    out.games++;
    let cur = { fen: epd(rep.root), prev: null, broken: false };
    const stack = [];
    for (let t of tokens) {
      if (t[0] === '\u0001') { const c = comments[+t.slice(1)]; if (c && lastEdge && !lastEdge.note) { lastEdge.note = c; out.notes++; } continue; }
      if (t === '(') { lastEdge = null; stack.push(cur); cur = { fen: cur.prev || cur.fen, prev: null, broken: cur.broken || !cur.prev }; continue; }
      if (t === ')') { lastEdge = null; if (stack.length) cur = stack.pop(); continue; }
      if (/^\$\d+$/.test(t) || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) continue;
      t = t.replace(/^\d+\.(\.\.)?/, '').replace(/[!?]+$/, '').replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O');
      if (!t || /^\.+$/.test(t) || /^\d+$/.test(t)) continue;
      if (cur.broken) continue;
      const e = addMove(rep, cur.fen, t);
      if (!e) { cur.broken = true; lastEdge = null; if (out.errors.length < 5) out.errors.push(t); continue; }
      lastEdge = e;
      cur.prev = cur.fen;
      cur.fen = e.fenAfter;
    }
  }
  out.added = rep.edges.length - before;
  return out;
}

// Un coup actif est entraîné et compté dans la maîtrise (voir Edge.disabled).
export const isActive = (e) => !e.disabled;

// Coups enregistrés depuis une position (EPD ou FEN).
export const childrenOf = (rep, fen) => { const p = epd(fen); return rep.edges.filter((e) => e.fenBefore === p); };

// Arêtes atteignables depuis la racine (parcours en largeur). Sert à la suppression et à l'entraînement.
// activeOnly : ne suit pas les coups désactivés (leur suite n'est alors atteinte que par transposition).
export function reachableEdges(rep, activeOnly = false) {
  const byFrom = new Map();
  for (const e of rep.edges) { if (!byFrom.has(e.fenBefore)) byFrom.set(e.fenBefore, []); byFrom.get(e.fenBefore).push(e); }
  const seen = new Set([epd(rep.root)]);
  const queue = [epd(rep.root)];
  const out = [];
  while (queue.length) {
    for (const e of byFrom.get(queue.shift()) || []) {
      if (activeOnly && !isActive(e)) continue;
      out.push(e);
      if (!seen.has(e.fenAfter)) { seen.add(e.fenAfter); queue.push(e.fenAfter); }
    }
  }
  return out;
}

// Supprime le coup uci joué depuis fenBefore, puis toutes les arêtes qui ne sont plus atteignables
// depuis la racine. Une position encore atteinte par une autre branche (transposition) garde ses
// coups. Renvoie les arêtes supprimées (le coup lui-même en premier), ou [] si le coup n'existe pas.
export function deleteMove(rep, fenBefore, uci) {
  const k = keyOf(fenBefore, uci);
  const i = rep.edges.findIndex((e) => keyOf(e.fenBefore, e.uci) === k);
  if (i < 0) return [];
  const [gone] = rep.edges.splice(i, 1);
  const keep = new Set(reachableEdges(rep));
  const pruned = rep.edges.filter((e) => !keep.has(e));
  rep.edges = rep.edges.filter((e) => keep.has(e));
  return [gone, ...pruned];
}

// Positions où c'est au tour de l'utilisateur (sa couleur), avec ses coups enregistrés.
// Par défaut seulement les coups actifs (entraînement, maîtrise) ; activeOnly = false : tous les coups
// du répertoire (parcours des parties, suggestions : un coup désactivé reste « dans le répertoire »).
export function userPositions(rep, activeOnly = true) {
  const m = new Map();
  for (const e of reachableEdges(rep, activeOnly)) {
    if (e.fenBefore.split(' ')[1] !== rep.color) continue;
    if (!m.has(e.fenBefore)) m.set(e.fenBefore, []);
    m.get(e.fenBefore).push(e);
  }
  return m;
}

// ------------------------------------------------------------------ stockage
export async function listRepertoires() {
  return (await store.all(REP)).map((r) => ({ ...r.data, id: r.id })).sort((a, b) => a.createdAt - b.createdAt);
}
export async function getRepertoire(id) { const d = await store.get(REP, id); return d ? { ...d, id } : null; }
export async function saveRepertoire(rep) {
  const { id, ...data } = rep;
  await store.put(REP, id, data, { file: REP_FILE });
  return rep;
}
export async function deleteRepertoire(id) {
  await store.remove(REP, id);
  for (const e of await listEvents()) if (e.repId === id) await store.remove(EVT, e.id);
}

export function eventId(ev) {
  return ev.source === 'game' && ev.gameId != null && ev.ply != null ? `g-${ev.gameId}-${ev.ply}-${ev.repId}` : 't-' + uid();
}
export async function addEvent(ev) {
  const date = ev.date || Date.now();
  const data = { repId: ev.repId, epd: epd(ev.epd), uci: ev.uci, correct: !!ev.correct, date, source: ev.source === 'game' ? 'game' : 'train' };
  if (data.source === 'game') { data.gameId = ev.gameId; data.ply = ev.ply; }
  const id = eventId(data);
  await store.put(EVT, id, data, { file: evtFile(date) });
  return id;
}
export async function listEvents() { return (await store.all(EVT)).map((r) => ({ ...r.data, id: r.id })); }

// ------------------------------------------------------------------ maîtrise
// Une « situation » = une position du répertoire où c'est au tour de l'utilisateur (sa couleur),
// rencontrée dans une partie réelle ou à l'entraînement. Elle est correcte si le coup joué fait
// partie des coups enregistrés à cette position (plusieurs coups peuvent être corrects).
// La justesse est réévaluée avec le répertoire actuel : ajouter un coup plus tard rend justes les
// parties où il avait été joué.
export const WINDOW_DAYS = 90;
export const MIN_SITUATIONS = 3;
export const THRESHOLD = 0.9;
export const STATUS = {
  new: { label: 'jamais revu', color: '#9b9893' },
  progress: { label: 'en cours', color: '#f7c045' },
  mastered: { label: 'maîtrisé', color: '#81b64c' },
  weak: { label: 'non maîtrisé', color: '#fa412d' },
  shared: { label: 'non compté (position partagée par deux répertoires avec des coups différents)', color: '#8fc3ff' },
};

export function statusOf(correct, total) {
  if (!total) return 'new';
  if (total < MIN_SITUATIONS) return 'progress';
  return correct / total >= THRESHOLD ? 'mastered' : 'weak';
}

// Positions couvertes par au moins deux répertoires de la même couleur avec des coups différents :
// rien n'y est compté. Renvoie un Set de « couleur|EPD ».
export function sharedConflicts(reps) {
  const seen = new Map();
  const out = new Set();
  for (const r of reps) {
    for (const [p, edges] of userPositions(r)) {
      const k = `${r.color}|${p}`;
      const moves = edges.map((e) => e.uci).sort().join(',');
      if (seen.has(k) && seen.get(k) !== moves) out.add(k);
      else seen.set(k, moves);
    }
  }
  return out;
}

// ------------------------------------------------------------------ reconnaissance de l'ouverture
// Livre d'ouvertures (openings.json, EPD → [ECO, nom]), le même que celui de l'analyse. Chargé par
// analyse.js au démarrage ; tant qu'il est vide, tous les écarts sont comptés (ancien comportement).
let BOOK = {};
export function setBook(b) { BOOK = b || {}; }

// Famille d'une ouverture : le nom avant « : » ou « , » (« Italian Game: Giuoco Piano » → « Italian Game »).
export const familyOf = (name) => String(name).split(/[:,]/)[0].trim();

// Familles d'ouverture traversées par le répertoire (la racine et chaque position atteinte).
export function repFamilies(rep) {
  const fams = new Set();
  const add = (p) => { const o = BOOK[p]; if (o && o.length) fams.add(familyOf(o[1])); };
  add(epd(rep.root));
  for (const e of reachableEdges(rep)) add(e.fenAfter);
  return fams;
}

// Famille de l'ouverture où mène le coup uci joué depuis la position p (EPD), ou null si la position
// obtenue n'a pas de nom dans le livre (coup hors théorie, ou position de théorie sans nom propre).
export function moveFamily(p, uci) {
  try {
    const c = new Chess(fenOf(p));
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    const o = BOOK[epd(c.fen())];
    return o && o.length ? familyOf(o[1]) : null;
  } catch { return null; }
}

// Un coup de partie réelle qui n'est pas dans le répertoire n'est une faute que s'il reste dans une
// ouverture du répertoire. S'il mène à une autre ouverture connue (d4 alors que le répertoire ne
// contient que des ouvertures 1.e4, l'Espagnole alors qu'il ne contient que l'Italienne), c'est un
// choix d'ouverture, pas une erreur : il n'est compté ni juste ni faux.
// fams : repFamilies(rep), calculé une fois par l'appelant.
export function otherOpening(fams, p, uci) {
  const fam = moveFamily(p, uci);
  return fam != null && !fams.has(fam);
}

// Maîtrise de chaque position où l'utilisateur joue dans rep : Map EPD → { correct, total, ratio, status, edges }.
// Les événements d'entraînement sont toujours comptés : la question y porte sur le répertoire.
export function computeMastery(rep, events, reps = [rep], now = Date.now()) {
  const conflicts = sharedConflicts(reps);
  const from = now - WINDOW_DAYS * 86400000;
  const out = new Map();
  let fams = null; // familles d'ouverture du répertoire, calculées au premier écart
  for (const [p, edges] of userPositions(rep)) {
    out.set(p, { correct: 0, total: 0, ratio: null, status: conflicts.has(`${rep.color}|${p}`) ? 'shared' : 'new', edges });
  }
  for (const ev of events) {
    if (ev.repId !== rep.id || ev.date < from || ev.date > now + 86400000) continue;
    const m = out.get(ev.epd);
    if (!m || m.status === 'shared') continue;
    const ok = childrenOf(rep, ev.epd).some((e) => e.uci === ev.uci); // un coup désactivé reste juste
    if (!ok && ev.source === 'game' && otherOpening(fams || (fams = repFamilies(rep)), ev.epd, ev.uci)) continue;
    m.total++;
    if (ok) m.correct++;
  }
  for (const m of out.values()) {
    if (m.status === 'shared') continue;
    m.ratio = m.total ? m.correct / m.total : null;
    m.status = statusOf(m.correct, m.total);
  }
  return out;
}

// Résumé pour la liste des répertoires.
export function masterySummary(mastery) {
  const s = { positions: 0, mastered: 0, weak: 0, progress: 0, new: 0, shared: 0 };
  for (const m of mastery.values()) { s.positions++; s[m.status]++; }
  return s;
}

// ------------------------------------------------------------------ répétition espacée
// Une carte par position où l'utilisateur joue (coups actifs). Son état n'est pas stocké : il est
// recalculé en rejouant dans l'ordre les événements déjà enregistrés (entraînement et parties
// réelles) avec review() de core/srs.js. La synchro des événements suffit donc.
//   - juste = 'good', faux (ou indice) = 'again' ;
//   - partie réelle : mêmes règles que la maîtrise (position partagée ou autre ouverture : ignoré) ;
//   - une bonne réponse avant l'échéance ne fait pas avancer la carte (pas d'intervalle gonflé par
//     plusieurs parties le même jour) ; une erreur la fait toujours reculer.
export const NEW_PER_DAY = () => {
  let v = null;
  try { v = localStorage.getItem('repNewPerDay'); } catch { /* stockage indisponible */ }
  return v == null ? 10 : Math.max(0, Number(v) || 0);
};

export function computeCards(rep, events, reps = [rep]) {
  const conflicts = sharedConflicts(reps);
  const out = new Map();
  for (const [p, edges] of userPositions(rep)) out.set(p, { epd: p, edges, card: null, first: null, shared: conflicts.has(`${rep.color}|${p}`) });
  let fams = null;
  const evs = events.filter((ev) => ev.repId === rep.id && out.has(ev.epd)).sort((a, b) => a.date - b.date);
  for (const ev of evs) {
    const c = out.get(ev.epd);
    const ok = childrenOf(rep, ev.epd).some((e) => e.uci === ev.uci);
    if (ev.source === 'game' && (c.shared || (!ok && otherOpening(fams || (fams = repFamilies(rep)), ev.epd, ev.uci)))) continue;
    const grade = ok ? 'good' : 'again';
    if (!c.card) { c.card = review(null, grade, ev.date); c.first = ev.date; continue; }
    if (grade === 'good' && c.card.due > ev.date) continue;
    c.card = review(c.card, grade, ev.date);
  }
  return out;
}

// Résumé : cartes dues, cartes jamais vues, nouvelles cartes déjà commencées aujourd'hui.
export function cardsSummary(cards, now = Date.now()) {
  const today = startOfDay(now) > now ? startOfDay(now) - 86400000 : startOfDay(now);
  const s = { due: 0, fresh: 0, newToday: 0, total: 0 };
  for (const c of cards.values()) {
    s.total++;
    if (!c.card) s.fresh++;
    else if (c.card.due <= now) s.due++;
    if (c.first != null && c.first >= today) s.newToday++;
  }
  return s;
}

// Chemin le plus court (arêtes) de from vers to dans rep, ou null.
export function pathTo(rep, from, to, activeOnly = false) {
  from = epd(from); to = epd(to);
  if (from === to) return [];
  const prev = new Map([[from, null]]);
  const q = [from];
  while (q.length) {
    const p = q.shift();
    for (const e of childrenOf(rep, p)) {
      if (activeOnly && !isActive(e)) continue;
      if (prev.has(e.fenAfter)) continue;
      prev.set(e.fenAfter, e);
      if (e.fenAfter === to) {
        const out = [];
        for (let x = e; x; x = prev.get(x.fenBefore)) out.unshift(x);
        return out;
      }
      q.push(e.fenAfter);
    }
  }
  return null;
}

// ------------------------------------------------------------------ suggestions d'enrichissement
// Une erreur récurrente (imprécision, erreur, occasion manquée, gaffe : classes de l'analyse) jouée
// par l'utilisateur dans une position que son répertoire ne couvre pas, juste après la sortie du
// répertoire (l'adversaire a joué un coup non prévu, ou le répertoire s'arrête), au moins 3 fois.
// games : [{ id, end, color, moves: [{ before (FEN), uci, san }], results: [{ cls, bestUci } | null] }]
export const ERROR_CLASSES = ['inaccuracy', 'mistake', 'miss', 'blunder'];
export const SUGGEST_MIN = 3;
const OUT_PLIES = 8; // demi-coups suivis après la sortie du répertoire
const MAX_PLY = 40;

export function findSuggestions(reps, games) {
  const acc = new Map();
  for (const g of games) {
    if (!g.moves.length) continue;
    for (const r of reps) {
      if (r.color !== g.color || epd(g.moves[0].before) !== epd(r.root)) continue;
      const cov = userPositions(r, false);
      let left = -1;
      for (let i = 0; i < g.moves.length && i <= MAX_PLY; i++) {
        const m = g.moves[i];
        const b = epd(m.before);
        const mine = b.split(' ')[1] === r.color;
        if (left < 0) {
          const inRep = childrenOf(r, b).some((e) => e.uci === m.uci);
          if (mine && cov.has(b)) { if (inRep) continue; break; } // écart de l'utilisateur : compté dans la maîtrise
          if (!mine && inRep) continue;
          left = i; // l'adversaire sort du répertoire, ou le répertoire s'arrête ici
        }
        if (i - left > OUT_PLIES) break;
        if (!mine || cov.has(b)) continue;
        const res = g.results[i];
        if (!res || !ERROR_CLASSES.includes(res.cls)) continue;
        const key = `${r.id}|${b}`;
        let s = acc.get(key);
        if (!s) { s = { rep: r, epd: b, errors: [], path: null, pathEnd: -1 }; acc.set(key, s); }
        s.errors.push({ gameId: g.id, end: g.end, uci: m.uci, san: m.san, cls: res.cls, bestUci: res.bestUci || null });
        if (g.end > s.pathEnd) {
          s.pathEnd = g.end;
          s.anchor = epd(g.moves[left].before); // dernière position du répertoire
          s.path = g.moves.slice(left, i).map((x) => ({ before: x.before, uci: x.uci, san: x.san }));
          s.line = g.moves.slice(0, i).map((x) => x.san);
        }
      }
    }
  }
  return [...acc.values()].filter((s) => s.errors.length >= SUGGEST_MIN)
    .sort((a, b) => b.errors.length - a.errors.length || b.pathEnd - a.pathEnd);
}

// Ajoute au répertoire les coups de la partie entre la sortie du répertoire et la position de la
// suggestion, pour qu'elle soit atteignable ; l'utilisateur joue ensuite le coup à ajouter.
export function applySuggestion(rep, s) {
  for (const m of s.path) if (!addMove(rep, m.before, m.uci)) return false;
  return true;
}

// ------------------------------------------------------------------ situations tirées des parties réelles
// Parcourt les parties chess.com des 90 derniers jours et enregistre un événement pour chaque coup
// de l'utilisateur joué depuis une position couverte par un de ses répertoires de la même couleur.
// Identifiant gameId-ply-repId : relancer le parcours n'ajoute rien de nouveau.
const parsed = new Map(); // id de partie → [{ before (EPD), uci }]
function movesOf(game) {
  if (parsed.has(game.id)) return parsed.get(game.id);
  let out = [];
  try {
    const c = new Chess();
    c.loadPgn(game.pgn);
    out = c.history({ verbose: true }).slice(0, 60).map((m) => ({ before: epd(m.before), uci: m.from + m.to + (m.promotion || '') }));
  } catch { out = []; }
  parsed.set(game.id, out);
  return out;
}

let scanning = null;
export function scanGames(games, user, now = Date.now()) {
  scanning = (scanning || Promise.resolve()).then(() => doScan(games, user, now)).catch(() => 0);
  return scanning;
}
async function doScan(games, user, now) {
  if (!user || !games || !games.length) return 0;
  const reps = await listRepertoires();
  if (!reps.length) return 0;
  const covered = new Map(reps.map((r) => [r.id, userPositions(r, false)]));
  const have = new Set((await store.all(EVT)).map((r) => r.id));
  const from = now - WINDOW_DAYS * 86400000;
  const me = user.toLowerCase();
  let added = 0;
  for (const g of games) {
    if (!g.end || g.end * 1000 < from || !g.pgn) continue;
    const color = (g.white && g.white.name || '').toLowerCase() === me ? 'w' : (g.black && g.black.name || '').toLowerCase() === me ? 'b' : null;
    if (!color) continue;
    const mine = reps.filter((r) => r.color === color);
    if (!mine.length) continue;
    const moves = movesOf(g);
    for (let ply = 0; ply < moves.length; ply++) {
      const m = moves[ply];
      if (m.before.split(' ')[1] !== color) continue;
      for (const r of mine) {
        const edges = covered.get(r.id).get(m.before);
        if (!edges) continue;
        const id = `g-${g.id}-${ply}-${r.id}`;
        if (have.has(id)) continue;
        await addEvent({ repId: r.id, epd: m.before, uci: m.uci, correct: edges.some((e) => e.uci === m.uci), date: g.end * 1000, source: 'game', gameId: g.id, ply });
        have.add(id);
        added++;
      }
    }
  }
  return added;
}

// ------------------------------------------------------------------ performance par position
// Pour chaque position du répertoire : nombre de parties récentes (WINDOW_DAYS jours, chess.com et
// Lichess) passées par là avec la couleur du répertoire, et leur résultat. sets : [{ games, user }].
// Renvoie Map EPD → { n, w, d, l, score } (score de 0 à 1 du point de vue de l'utilisateur).
export function gameScore(g, color) {
  const m = /\[Result "([^"]+)"\]/.exec(g.pgn || '');
  const r = m ? m[1] : g.result;
  if (r === '1-0') return color === 'w' ? 1 : 0;
  if (r === '0-1') return color === 'b' ? 1 : 0;
  if (r === '1/2-1/2') return 0.5;
  return null;
}
export function computePerformance(rep, sets, now = Date.now()) {
  const root = epd(rep.root);
  const pos = new Set([root, ...reachableEdges(rep).map((e) => e.fenAfter)]);
  const out = new Map();
  const from = now - WINDOW_DAYS * 86400000;
  const done = new Set();
  for (const { games, user } of sets) {
    if (!user || !games) continue;
    const me = user.toLowerCase();
    for (const g of games) {
      if (done.has(g.id) || !g.end || g.end * 1000 < from || !g.pgn) continue;
      const color = (g.white && g.white.name || '').toLowerCase() === me ? 'w' : (g.black && g.black.name || '').toLowerCase() === me ? 'b' : null;
      if (color !== rep.color) continue;
      const s = gameScore(g, color);
      if (s == null) continue;
      const moves = movesOf(g);
      if (!moves.length || moves[0].before !== root) continue;
      done.add(g.id);
      const seen = new Set(moves.map((m) => m.before).filter((p) => pos.has(p)));
      for (const p of seen) {
        let st = out.get(p);
        if (!st) { st = { n: 0, w: 0, d: 0, l: 0, score: 0 }; out.set(p, st); }
        st.n++;
        if (s === 1) st.w++; else if (s === 0) st.l++; else st.d++;
        st.score = (st.w + st.d / 2) / st.n;
      }
    }
  }
  return out;
}
