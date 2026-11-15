// Stockage local (IndexedDB) : toutes les données de l'utilisateur vivent d'abord sur l'appareil,
// puis sont synchronisées avec GitHub par sync.js.
//
// « records » : enregistrements synchronisés { key, col, id, data, updatedAt, deleted?, file }
//   - col  : collection (analysis, analysisIndex, settings, …)
//   - file : fichier du dépôt GitHub qui contient l'enregistrement (ex. analyses/2026-11.json)
// « meta »  : état de la synchronisation (sha des fichiers, fichiers modifiés)
// « cache » : données locales non synchronisées (mois chess.com déjà téléchargés…)

const DB_NAME = 'echecs';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const rec = db.createObjectStore('records', { keyPath: 'key' });
      rec.createIndex('col', 'col');
      rec.createIndex('file', 'file');
      db.createObjectStore('meta');
      db.createObjectStore('cache');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(stores, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let out;
    Promise.resolve(fn(...[].concat(stores).map((s) => t.objectStore(s)))).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
const req2p = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

const listeners = new Set();
export function onChange(f) { listeners.add(f); return () => listeners.delete(f); }
function emit(info) { for (const f of listeners) { try { f(info); } catch { /* */ } } }

// ------------------------------------------------------------------ enregistrements synchronisés
export async function get(col, id) {
  const r = await tx('records', 'readonly', (s) => req2p(s.get(`${col}/${id}`)));
  return r && !r.deleted ? r.data : null;
}

export async function all(col) {
  const rows = await tx('records', 'readonly', (s) => req2p(s.index('col').getAll(col)));
  return rows.filter((r) => !r.deleted);
}

export async function put(col, id, data, { file = `${col}.json` } = {}) {
  const rec = { key: `${col}/${id}`, col, id, data, updatedAt: Date.now(), file };
  await tx(['records', 'meta'], 'readwrite', async (s, m) => {
    s.put(rec);
    const dirty = (await req2p(m.get('dirty'))) || [];
    if (!dirty.includes(file)) { dirty.push(file); m.put(dirty, 'dirty'); }
  });
  emit({ col, id, local: true });
}

export async function remove(col, id) {
  const old = await tx('records', 'readonly', (s) => req2p(s.get(`${col}/${id}`)));
  if (!old) return;
  const file = old.file;
  await tx(['records', 'meta'], 'readwrite', async (s, m) => {
    s.put({ key: old.key, col, id, data: null, deleted: true, updatedAt: Date.now(), file });
    const dirty = (await req2p(m.get('dirty'))) || [];
    if (!dirty.includes(file)) { dirty.push(file); m.put(dirty, 'dirty'); }
  });
  emit({ col, id, local: true });
}

// ----- utilisé par la synchronisation
export const recordsOfFile = (file) => tx('records', 'readonly', (s) => req2p(s.index('file').getAll(file)));
export const allRecords = () => tx('records', 'readonly', (s) => req2p(s.getAll()));
export const rawGet = (key) => tx('records', 'readonly', (s) => req2p(s.get(key)));
export async function rawPutMany(recs) {
  if (!recs.length) return;
  await tx('records', 'readwrite', (s) => { for (const r of recs) s.put(r); });
  const cols = new Set(recs.map((r) => r.col));
  for (const col of cols) emit({ col, remote: true });
}

export const metaGet = (k) => tx('meta', 'readonly', (s) => req2p(s.get(k)));
export const metaSet = (k, v) => tx('meta', 'readwrite', (s) => { s.put(v, k); });

// ------------------------------------------------------------------ cache local (non synchronisé)
export const cacheGet = (k) => tx('cache', 'readonly', (s) => req2p(s.get(k)));
export const cacheSet = (k, v) => tx('cache', 'readwrite', (s) => { s.put(v, k); });
