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
