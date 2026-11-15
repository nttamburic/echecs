// Récupération des parties TERMINÉES sur l'API publique chess.com (directement depuis le navigateur).
// Les mois passés ne changent plus : ils sont gardés en cache sur l'appareil.
import { fetchJson, sleep } from './ui.js';
import { cacheGet, cacheSet } from './store.js';

export const USER_RE = /^[A-Za-z0-9_-]{2,40}$/;

function slimGame(g, monthKey) {
  if (!g || g.rules !== 'chess' || !g.pgn || !g.end_time) return null;
  const res = /\[Result "([^"]+)"\]/.exec(g.pgn);
  if (!res || res[1] === '*') return null; // partie non terminée : jamais analysée
  return {
    id: g.uuid || (g.url || '').split('/').pop(),
    url: g.url,
    end: g.end_time,
    month: monthKey,
    timeClass: g.time_class,
    timeControl: g.time_control,
    rated: g.rated,
    white: { name: g.white.username, rating: g.white.rating, result: g.white.result },
    black: { name: g.black.username, rating: g.black.rating, result: g.black.result },
    result: res[1],
    pgn: g.pgn,
  };
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function archives(user) {
  if (!USER_RE.test(user)) throw new Error('Pseudo invalide');
  const { status, body } = await fetchJson(`https://api.chess.com/pub/player/${user.toLowerCase()}/games/archives`);
  if (status === 404) throw new Error('Pseudo introuvable sur chess.com');
  if (status !== 200 || !body) throw new Error(status === 0 ? 'Pas de connexion à chess.com' : 'chess.com ne répond pas (code ' + status + ')');
  return body.archives
    .map((u) => { const m = /\/games\/(\d{4})\/(\d{2})$/.exec(u); return m ? `${m[1]}-${m[2]}` : null; })
    .filter(Boolean);
}

export async function month(user, monthKey) {
  const key = `cc/${user.toLowerCase()}/${monthKey}`;
  const closed = monthKey < currentMonthKey();
  if (closed) {
    const c = await cacheGet(key).catch(() => null);
    if (c) return c;
  }
  const [y, m] = monthKey.split('-');
  let r;
  for (let attempt = 0; attempt < 4; attempt++) {
    r = await fetchJson(`https://api.chess.com/pub/player/${user.toLowerCase()}/games/${y}/${m}`, { timeout: 30000 });
    if (r.status !== 429 && r.status !== 0) break;
    await sleep(1500 * (attempt + 1));
  }
  if (r.status !== 200 || !r.body) throw new Error(`chess.com : mois ${monthKey} indisponible (code ${r.status})`);
  const list = (r.body.games || []).map((g) => slimGame(g, monthKey)).filter(Boolean);
  if (closed) await cacheSet(key, list).catch(() => {});
  return list;
}
