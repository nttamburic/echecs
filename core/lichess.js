// Accès à l'explorateur d'ouvertures de Lichess (bases Masters et Lichess), qui exige un jeton.
// Le jeton personnel (créé par l'utilisateur sur lichess.org, sans aucune permission cochée)
// reste uniquement sur l'appareil (localStorage), comme le jeton GitHub.
import { local } from './ui.js';
import * as store from './store.js';

const LICHESS = 'https://lichess.org';
const EXPLORER = 'https://explorer.lichess.ovh';

export const lichessCfg = {
  get token() { return local.get('lichessToken', ''); },
  get user() { return local.get('lichessUser', ''); },
  get connected() { return !!this.token; },
};

// Enregistre le jeton et le vérifie : renvoie { ok, msg }.
// fetch qui, sans réseau, renvoie un message français plutôt que « Failed to fetch ».
async function lfetch(url, init) {
  try { return await fetch(url, init); } catch { const e = new Error('Pas de connexion Internet'); e.code = 'offline'; throw e; }
}

export async function setToken(token) {
  local.set('lichessToken', (token || '').trim());
  local.set('lichessUser', '');
  if (!lichessCfg.token) return { ok: false, msg: 'Collez d\'abord un jeton.' };
  try {
    const a = await lfetch(`${LICHESS}/api/account`, { headers: { Authorization: 'Bearer ' + lichessCfg.token } });
    if (a.status === 401) return { ok: false, msg: 'Jeton refusé par Lichess (invalide ou expiré).' };
    if (a.ok) local.set('lichessUser', (await a.json()).username || '');
    cache.clear();
    await explore('masters', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { moves: 1 });
    return { ok: true, msg: `Connecté à Lichess${lichessCfg.user ? ' (' + lichessCfg.user + ')' : ''}. L'explorateur répond.` };
  } catch (e) { return { ok: false, msg: 'Explorateur inaccessible : ' + e.message }; }
}

export function forgetToken() { local.set('lichessToken', ''); local.set('lichessUser', ''); cache.clear(); }

// ------------------------------------------------------------------ explorateur
// Filtres de la base Lichess (réglés dans la roue de l'éditeur d'ouvertures).
function readJson(k, def) { try { const v = JSON.parse(local.get(k, '')); return Array.isArray(v) && v.length ? v : def; } catch { return def; } }
export const expRatings = () => readJson('expRatings', [1400, 1600, 1800, 2000]);
export const expSpeeds = () => readJson('expSpeeds', ['blitz', 'rapid', 'classical']);

// Cache à deux niveaux : mémoire (la séance) et IndexedDB (30 jours, survit au rechargement).
// Les statistiques de l'explorateur bougent peu : un mois de retard ne change pas les fréquences.
const cache = new Map();
const inflight = new Map();
const TTL = 30 * 86400000;
const cacheKey = (url) => 'lx|' + url;

// File d'attente : une requête à la fois, espacées d'au moins GAP ms. Les requêtes interactives
// (éditeur) passent avant les requêtes de fond (couverture, préchargement). Après un 429, plus
// rien ne part pendant PAUSE ms.
const GAP = 1000;
const PAUSE = 60000;
const queue = { hi: [], lo: [], busy: false, last: 0, pauseUntil: 0 };
function schedule(job, background) {
  return new Promise((resolve, reject) => {
    (background ? queue.lo : queue.hi).push({ job, resolve, reject });
    pump();
  });
}
async function pump() {
  if (queue.busy) return;
  const item = queue.hi.shift() || queue.lo.shift();
  if (!item) return;
  queue.busy = true;
  const wait = Math.max(queue.last + GAP, queue.pauseUntil) - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  queue.last = Date.now();
  try { item.resolve(await item.job()); } catch (e) { item.reject(e); }
  queue.busy = false;
  pump();
}
export const explorerPaused = () => Math.max(0, queue.pauseUntil - Date.now());

