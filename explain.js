// Commentaires en français des coups et des variantes.
import { Chess } from './vendor/chess.js';
import { VALUES, materialGain, fmtScore, winPct } from './analysis.js';

const FR_LETTERS = { K: 'R', Q: 'D', R: 'T', B: 'F', N: 'C' };
export const frSan = (san) => san.replace(/[KQRBN]/g, (l) => FR_LETTERS[l]);

const NAMES = { p: 'pion', n: 'cavalier', b: 'fou', r: 'tour', q: 'dame', k: 'roi' };
const FEM = { r: true, q: true };
export const pieceName = (t) => NAMES[t];
const the = (t) => (FEM[t] ? 'la ' : 'le ') + NAMES[t];
const your = (t) => 'votre ' + NAMES[t];
const undefendedWord = (t) => (FEM[t] ? 'non défendue' : 'non défendu');

function playUci(c, u) {
  try { return c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { return null; }
}

// Pièces adverses attaquées par la pièce posée en `square` (dans la position fenAfter, camp `color`).
function attackedBy(fenAfter, square, color) {
  const parts = fenAfter.split(' ');
  parts[1] = color; parts[3] = '-';
  let c;
  try { c = new Chess(parts.join(' '), { skipValidation: true }); } catch { return []; }
  let moves = [];
  try { moves = c.moves({ square, verbose: true }); } catch { return []; }
  const seen = new Set();
  return moves.filter((m) => m.captured && !seen.has(m.to) && seen.add(m.to)).map((m) => ({ square: m.to, type: m.captured }));
}

function isDefended(chess, square, ownerColor) {
  try { return chess.attackers(square, ownerColor).length > 0; } catch { return true; }
}

function listNames(types) {
  const names = types.map(the);
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' et ' + names[names.length - 1];
}

// Décrit un coup (objet verbose chess.js) joué dans `before` (instance Chess AVANT le coup) et `after`.
export function describeMove(before, m, after, prev = null) {
  const bits = [];
  const opp = m.color === 'w' ? 'b' : 'w';
  if (m.san.includes('O-O-O')) bits.push('grand roque');
  else if (m.san.includes('O-O')) bits.push('petit roque');
  if (m.captured) {
    const recapture = prev && prev.captured && prev.to === m.to;
    let txt = (recapture ? 'reprend ' : 'prend ') + the(m.captured);
    if (!recapture && m.captured !== 'p' && !m.flags.includes('e') && !isDefended(before, m.to, opp)) txt += ' ' + undefendedWord(m.captured);
    if (m.flags.includes('e')) txt += ' en passant';
    bits.push(txt);
  }
  if (m.promotion) bits.push('promotion en ' + NAMES[m.promotion]);
  if (after.isCheckmate()) { bits.push('échec et mat !'); return bits.join(', '); }
  if (after.isStalemate()) { bits.push('pat (nulle)'); return bits.join(', '); }

  // Attaques créées par la pièce jouée : fourchette / attaque.
  const targets = attackedBy(after.fen(), m.to, m.color).filter((t) => {
    if (t.type === 'k') return true;
    if (VALUES[t.type] > VALUES[m.promotion || m.piece]) return true;
    return VALUES[t.type] >= 3 && !isDefended(after, t.square, opp);
  });
  targets.sort((a, b) => (b.type === 'k') - (a.type === 'k') || VALUES[b.type] - VALUES[a.type]);
  if (targets.length >= 2) {
    bits.push('fourchette sur ' + listNames(targets.map((t) => t.type)));
  } else {
    if (after.inCheck()) bits.push('échec');
    if (targets.length === 1 && targets[0].type !== 'k') bits.push('attaque ' + the(targets[0].type));
  }
  if (targets.length >= 2 && after.inCheck() && !bits.includes('échec')) bits.unshift('échec');

  // Pièce laissée en prise après le coup ? (pas lors d'un simple échange)
  const moved = m.promotion || m.piece;
  if (moved !== 'k' && !m.san.includes('#') && VALUES[moved] >= 3) {
    let atk = [];
    try { atk = after.attackers(m.to, opp); } catch {}
    if (atk.length) {
      const cheapest = Math.min(...atk.map((s) => VALUES[after.get(s).type] || 99));
      const risk = isDefended(after, m.to, m.color) ? VALUES[moved] - cheapest : VALUES[moved];
      const won = m.captured ? VALUES[m.captured] : 0;
      if (risk - won >= 2) bits.push(the(moved) + ' reste en prise');
    }
  }
  return bits.join(', ');
}

// Commente une variante (liste de coups UCI) depuis `fen`.
export function commentLine(fen, pv, maxPlies = 6) {
  const c = new Chess(fen);
  const out = [];
  let prev = null;
  for (const u of pv.slice(0, maxPlies)) {
    const before = new Chess(c.fen());
    const moveNo = c.moveNumber();
    const m = playUci(c, u);
    if (!m) break;
    out.push({ uci: u, san: frSan(m.san), color: m.color, moveNo, note: describeMove(before, m, c, prev), fenAfter: c.fen() });
    prev = m;
  }
  return out;
}

export function lineToText(items, withNotes = true) {
  return items.map((it, i) => {
    const num = it.color === 'w' ? `${it.moveNo}. ` : i === 0 ? `${it.moveNo}... ` : '';
    return num + it.san + (withNotes && it.note ? ` (${it.note})` : '');
  }).join(' ');
}

const TITLES = {
  brilliant: 'est un coup brillant !', great: 'est un très bon coup !', best: 'est le meilleur coup',
  excellent: 'est excellent', good: 'est un bon coup', book: 'est un coup de théorie',
  inaccuracy: 'est une imprécision', mistake: 'est une erreur', miss: 'est une occasion manquée', blunder: 'est une gaffe',
};

const pct = (x) => Math.round(x) + ' %';

// Construit l'explication d'un coup classé.
// r = résultat de classifyMove ; pos = analyse de la position avant ; color = camp qui a joué.
export function explainMove({ fenBefore, san, uci, color, r, pos, openingName, playerColor }) {
  const mine = playerColor ? playerColor === color : true;
  const side = color === 'w' ? 'des Blancs' : 'des Noirs';
  const oppSide = color === 'w' ? 'Les Noirs' : 'Les Blancs';
  const out = { title: `${frSan(san)} ${TITLES[r.cls] || ''}`, paras: [], best: null, refutation: null };
  const best = pos.lines[0];
  const bestItems = commentLine(fenBefore, best.pv, 8);
  const bestSan = bestItems[0] ? bestItems[0].san : best.pv[0];
  const playedItems = pos.played ? commentLine(fenBefore, pos.played.pv, 8) : [];
  const bad = ['inaccuracy', 'mistake', 'miss', 'blunder'].includes(r.cls);

  if (r.cls === 'book') {
    out.paras.push(openingName ? `Coup connu de la théorie : ${openingName}.` : 'Coup connu de la théorie des ouvertures.');
  } else if (r.cls === 'brilliant') {
    out.paras.push('Sacrifice correct : vous donnez du matériel, mais la suite le justifie.');
  } else if (r.cls === 'great') {
    out.paras.push(`C'était le seul bon coup : le 2e meilleur coup faisait perdre environ ${pct(r.gap)} de chances de gain.`);
  } else if (r.forced) {
    out.paras.push('Coup forcé : c\'était le seul coup légal.');
  }

  if (bad) {
    out.paras.push(`${mine ? 'Vos chances de gain' : 'Les chances de gain ' + side} passent de ${pct(r.winBefore)} à ${pct(r.winAfter)} (perte de ${r.loss.toFixed(1).replace('.', ',')} %).`);
    // Pourquoi le coup est mauvais : la réponse de l'adversaire.
    const ps = pos.played && pos.played.score;
    const oppMates = ps && ps.mate !== undefined && (color === 'w' ? ps.mate < 0 : ps.mate > 0);
    if (oppMates) {
      out.paras.push(`Ce coup permet ${color === 'w' ? 'aux Noirs' : 'aux Blancs'} de mater en ${Math.abs(ps.mate)}.`);
    } else if (playedItems[1]) {
      const reply = playedItems[1];
      const afterPlayed = playedItems[0].fenAfter;
      const oppGain = materialGain(afterPlayed, pos.played.pv.slice(1), 8);
      if (playedItems[0].note.includes('reste en prise')) {
        out.paras.push(`Après ${playedItems[0].san}, ${playedItems[0].note.split(', ').find((t) => t.includes('reste en prise'))}.`);
      }
      if (reply.note) out.paras.push(`${oppSide} répondent ${reply.san} : ${reply.note}.`);
      else out.paras.push(`${oppSide} répondent ${reply.san}.`);
      if (oppGain >= 2) out.paras.push(`${oppSide} gagnent ainsi environ ${oppGain} points de matériel.`);
    }
    out.refutation = { text: lineToText(playedItems.slice(0, 6)), items: playedItems.slice(0, 6) };
  }

  if (!r.isBest && r.cls !== 'book' && best.pv[0] !== uci && (bad || r.loss >= 0.3)) {
    const bm = best.score.mate !== undefined && (color === 'w' ? best.score.mate > 0 : best.score.mate < 0);
    let sentence = bad ? `Le meilleur coup était ${bestSan} (${fmtScore(best.score)}).` : `Le moteur préférait ${bestSan} (${fmtScore(best.score)}).`;
    if (bm) sentence += ` Il menait à un mat en ${Math.abs(best.score.mate)}.`;
    else {
      const g = materialGain(fenBefore, best.pv, 8);
      if (g >= 2) sentence += ` La suite gagne environ ${g} points de matériel.`;
      else if (bad) sentence += ` Il gardait ${pct(winPct(best.score, color))} de chances de gain.`;
    }
    out.paras.push(sentence);
    out.best = { san: bestSan, uci: best.pv[0], text: lineToText(bestItems), items: bestItems };
  } else if (!bad && r.cls !== 'book') {
    if (pos.lines[1]) {
      const alt = commentLine(fenBefore, pos.lines[1].pv, 1)[0];
      const altLoss = winPct(best.score, color) - winPct(pos.lines[1].score, color);
      if (alt && alt.uci !== uci && altLoss < 6) out.paras.push(`Autre bon coup possible : ${alt.san} (${fmtScore(pos.lines[1].score)}).`);
    }
    const line = commentLine(fenBefore, pos.played.pv, 8);
    if (line.length > 1) out.best = { san: line[0].san, uci, text: lineToText(line), items: line, isPlayed: true };
  }
  return out;
}

// ------------------------------------------------------------------ ouvertures
// Commentaire pédagogique d'un coup d'ouverture (répertoire, entraînement) : l'idée du coup en
// quelques mots, à partir de règles simples (développement, centre, roque, case f7/f2, clouage,
// fou libéré, fianchetto…), plus les faits tactiques de describeMove (prise, échec, attaque).
// Renvoie une phrase, ou '' si rien de sûr à dire. fenBefore : FEN (ou EPD) avant le coup.
const CENTER = ['d4', 'e4', 'd5', 'e5'];
const fileOf = (sq) => sq[0];
const rankOf = (sq) => +sq[1];
export function explainOpeningMove(fenBefore, uci) {
  const full = fenBefore.split(' ').length >= 6 ? fenBefore : `${fenBefore} 0 1`;
  let before, after, m;
  try { before = new Chess(full); after = new Chess(full); m = playUci(after, uci); } catch { return ''; }
  if (!m) return '';
  const me = m.color, opp = me === 'w' ? 'b' : 'w';
  const home = me === 'w' ? 1 : 8;
  const ideas = [];
  const add = (s) => { if (s && !ideas.includes(s)) ideas.push(s); };

  // faits tactiques (prise, échec, fourchette, attaque d'une pièce, pièce en prise)
  const tact = describeMove(new Chess(full), m, after);
  if (tact) for (const t of tact.split(', ')) add(t);

  if (m.san.startsWith('O-O')) add('met le roi à l’abri et rapproche la tour du centre');
  // centre
  if (m.piece === 'p' && CENTER.includes(m.to) && !m.captured) add('occupe le centre');
  else if (m.piece === 'p' && ['c', 'f'].includes(fileOf(m.to)) && Math.abs(rankOf(m.to) - home) >= 3) add('conteste le centre');
  // développement d'une pièce mineure depuis sa case de départ
  if ((m.piece === 'n' || m.piece === 'b') && rankOf(m.from) === home && !m.captured) add(`développe ${m.piece === 'n' ? 'un cavalier' : 'un fou'}`);
  // cases centrales contrôlées par la pièce jouée
  if (m.piece !== 'p' && m.piece !== 'k') {
    let ctl = [];
    try { ctl = CENTER.filter((sq) => after.attackers(sq, me).includes(m.to)); } catch { ctl = []; }
    if (ctl.length) add(`contrôle ${ctl.length > 1 ? 'les cases ' + ctl.slice(0, -1).join(', ') + ' et ' + ctl.at(-1) : 'la case ' + ctl[0]}`);
  }
  // pion qui contrôle une case centrale : prépare la poussée du pion central voisin (c3 → d4)
  if (m.piece === 'p' && !CENTER.includes(m.to)) {
    const fwd = me === 'w' ? 1 : -1;
    for (const df of [-1, 1]) {
      const sq = String.fromCharCode(m.to.charCodeAt(0) + df) + (rankOf(m.to) + fwd);
      if (!CENTER.includes(sq)) continue;
      const there = after.get(sq);
      if (there) { if (there.type === 'p' && there.color === me) add(`soutient le pion ${sq}`); continue; }
      // la poussée préparée : d2-d4 pour les Blancs, d7-d5 pour les Noirs
      const pusher = after.get(`${sq[0]}${me === 'w' ? 2 : 7}`);
      const target = rankOf(sq) === (me === 'w' ? 4 : 5);
      add(target && pusher && pusher.type === 'p' && pusher.color === me ? `prépare ${sq}` : `contrôle la case ${sq}`);
    }
  }
  // fou libéré par un coup de pion, fianchetto
  if (m.piece === 'p') {
    if (['g', 'b'].includes(fileOf(m.to)) && Math.abs(rankOf(m.to) - rankOf(m.from)) === 1 && rankOf(m.from) === (me === 'w' ? 2 : 7)) add('prépare le fianchetto du fou');
    else {
      const bishops = before.board().flat().filter((p) => p && p.type === 'b' && p.color === me && rankOf(p.square) === home);
      for (const b of bishops) {
        const n0 = bishopMoves(before, b.square, me);
        const n1 = bishopMoves(after, b.square, me);
        if (n0 === 0 && n1 > 0) { add('ouvre la diagonale du fou'); break; }
      }
    }
  }
  // préparation du roque : avant, une case entre roi et tour était occupée ; après, plus aucune
  const castleFree = (c, side) => (side === 'k' ? ['f', 'g'] : ['b', 'c', 'd']).every((f) => !c.get(`${f}${home}`));
  const rights = full.split(' ')[2];
  for (const side of ['k', 'q']) {
    const has = rights.includes(me === 'w' ? side.toUpperCase() : side);
    if (has && !m.san.startsWith('O-O') && !castleFree(before, side) && castleFree(after, side)) add(side === 'k' ? 'prépare le petit roque' : 'prépare le grand roque');
  }
  // point faible f7 / f2 visé par un fou ou la dame
  const weak = opp === 'b' ? 'f7' : 'f2';
  if ((m.piece === 'b' || m.piece === 'q') && after.get(weak) && after.get(weak).color === opp) {
    let hits = [];
    try { hits = after.attackers(weak, me); } catch { hits = []; }
    if (hits.includes(m.to)) add(`vise le point faible ${weak}`);
  }
  // clouage : la pièce longue jouée aligne une pièce adverse devant le roi ou la dame
  if (['b', 'r', 'q'].includes(m.piece)) {
    const pin = pinnedBy(after, m.to, me);
    if (pin) add(`cloue ${the(pin.type)} ${pin.behind === 'k' ? 'sur le roi' : 'sur la dame'}`);
  }
  // sortie précoce de la dame
  if (m.piece === 'q' && rankOf(m.from) === home && Math.abs(rankOf(m.to) - home) >= 2 && before.moveNumber() <= 4 && !m.captured) add('sortie précoce de la dame : elle risque d’être chassée');
  // pion qui avance loin sans autre idée : gain d'espace
  if (m.piece === 'p' && !ideas.length && Math.abs(rankOf(m.to) - home) >= 4) add('gagne de l’espace');

  if (!ideas.length) return '';
  const txt = ideas.slice(0, 3).join(', ');
  return txt[0].toUpperCase() + txt.slice(1) + '.';
}

// Nombre de cases où le fou en `sq` peut aller (pièces du camp `me` seulement comme obstacles).
function bishopMoves(chess, sq, me) {
  let n = 0;
  const f0 = sq.charCodeAt(0) - 97, r0 = +sq[1];
  for (const [df, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    for (let i = 1; i < 8; i++) {
      const f = f0 + df * i, r = r0 + dr * i;
      if (f < 0 || f > 7 || r < 1 || r > 8) break;
      const q = chess.get(String.fromCharCode(97 + f) + r);
      if (q && q.color === me) break;
      n++;
      if (q) break;
    }
  }
  return n;
}

// Pièce adverse clouée par la pièce longue posée en `sq` : { type, behind } ou null. Clouage
// seulement si la pièce clouée vaut moins que celle de derrière (roi, ou dame derrière une pièce).
function pinnedBy(chess, sq, me) {
  const p = chess.get(sq);
  if (!p) return null;
  const diag = [[1, 1], [1, -1], [-1, 1], [-1, -1]], line = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const dirs = p.type === 'b' ? diag : p.type === 'r' ? line : [...diag, ...line];
  const f0 = sq.charCodeAt(0) - 97, r0 = +sq[1];
  for (const [df, dr] of dirs) {
    let first = null;
    for (let i = 1; i < 8; i++) {
      const f = f0 + df * i, r = r0 + dr * i;
      if (f < 0 || f > 7 || r < 1 || r > 8) break;
      const q = chess.get(String.fromCharCode(97 + f) + r);
      if (!q) continue;
      if (!first) { if (q.color === me || q.type === 'k' || q.type === 'p') break; first = q; continue; }
      // une dame ne « cloue » utilement que sur le roi (sur la dame adverse, c'est un échange)
      if (q.color !== me && (q.type === 'k' || (q.type === 'q' && first.type !== 'q' && p.type !== 'q'))) return { type: first.type, behind: q.type };
      break;
    }
  }
  return null;
}
