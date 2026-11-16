// Accès à l'explorateur d'ouvertures de Lichess (bases Masters et Lichess), qui exige un jeton.
// Le jeton personnel (créé par l'utilisateur sur lichess.org, sans aucune permission cochée)
// reste uniquement sur l'appareil (localStorage), comme le jeton GitHub.
import { local } from './ui.js';

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

// Explorateur. db : 'masters' ou 'lichess'. opts (base Lichess) : { ratings: [1600, 1800], speeds: ['blitz', 'rapid'] }.
// Renvoie { white, draws, black, moves: [{ uci, san, white, draws, black, averageRating }], opening }.
const cache = new Map();
export async function explore(db, fen, { ratings, speeds, moves = 12 } = {}) {
  if (!lichessCfg.connected) { const e = new Error('Jeton Lichess requis (Paramètres → Connexion)'); e.code = 'auth'; throw e; }
  const q = new URLSearchParams({ fen, moves: String(moves), topGames: '0', recentGames: '0' });
  if (db === 'lichess') {
    if (ratings && ratings.length) q.set('ratings', ratings.join(','));
    if (speeds && speeds.length) q.set('speeds', speeds.join(','));
  }
  const url = `${EXPLORER}/${db}?${q}`;
  if (cache.has(url)) return cache.get(url);
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + lichessCfg.token } });
  if (r.status === 401) { const e = new Error('jeton Lichess refusé'); e.code = 'auth'; throw e; }
  if (r.status === 429) { const e = new Error('trop de requêtes, réessayez dans une minute'); e.code = 'rate'; throw e; }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  cache.set(url, j);
  return j;
}
