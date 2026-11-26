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

// Supprime tous les enregistrements d'une collection, en une transaction. Les suppressions sont
// gardées comme « marqueurs » (sans les données) pour que la synchronisation les efface aussi sur
// GitHub et sur les autres appareils. Renvoie le nombre d'enregistrements supprimés.
export async function removeAll(col) {
  const rows = await tx('records', 'readonly', (s) => req2p(s.index('col').getAll(col)));
  const live = rows.filter((r) => !r.deleted);
  if (!live.length) return 0;
  const now = Date.now();
  await tx(['records', 'meta'], 'readwrite', async (s, m) => {
    const dirty = (await req2p(m.get('dirty'))) || [];
    for (const r of live) {
      s.put({ key: r.key, col, id: r.id, data: null, deleted: true, updatedAt: now, file: r.file });
      if (!dirty.includes(r.file)) dirty.push(r.file);
    }
    m.put(dirty, 'dirty');
  });
  emit({ col, local: true });
  return live.length;
}

// ----- utilisé par la synchronisation
export const recordsOfFile = (file) => tx('records', 'readonly', (s) => req2p(s.index('file').getAll(file)));
export const allRecords = () => tx('records', 'readonly', (s) => req2p(s.getAll()));
export const rawGet = (key) => tx('records', 'readonly', (s) => req2p(s.get(key)));
// Écrit des enregistrements reçus de GitHub, sauf ceux dont la version locale est devenue plus
// récente depuis leur lecture. Renvoie le nombre d'enregistrements ainsi laissés de côté.
export async function rawPutMany(recs) {
  if (!recs.length) return 0;
  const written = [];
  await tx('records', 'readwrite', async (s) => {
    for (const r of recs) {
      const cur = await req2p(s.get(r.key));
      if (cur && (cur.updatedAt || 0) > r.updatedAt) continue;
      s.put(r);
      written.push(r);
    }
  });
  const cols = new Set(written.map((r) => r.col));
  for (const col of cols) emit({ col, remote: true });
  return recs.length - written.length;
}

// Restauration d'une sauvegarde, en une seule transaction (tout ou rien). « decide(saved, current) »
// renvoie l'enregistrement à écrire, ou null ; chaque fichier touché est noté à envoyer.
export const restoreRecords = (saved, decide) => tx(['records', 'meta'], 'readwrite', async (s, m) => {
  const files = new Set();
  for (const r of saved) {
    const rec = decide(r, await req2p(s.get(`${r.col}/${r.id}`)));
    if (!rec) continue;
    s.put(rec);
    files.add(rec.file);
  }
  const dirty = (await req2p(m.get('dirty'))) || [];
  m.put([...new Set([...dirty, ...files])], 'dirty');
});

// Liste des fichiers à envoyer. Elle n'est jamais réécrite à partir d'une copie en mémoire : chaque
// ajout ou retrait la relit dans la même transaction, pour ne pas effacer une saisie faite entre-temps.
export const markDirty = (files) => tx('meta', 'readwrite', async (m) => {
  const dirty = (await req2p(m.get('dirty'))) || [];
  const added = files.filter((f) => !dirty.includes(f));
  if (added.length) m.put([...dirty, ...added], 'dirty');
});

// Retire « file » de la liste après un envoi, seulement si ses enregistrements donnent toujours le
// contenu envoyé (« serialize » le reconstruit). Sinon il a changé pendant l'envoi et reste à envoyer.
export const clearDirty = (file, sent, serialize) => tx(['records', 'meta'], 'readwrite', async (s, m) => {
  if (serialize(await req2p(s.index('file').getAll(file))) !== sent) return;
  const dirty = (await req2p(m.get('dirty'))) || [];
  m.put(dirty.filter((f) => f !== file), 'dirty');
});

export const metaGet = (k) => tx('meta', 'readonly', (s) => req2p(s.get(k)));
export const metaSet = (k, v) => tx('meta', 'readwrite', (s) => { s.put(v, k); });

// ------------------------------------------------------------------ cache local (non synchronisé)
export const cacheGet = (k) => tx('cache', 'readonly', (s) => req2p(s.get(k)));
export const cacheSet = (k, v) => tx('cache', 'readwrite', (s) => { s.put(v, k); });
export const cacheClear = () => tx('cache', 'readwrite', (s) => { s.clear(); });