// Explorateur. db : 'masters' ou 'lichess'. opts (base Lichess) : { ratings: [1600, 1800], speeds: ['blitz', 'rapid'] }.
// background : requête de fond (passe après les requêtes interactives ; après un 429 elle attend la
// fin de la pause et réessaie une fois au lieu d'échouer).
// topGames : nombre de parties de référence demandées (base Masters).
// Renvoie { white, draws, black, moves: [{ uci, san, white, draws, black, averageRating }], opening, topGames }.
export async function explore(db, fen, { ratings, speeds, moves = 12, topGames = 0, background = false } = {}) {
  if (!lichessCfg.connected) { const e = new Error('Jeton Lichess requis (Paramètres → Connexion)'); e.code = 'auth'; throw e; }
  const q = new URLSearchParams({ fen, moves: String(moves), topGames: String(topGames), recentGames: '0' });
  if (db === 'lichess') {
    if (ratings && ratings.length) q.set('ratings', ratings.join(','));
    if (speeds && speeds.length) q.set('speeds', speeds.join(','));
  }
  const url = `${EXPLORER}/${db}?${q}`;
  if (cache.has(url)) return cache.get(url);
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    try {
      const hit = await store.cacheGet(cacheKey(url));
      if (hit && hit.t > Date.now() - TTL) { cache.set(url, hit.j); return hit.j; }
    } catch { /* stockage indisponible : on interroge le réseau */ }
    const get = () => schedule(async () => {
      const r = await lfetch(url, { headers: { Authorization: 'Bearer ' + lichessCfg.token } });
      if (r.status === 429) queue.pauseUntil = Date.now() + PAUSE;
      return r;
    }, background);
    let r = await get();
    if (r.status === 429 && background) r = await get();
    if (r.status === 401) { const e = new Error('jeton Lichess refusé'); e.code = 'auth'; throw e; }
    if (r.status === 429) { const e = new Error('trop de requêtes, réessayez dans une minute'); e.code = 'rate'; throw e; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    cache.set(url, j);
    store.cacheSet(cacheKey(url), { t: Date.now(), j }).catch(() => {});
    return j;
  })();
  inflight.set(url, p);
  try { return await p; } finally { inflight.delete(url); }
}

// Fréquence des coups joués depuis fen, au niveau de l'utilisateur (base Lichess avec ses filtres),
// ou chez les maîtres si la base Lichess a trop peu de parties. Renvoie
// { source: 'lichess'|'masters', total, moves: [{ uci, san, n, p }] } (p entre 0 et 1, trié par p
// décroissant), ou null sans jeton, hors ligne, ou si la position n'a presque jamais été jouée.
export const MIN_GAMES = 20;
export async function moveFrequencies(fen, { background = false } = {}) {
  if (!lichessCfg.connected) return null;
  const shape = (j, source) => {
    const moves = (j.moves || []).map((m) => ({ uci: m.uci, san: m.san, n: m.white + m.draws + m.black }));
    const total = moves.reduce((s, m) => s + m.n, 0);
    if (total < MIN_GAMES) return null;
    return { source, total, moves: moves.map((m) => ({ ...m, p: m.n / total })).sort((a, b) => b.p - a.p) };
  };
  try {
    const li = shape(await explore('lichess', fen, { ratings: expRatings(), speeds: expSpeeds(), background }), 'lichess');
    if (li) return li;
    return shape(await explore('masters', fen, { background }), 'masters');
  } catch { return null; }
}

// ------------------------------------------------------------------ parties de l'utilisateur
// Parties standard terminées contre des humains, au format des parties chess.com
// ({ id: 'li-…', end (s), pgn, white/black: { name, rating, result }, source: 'lichess' }). Gardées sur
// l'appareil ; ensuite seules les parties récentes sont redemandées (au plus toutes les 10 min).
export const PERIODES_LICHESS = Object.freeze([90, 180]);
export const MAX_PARTIES_LICHESS = 1000;
const LG_REFRESH = 10 * 60000;
const JOUR = 86400000;
const RECOUVREMENT = 7 * JOUR; // `since` porte sur le début : on recouvre pour les parties finies tard
const INACHEVEES = ['created', 'started', 'aborted', 'noStart', 'unknownFinish'];
const CORRESPONDANCE = 'daily'; // même notion que « Par jour » sur chess.com

