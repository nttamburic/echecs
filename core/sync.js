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

export const state = { running: false, lastSync: Number(local.get('lastSync', 0)) || 0, error: null, conflicts: [], listeners: new Set() };
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
  let r;
  try { r = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  }); } catch (e) { e.network = true; throw e; }
  const j = await r.json().catch(() => null);
  return { status: r.status, ok: r.ok, body: j };
}

const repoPath = () => `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;

function explain(status, body) {
  if ((status === 403 || status === 429) && (status === 429 || /rate limit|abuse|secondary/i.test((body && body.message) || ''))) return 'GitHub limite temporairement les requêtes : la synchronisation reprendra d\'elle-même dans quelques minutes.';
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

// Seuls les répertoires peuvent entrer en conflit (notes comprises : elles sont dans les arêtes).
// Parties et analyses sont en ajout seul : la version la plus récente gagne sans discussion.
const CONFLICT_COLS = new Set(['openingRepertoire']);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Union de deux répertoires : toutes les arêtes des deux côtés ; pour une arête présente des deux
// côtés, la version de cet appareil gagne, sauf si elle n'a pas de note.
export function mergeRepertoires(mine, theirs) {
  const key = (e) => `${e.fenBefore}|${e.uci}`;
  const byKey = new Map(mine.edges.map((e) => [key(e), e]));
  const theirsByKey = new Map(theirs.edges.map((e) => [key(e), e]));
  const edges = mine.edges.map((e) => {
    const o = theirsByKey.get(key(e));
    return o && !e.note && o.note ? { ...e, note: o.note } : e;
  });
  for (const e of theirs.edges) if (!byKey.has(key(e))) edges.push(e);
  return { ...theirs, ...mine, edges };
}

// Fusionne des enregistrements distants dans la base locale. Renvoie true si la version locale
// contient des données plus récentes (le fichier doit alors être réécrit). Un répertoire modifié
// des deux côtés depuis la dernière synchronisation n'est pas écrasé : il part en conflit.
async function mergeRemote(file, remoteRecs, since = 0) {
  const localRecs = await store.recordsOfFile(file);
  const byKey = new Map(localRecs.map((r) => [r.key, r]));
  const toWrite = [];
  let localNewer = false;
  const seen = new Set();
  const conflicts = (await store.metaGet('conflicts')) || {};
  let held = false;
  for (const rr of remoteRecs) {
    const key = `${rr.col}/${rr.id}`;
    seen.add(key);
    const lr = byKey.get(key) || await store.rawGet(key);
    const rt = rr.updatedAt || 0, lt = lr ? lr.updatedAt || 0 : 0;
    const open = conflicts[key];
    const clash = lr && !lr.deleted && !rr.deleted && CONFLICT_COLS.has(rr.col) && !same(lr.data, rr.data)
      && (open || (since > 0 && lt > since && rt > since));
    if (clash) {
      conflicts[key] = { key, col: rr.col, id: rr.id, local: lr.data, remote: rr.data, remoteAt: rt, localAt: lt, file };
      held = true; localNewer = true;
    } else if (!lr || rt > lt) toWrite.push({ key, col: rr.col, id: rr.id, data: rr.data ?? null, deleted: !!rr.deleted, updatedAt: rt, file });
    else if (lt > rt) localNewer = true;
  }
  for (const lr of localRecs) if (!seen.has(lr.key)) localNewer = true;
  // Une saisie faite pendant la fusion n'est pas écrasée : on recommence avec les données à jour.
  if (await store.rawPutMany(toWrite)) return mergeRemote(file, remoteRecs, since);
  if (held) { await store.metaSet('conflicts', conflicts); state.conflicts = Object.values(conflicts); }
  return localNewer;
}

// Résolution d'un conflit : 'local' (garder cet appareil), 'remote' (garder l'autre) ou 'merge'.
export async function resolveConflict(key, choice) {
  const conflicts = (await store.metaGet('conflicts')) || {};
  const c = conflicts[key];
  if (!c) return;
  const data = choice === 'remote' ? c.remote : choice === 'merge' && CONFLICT_COLS.has(c.col) ? mergeRepertoires(c.local, c.remote) : c.local;
  delete conflicts[key];
  await store.metaSet('conflicts', conflicts);
  state.conflicts = Object.values(conflicts);
  await store.put(c.col, c.id, data, { file: c.file }); // date de maintenant : cette version gagne partout
  notify();
}
export async function loadConflicts() {
  state.conflicts = Object.values((await store.metaGet('conflicts')) || {});
  notify();
}

function serializeFile(recs) {
  const sorted = [...recs].sort((a, b) => (a.key < b.key ? -1 : 1));
  return JSON.stringify({ version: 1, records: sorted.map(({ col, id, data, updatedAt, deleted }) => (deleted ? { col, id, updatedAt, deleted: true } : { col, id, data, updatedAt })) });
}
const buildFile = async (file) => serializeFile(await store.recordsOfFile(file));

// Empreinte que git (et donc GitHub) donne à un fichier ayant ce contenu.
async function blobSha(content) {
  const bytes = new TextEncoder().encode(content);
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head); all.set(bytes, head.length);
  const digest = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Fichiers à envoyer en plus de ceux déjà notés : jamais envoyés, ou différents de la version GitHub
// alors que celle-ci a déjà été fusionnée ici. Le second cas rattrape les modifications qu'une
// ancienne version de l'appli retirait par erreur de la liste d'envoi.
async function unsentFiles(remote, shas, dirty) {
  const byFile = new Map();
  for (const r of await store.allRecords()) {
    if (!byFile.has(r.file)) byFile.set(r.file, []);
    byFile.get(r.file).push(r);
  }
  const out = [];
  for (const [file, recs] of byFile) {
    if (dirty.has(file)) continue;
    if (!remote[file] || (shas[file] === remote[file] && await blobSha(serializeFile(recs)) !== remote[file])) out.push(file);
  }
  return out;
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
  state.running = true; state.error = null; state.offline = false; notify();
  try {
    const since = state.lastSync;
    // La date retenue est celle du début : une saisie faite pendant la synchro compte comme
    // postérieure, et un conflit sur ce répertoire sera bien détecté la fois suivante.
    const startedAt = Date.now();
    const shas = (await store.metaGet('shas')) || {};
    const dirtyFiles = async () => new Set((await store.metaGet('dirty')) || []);

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
      if (await mergeRemote(file, recs, since)) await store.markDirty([file]); // noté avant le sha : rien n'est oublié si la suite échoue
      shas[file] = sha;
      await store.metaSet('shas', shas);
    }
    await store.markDirty(await unsentFiles(remote, shas, await dirtyFiles()));

    // 2) Envoi des fichiers modifiés localement (un à la fois : chaque envoi est un commit).
    const heldFiles = async () => new Set(Object.values((await store.metaGet('conflicts')) || {}).map((c) => c.file));
    state.conflicts = Object.values((await store.metaGet('conflicts')) || {});
    for (const file of await dirtyFiles()) {
      let skip = false, pushed = false, sent = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        if ((await heldFiles()).has(file)) { skip = true; break; } // en attente de la décision de l'utilisateur : on n'écrase pas l'autre appareil
        const content = await buildFile(file);
        const body = { message: `Sync ${file}`, content: b64encode(content) };
        if (shas[file]) body.sha = shas[file];
        const r = await gh(`${repoPath()}/contents/${file.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', body });
        if (r.ok) { shas[file] = r.body.content.sha; pushed = true; sent = content; break; }
        if (r.status === 409 || r.status === 422) {
          // Le fichier a changé sur GitHub entre-temps (autre appareil) : on relit, fusionne et réessaie.
          const cur = await gh(`${repoPath()}/contents/${file.split('/').map(encodeURIComponent).join('/')}`);
          if (cur.ok) {
            await mergeRemote(file, parseFile(await fetchBlob(cur.body.sha)), since);
            shas[file] = cur.body.sha;
          } else delete shas[file];
          continue;
        }
        throw new Error(explain(r.status, r.body));
      }
      if (skip) { state.conflicts = Object.values((await store.metaGet('conflicts')) || {}); continue; }
      if (!pushed) { await store.metaSet('shas', shas); throw new Error('GitHub a refusé l\'envoi de ' + file + ' (le fichier change sans cesse). Nouvel essai à la prochaine synchronisation.'); }
      await store.metaSet('shas', shas);
      await store.clearDirty(file, sent, serializeFile);
    }
    // Saisies faites pendant cette synchro : on les envoie sans attendre le passage périodique.
    const held = await heldFiles();
    if ([...await dirtyFiles()].some((f) => !held.has(f))) schedule();
    state.lastSync = startedAt;
    local.set('lastSync', String(state.lastSync));
    return true;
  } catch (e) {
    state.error = navigator.onLine === false || e.network ? 'Pas de connexion Internet.' : (e.message || String(e));
    state.offline = state.error === 'Pas de connexion Internet.';
    return false;
  } finally {
    state.running = false; notify();
  }
}

// ------------------------------------------------------------------ déclenchement automatique
let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => { timer = null; syncNow(); }, 20000); // regroupe les modifications rapprochées
}
store.onChange((info) => { if (info.local && cfg.configured) schedule(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && timer) { clearTimeout(timer); timer = null; syncNow(); }
  if (document.visibilityState === 'visible' && Date.now() - state.lastSync > 120000) syncNow();
});
setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 5 * 60000);
