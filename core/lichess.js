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
export async function setToken(token) {
  local.set('lichessToken', (token || '').trim());
  local.set('lichessUser', '');
  if (!lichessCfg.token) return { ok: false, msg: 'Collez d\'abord un jeton.' };
  try {
    const a = await fetch(`${LICHESS}/api/account`, { headers: { Authorization: 'Bearer ' + lichessCfg.token } });
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
// Renvoie { white, draws, black, moves: [{ uci, san, white, draws, black, averageRating }], opening }.
export async function explore(db, fen, { ratings, speeds, moves = 12, background = false } = {}) {
  if (!lichessCfg.connected) { const e = new Error('Jeton Lichess requis (Paramètres → Connexion)'); e.code = 'auth'; throw e; }
  const q = new URLSearchParams({ fen, moves: String(moves), topGames: '0', recentGames: '0' });
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
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + lichessCfg.token } });
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
// Parties Lichess terminées des `days` derniers jours, au format des parties chess.com
// ({ id: 'li-…', end (s), pgn, white/black: { name, rating, result } }). Gardées sur l'appareil ;
// seules les parties plus récentes que la dernière connue sont redemandées (au plus toutes les 10 min).
const LG_REFRESH = 10 * 60000;
function slimLichess(g) {
  if (!g || g.variant !== 'standard' || !g.pgn || !g.lastMoveAt || !g.players) return null;
  const res = /\[Result "([^"]+)"\]/.exec(g.pgn);
  if (!res || res[1] === '*') return null;
  const pl = (c) => {
    const p = g.players[c] || {};
    return { name: (p.user && p.user.name) || 'Anonyme', rating: p.rating, result: g.winner ? (g.winner === c ? 'win' : 'lose') : 'agreed' };
  };
  return { id: 'li-' + g.id, url: `${LICHESS}/${g.id}`, end: Math.floor(g.lastMoveAt / 1000), timeClass: g.speed, rated: g.rated,
    white: pl('white'), black: pl('black'), result: res[1], pgn: g.pgn, source: 'lichess' };
}
export async function lichessGames(user = lichessCfg.user, { days = 90, force = false } = {}) {
  if (!user) return [];
  const key = 'ligames|' + user.toLowerCase();
  let saved = null;
  try { saved = await store.cacheGet(key); } catch { /* base indisponible */ }
  saved = saved || { games: [], last: 0, fetchedAt: 0 };
  const from = Date.now() - days * 86400000;
  const keep = (list) => list.filter((g) => g.end * 1000 >= from);
  if (!force && Date.now() - saved.fetchedAt < LG_REFRESH) return keep(saved.games);
  const since = Math.max(from, saved.last ? saved.last * 1000 + 1 : 0);
  const q = new URLSearchParams({ since: String(since), pgnInJson: 'true', finished: 'true', max: '1000',
    perfType: 'ultraBullet,bullet,blitz,rapid,classical,correspondence' });
  const headers = { Accept: 'application/x-ndjson' };
  if (lichessCfg.token) headers.Authorization = 'Bearer ' + lichessCfg.token;
  const r = await fetch(`${LICHESS}/api/games/user/${encodeURIComponent(user)}?${q}`, { headers });
  if (r.status === 404) throw new Error(`Compte Lichess « ${user} » introuvable`);
  if (r.status === 429) throw new Error('Lichess limite les requêtes : réessayez dans une minute');
  if (!r.ok) throw new Error('Lichess : erreur ' + r.status);
  const fresh = (await r.text()).split('\n').filter((l) => l.trim()).map((l) => { try { return slimLichess(JSON.parse(l)); } catch { return null; } }).filter(Boolean);
  const byId = new Map(saved.games.map((g) => [g.id, g]));
  for (const g of fresh) byId.set(g.id, g);
  const games = keep([...byId.values()]).sort((a, b) => b.end - a.end);
  const out = { games, last: games.reduce((m, g) => Math.max(m, g.end), saved.last || 0), fetchedAt: Date.now() };
  try { await store.cacheSet(key, out); } catch { /* tant pis : on redemandera */ }
  return games;
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
  const r = await fetch(url + '?comments=true&variations=true', { headers });
  if (r.status === 404 || r.status === 403 || r.status === 401) throw new Error('Étude introuvable ou privée (seules les études publiques ou non répertoriées sont lisibles)');
  if (!r.ok) throw new Error('Lichess : erreur ' + r.status);
  return r.text();
}