// Codes de résultat de chess.com, que le reste de l'application comprend. Lichess ne détaille pas la
// nulle « draw » (accord, répétition, 50 coups ou matériel) : « nulle », sans motif.
const DEFAITES = { mate: 'checkmated', resign: 'resigned', outoftime: 'timeout', timeout: 'abandoned' };
function resultatDe(g, camp) {
  if (g.winner) return g.winner === camp ? 'win' : DEFAITES[g.status] || 'lose';
  return g.status === 'stalemate' ? 'stalemate' : g.status === 'outoftime' ? 'timevsinsufficient' : g.status === 'insufficientMaterialClaim' ? 'insufficient' : 'nulle';
}

export function slimLichess(g) {
  if (!g || g.variant !== 'standard' || !g.pgn || !g.lastMoveAt || !g.players || INACHEVEES.includes(g.status)) return null;
  const res = /\[Result "([^"]+)"\]/.exec(g.pgn);
  if (!res || res[1] === '*') return null;
  const { white, black } = g.players;
  // ni ordinateur, ni anonyme, ni robot
  if ([white, black].some((p) => !p?.user?.name || p.aiLevel || p.user.title === 'BOT')) return null;
  const pl = (camp) => ({ name: g.players[camp].user.name, rating: g.players[camp].rating, result: resultatDe(g, camp) });
  const out = {
    id: 'li-' + g.id, url: `${LICHESS}/${g.id}`, end: Math.floor(g.lastMoveAt / 1000),
    timeClass: g.speed === 'correspondence' ? CORRESPONDANCE : g.speed, rated: g.rated,
    white: pl('white'), black: pl('black'), result: res[1], pgn: g.pgn, source: 'lichess',
  };
  // En « berserk », un joueur part avec la moitié du temps : les durées calculées seraient fausses.
  if (white.berserk || black.berserk) out.timeControl = '-';
  else if (g.clock) out.timeControl = g.clock.increment ? `${g.clock.initial}+${g.clock.increment}` : String(g.clock.initial);
  else if (g.daysPerTurn) out.timeControl = `1/${g.daysPerTurn * 86400}`;
  return out;
}

const cle = (user) => 'ligames2|' + user.toLowerCase();
const vide = () => ({ games: [], depuis: null, fetchedAt: 0, limite: false });
const recentes = (list, days, now = Date.now()) => list.filter((g) => g.end * 1000 >= now - days * JOUR);
async function lireCache(user) {
  try { return (await store.cacheGet(cle(user))) || vide(); } catch { return vide(); } // base indisponible
}

// Parties déjà sur l'appareil, sans réseau.
export async function lichessEnCache(user, { days = 90 } = {}) {
  return user ? recentes((await lireCache(user)).games, days) : [];
}

