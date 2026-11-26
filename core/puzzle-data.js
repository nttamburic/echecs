// Données du module Puzzles : chargement des packs hébergés sur Hugging Face.
//
// Les packs (générés par tools/puzzles/packs.mjs) sont des tableaux JSON compressés en gzip :
//   manifest.json            description de l'ensemble
//   theme/<thème>.json.gz    300 puzzles par tranche de 100 points, pour un thème
//   opening/<famille>.json.gz  puzzles d'une famille d'ouvertures (premier tag Lichess)
//
// Un pack n'est téléchargé qu'une fois : il est gardé en mémoire puis dans le Cache API. Ce cache
// porte un nom qui ne commence PAS par « echecs- » : sw.js supprime les caches de ce préfixe à chaque
// nouvelle version de l'appli, ce qui obligerait à tout retélécharger (et nous ferait buter sur les
// limites anonymes de Hugging Face).
//
// Un puzzle : { id, fen, moves: [uci…], rating, ratingDeviation, themes: [], gameUrl, openingTags: [] }.
// `fen` est la position AVANT le premier coup de l'adversaire : moves[0] est joué par l'adversaire,
// le joueur répond à partir de moves[1].

export const BASE_URL = 'https://huggingface.co/datasets/DeNyrho/chess-journey-puzzles/resolve/main/packs/';
export const CACHE_NAME = 'puzzles-packs-v1';

const env = {
  base: BASE_URL,
  fetch: (...a) => globalThis.fetch(...a),
  caches: () => (typeof caches !== 'undefined' ? caches : null),
};
// Pour les tests : remplace l'URL de base, fetch ou le Cache API.
export function configure(opts = {}) {
  if (opts.base) env.base = opts.base;
  if (opts.fetch) env.fetch = opts.fetch;
  if ('caches' in opts) env.caches = () => opts.caches;
  memo.clear();
}

const memo = new Map(); // chemin -> Promise du contenu (déduplique aussi les chargements simultanés)

async function gunzipJson(res) {
  const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

// Télécharge un fichier : cache d'abord (les packs ne changent pas), sinon réseau puis mise en cache.
// `fresh` : réseau d'abord, cache si hors ligne (utilisé pour le manifeste, qui peut évoluer).
async function fetchCached(rel, { fresh = false } = {}) {
  const url = env.base + rel;
  const cs = env.caches();
  let cache = null;
  try { cache = cs ? await cs.open(CACHE_NAME) : null; } catch { cache = null; }
  const fromCache = async () => (cache ? cache.match(url).catch(() => null) : null);
  if (!fresh) {
    const hit = await fromCache();
    if (hit) return hit;
  }
  try {
    const res = await env.fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (cache) cache.put(url, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await fromCache();
    if (hit) return hit;
    throw new Error(`Puzzles indisponibles (${rel}) : ${err.message}. Connectez-vous une première fois pour télécharger ce pack.`);
  }
}

function once(rel, loader) {
  if (!memo.has(rel)) {
    const p = loader().catch((e) => { memo.delete(rel); throw e; });
    memo.set(rel, p);
  }
  return memo.get(rel);
}

export const loadManifest = () => once('manifest.json', async () => (await fetchCached('manifest.json', { fresh: true })).json());

// kind : 'theme' | 'opening' ; name : le nom de l'entrée du manifeste (pas du fichier).
export async function loadPack(kind, name) {
  const m = await loadManifest();
  const entry = (m[kind] || []).find((e) => e.name === name);
  if (!entry) throw new Error(`Pack inconnu : ${kind}/${name}`);
  return once(entry.file, async () => gunzipJson(await fetchCached(entry.file)));
}

// ------------------------------------------------------------------ choix de puzzles

// Puzzles d'un pack dont le niveau est dans [elo - spread, elo + spread], hors `exclude` (ensemble d'id),
// dans un ordre aléatoire. Si la fenêtre est trop étroite pour fournir `n` puzzles, elle s'élargit.
export function pickByRating(pack, elo, { spread = 150, n = 20, exclude = new Set(), rnd = Math.random } = {}) {
  let s = spread;
  let pool = [];
  for (let i = 0; i < 12; i++) {
    pool = pack.filter((p) => !exclude.has(p.id) && Math.abs(p.rating - elo) <= s);
    if (pool.length >= n || s > 4000) break;
    s *= 1.6;
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

// Famille d'ouverture à partir d'un nom Lichess en clair (« Sicilian Defense » -> « Sicilian_Defense »),
// retrouvée parmi les familles du manifeste. Renvoie null si aucune ne correspond.
export function openingFamilyFor(manifest, openingName) {
  if (!openingName) return null;
  const tag = String(openingName).split(':')[0].trim().replace(/['’]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const names = (manifest.opening || []).map((e) => e.name);
  if (names.includes(tag)) return tag;
  // « Sicilian_Defense_Najdorf » -> on retire les mots de la fin jusqu'à trouver une famille.
  const parts = tag.split('_');
  while (parts.length > 1) {
    parts.pop();
    const t = parts.join('_');
    if (names.includes(t)) return t;
  }
  return null;
}
