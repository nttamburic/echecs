// Synchronisation avec un dépôt GitHub privé (ex. moncompte/echecs-data), via l'API REST de GitHub.
// Chaque fichier du dépôt contient des enregistrements { col, id, data, updatedAt, deleted? }.
// Fusion enregistrement par enregistrement : la version la plus récente gagne.
// Le jeton (fine-grained, limité à ce seul dépôt) reste uniquement sur l'appareil (localStorage).
import * as store from './store.js';
import { local } from './ui.js';

const API = 'https://api.github.com';

export const cfg = {
  get owner() { return local.get('ghOwner', ''); },
  get repo() { return local.get('ghRepo', 'echecs-data'); },
  get token() { return local.get('ghToken', ''); },
  get configured() { return !!(this.owner && this.repo && this.token); },
};

export const state = { running: false, lastSync: Number(local.get('lastSync', 0)) || 0, error: null, listeners: new Set() };
function notify() { for (const f of state.listeners) { try { f(state); } catch { /* */ } } }
export function onSync(f) { state.listeners.add(f); f(state); return () => state.listeners.delete(f); }

// ------------------------------------------------------------------ base64 UTF-8
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function gh(path, { method = 'GET', body } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, ok: r.ok, body: j };
}

const repoPath = () => `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;

function explain(status, body) {
  if (status === 401) return 'Jeton GitHub refusé (expiré ou mal copié).';
  if (status === 403) return 'Jeton GitHub sans droit d\'écriture sur ce dépôt (« Contents : Read and write »).';
  if (status === 404) return `Dépôt ${cfg.owner}/${cfg.repo} introuvable (ou jeton sans accès à ce dépôt).`;
  if (status === 0) return 'Pas de connexion Internet.';
  return `GitHub : erreur ${status}${body && body.message ? ' (' + body.message + ')' : ''}`;
}

// Vérifie la configuration (bouton « Tester » des réglages).
export async function test() {
  if (!cfg.configured) return { ok: false, msg: 'Renseignez le propriétaire, le dépôt et le jeton.' };
  let r;
  try { r = await gh(repoPath()); } catch { return { ok: false, msg: 'Pas de connexion Internet.' }; }
  if (!r.ok) return { ok: false, msg: explain(r.status, r.body) };
  if (!r.body.private) return { ok: false, msg: `Le dépôt ${cfg.owner}/${cfg.repo} est PUBLIC : rendez-le privé (vos parties seraient visibles de tous).` };
  if (r.body.permissions && !r.body.permissions.push) return { ok: false, msg: explain(403) };
  return { ok: true, msg: `Connecté à ${r.body.full_name} (privé).` };
}

// ------------------------------------------------------------------ fusion
function parseFile(text) {
  try {
    const j = JSON.parse(text);
    return Array.isArray(j.records) ? j.records : [];
  } catch { return []; }
}

// Fusionne des enregistrements distants dans la base locale. Renvoie true si la version locale
// contient des données plus récentes (le fichier doit alors être réécrit).
async function mergeRemote(file, remoteRecs) {
  const localRecs = await store.recordsOfFile(file);
  const byKey = new Map(localRecs.map((r) => [r.key, r]));
  const toWrite = [];
  let localNewer = false;
  const seen = new Set();
  for (const rr of remoteRecs) {
    const key = `${rr.col}/${rr.id}`;
    seen.add(key);
    const lr = byKey.get(key) || await store.rawGet(key);
    if (!lr || (rr.updatedAt || 0) > (lr.updatedAt || 0)) toWrite.push({ key, col: rr.col, id: rr.id, data: rr.data ?? null, deleted: !!rr.deleted, updatedAt: rr.updatedAt || 0, file });
    else if ((lr.updatedAt || 0) > (rr.updatedAt || 0)) localNewer = true;
  }
  for (const lr of localRecs) if (!seen.has(lr.key)) localNewer = true;
  await store.rawPutMany(toWrite);
  return localNewer;
}

async function buildFile(file) {
  const recs = await store.recordsOfFile(file);
  recs.sort((a, b) => (a.key < b.key ? -1 : 1));
  return JSON.stringify({ version: 1, records: recs.map(({ col, id, data, updatedAt, deleted }) => (deleted ? { col, id, updatedAt, deleted: true } : { col, id, data, updatedAt })) });
}

async function fetchBlob(sha) {
  const r = await gh(`${repoPath()}/git/blobs/${sha}`);
  if (!r.ok) throw new Error(explain(r.status, r.body));
  return b64decode(r.body.content);
}

// ------------------------------------------------------------------ synchronisation complète
let pending = null;
export function syncNow() {
  if (!cfg.configured) return Promise.resolve(false);
  if (pending) return pending;
  pending = doSync().finally(() => { pending = null; });
  return pending;
}

async function doSync() {
  state.running = true; state.error = null; notify();
  try {
    const shas = (await store.metaGet('shas')) || {};
    const dirty = new Set((await store.metaGet('dirty')) || []);

    // 1) Ce qui a changé sur GitHub depuis la dernière fois.
    const tree = await gh(`${repoPath()}/git/trees/HEAD?recursive=1`);
    let remote = {};
    if (tree.ok) {
      for (const e of tree.body.tree || []) if (e.type === 'blob' && e.path.endsWith('.json')) remote[e.path] = e.sha;
    } else if (tree.status !== 409 && tree.status !== 404) throw new Error(explain(tree.status, tree.body));
    // 409 / 404 : dépôt encore vide.

    for (const [file, sha] of Object.entries(remote)) {
      if (shas[file] === sha) continue;
      const recs = parseFile(await fetchBlob(sha));
      if (await mergeRemote(file, recs)) dirty.add(file);
      shas[file] = sha;
      await store.metaSet('shas', shas);
    }
    // fichiers locaux jamais envoyés
    for (const r of await store.allRecords()) if (!remote[r.file]) dirty.add(r.file);

    // 2) Envoi des fichiers modifiés localement (un à la fois : chaque envoi est un commit).
    for (const file of [...dirty]) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const content = await buildFile(file);
        const body = { message: `Sync ${file}`, content: b64encode(content) };
        if (shas[file]) body.sha = shas[file];
        const r = await gh(`${repoPath()}/contents/${file.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', body });
        if (r.ok) { shas[file] = r.body.content.sha; break; }
        if (r.status === 409 || r.status === 422) {
          // Le fichier a changé sur GitHub entre-temps (autre appareil) : on relit, fusionne et réessaie.
          const cur = await gh(`${repoPath()}/contents/${file.split('/').map(encodeURIComponent).join('/')}`);
          if (cur.ok) {
            await mergeRemote(file, parseFile(await fetchBlob(cur.body.sha)));
            shas[file] = cur.body.sha;
          } else delete shas[file];
          continue;
        }
        throw new Error(explain(r.status, r.body));
      }
      dirty.delete(file);
      await store.metaSet('shas', shas);
      await store.metaSet('dirty', [...dirty]);
    }
    state.lastSync = Date.now();
    local.set('lastSync', String(state.lastSync));
    return true;
  } catch (e) {
    state.error = e.message || String(e);
    return false;
  } finally {
    state.running = false; notify();
  }
}

// ------------------------------------------------------------------ déclenchement automatique
let timer = null;
store.onChange((info) => {
  if (!info.local || !cfg.configured) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, 20000); // regroupe les modifications rapprochées
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && timer) { clearTimeout(timer); timer = null; syncNow(); }
  if (document.visibilityState === 'visible' && Date.now() - state.lastSync > 120000) syncNow();
});
setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 5 * 60000);