async function demander(user, since) {
  const q = new URLSearchParams({ since: String(Math.floor(since)), pgnInJson: 'true', clocks: 'true', finished: 'true',
    max: String(MAX_PARTIES_LICHESS), perfType: 'ultraBullet,bullet,blitz,rapid,classical,correspondence' });
  const headers = { Accept: 'application/x-ndjson' };
  if (lichessCfg.token) headers.Authorization = 'Bearer ' + lichessCfg.token;
  const r = await lfetch(`${LICHESS}/api/games/user/${encodeURIComponent(user)}?${q}`, { headers });
  if (r.status === 404) {
    // Lichess répond aussi 404 quand il refuse la demande : on vérifie que le compte existe.
    const compte = await lfetch(`${LICHESS}/api/user/${encodeURIComponent(user)}`).catch(() => null);
    throw new Error(compte?.ok ? 'Lichess a refusé la demande de parties (code 404) alors que le compte existe' : `Compte Lichess « ${user} » introuvable`);
  }
  if (r.status === 429) throw new Error('Lichess limite les requêtes : réessayez dans une minute');
  if (!r.ok) throw new Error('Lichess : erreur ' + r.status);
  return (await r.text()).split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

async function recuperer(user, days, force) {
  const saved = await lireCache(user);
  const now = Date.now();
  const from = now - days * JOUR;
  // une période plus longue qu'avant : on redemande toute la période
  const couvert = saved.depuis != null && saved.depuis <= from + JOUR;
  if (couvert && !force && now - saved.fetchedAt < LG_REFRESH) return { games: recentes(saved.games, days), limite: saved.limite };
  const since = couvert ? Math.max(from, saved.fetchedAt - RECOUVREMENT) : from;
  const recues = await demander(user, since);
  const byId = new Map(saved.games.map((g) => [g.id, g]));
  for (const g of recues.map(slimLichess).filter(Boolean)) byId.set(g.id, g);
  const garde = Math.max(...PERIODES_LICHESS);
  const games = recentes([...byId.values()], garde).sort((a, b) => b.end - a.end);
  // demande complète tronquée à MAX parties : seules les plus récentes sont là
  const limite = recues.length >= MAX_PARTIES_LICHESS || (couvert && saved.limite);
  const out = { games, depuis: couvert ? Math.max(saved.depuis, now - garde * JOUR) : from, fetchedAt: now, limite };
  try { await store.cacheSet(cle(user), out); } catch { /* tant pis : on redemandera */ }
  return { games: recentes(games, days), limite };
}

// → { games, limite } ; une seule demande à la fois pour les mêmes réglages.
const enCours = new Map();
export function importerLichess(user, { days = 90, force = false } = {}) {
  if (!user) return Promise.resolve({ games: [], limite: false });
  const k = `${user.toLowerCase()}|${days}|${force}`;
  if (!enCours.has(k)) enCours.set(k, recuperer(user, days, force).finally(() => enCours.delete(k)));
  return enCours.get(k);
}
export async function lichessGames(user = lichessCfg.user, options = {}) {
  return (await importerLichess(user, options)).games;
}

// ------------------------------------------------------------------ études
// Lien d'étude (ou d'un chapitre) → PGN de tous ses chapitres (ou du seul chapitre).
export function studyIds(link) {
  const m = /(?:lichess\.org\/study\/|^)([A-Za-z0-9]{8})(?:\/([A-Za-z0-9]{8}))?(?:[/?#]|$)/.exec((link || '').trim());
  return m ? { study: m[1], chapter: m[2] || null } : null;
}
export async function studyPgn(link) {
  const ids = studyIds(link);
  if (!ids) throw new Error('Lien d\'étude Lichess non reconnu (ex. https://lichess.org/study/AbCdEfGh)');
  const url = ids.chapter ? `${LICHESS}/api/study/${ids.study}/${ids.chapter}.pgn` : `${LICHESS}/api/study/${ids.study}.pgn`;
  const headers = lichessCfg.token ? { Authorization: 'Bearer ' + lichessCfg.token } : {};
  const r = await lfetch(url + '?comments=true&variations=true', { headers });
  if (r.status === 404 || r.status === 403 || r.status === 401) throw new Error('Étude introuvable ou privée (seules les études publiques ou non répertoriées sont lisibles)');
  if (!r.ok) throw new Error('Lichess : erreur ' + r.status);
  return r.text();
}

// ------------------------------------------------------------------ parties de maîtres
// PGN d'une partie de la base Masters (id donné par topGames), gardé sur l'appareil.
export async function masterPgn(id) {
  if (!/^[A-Za-z0-9]{4,16}$/.test(id)) throw new Error('Identifiant de partie invalide');
  const key = 'mpgn|' + id;
  try { const hit = await store.cacheGet(key); if (hit) return hit; } catch { /* stockage indisponible */ }
  if (!lichessCfg.connected) { const e = new Error('Jeton Lichess requis (Paramètres → Connexion)'); e.code = 'auth'; throw e; }
  const r = await schedule(() => fetch(`${EXPLORER}/masters/pgn/${id}`, { headers: { Authorization: 'Bearer ' + lichessCfg.token } }), false);
  if (r.status === 404) throw new Error('Partie introuvable dans la base Masters');
  if (r.status === 429) { queue.pauseUntil = Date.now() + PAUSE; throw new Error('trop de requêtes, réessayez dans une minute'); }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const pgn = await r.text();
  store.cacheSet(key, pgn).catch(() => {});
  return pgn;
}
