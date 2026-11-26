// Fiabilité : fichier distant illisible et moteur du navigateur qui plante.
import test from 'node:test';
import assert from 'node:assert/strict';

const memoire = new Map();
globalThis.localStorage = { getItem: (k) => memoire.get(k) ?? null, setItem: (k, v) => memoire.set(k, String(v)), removeItem: (k) => memoire.delete(k) };
globalThis.document = { addEventListener() {}, visibilityState: 'hidden' };
globalThis.matchMedia = () => ({ matches: false });
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 2, userAgent: 'node', onLine: true }, configurable: true });
globalThis.setInterval = () => 0;
globalThis.location = { hostname: 'localhost', port: '' };

// Faux Worker Stockfish. « plantages » : nombre de recherches qui font planter le moteur.
let plantages = 0;
const workers = [];
globalThis.Worker = class {
  constructor() { this.termine = false; workers.push(this); }
  dire(l) { queueMicrotask(() => { if (!this.termine) this.onmessage({ data: l }); }); }
  postMessage(cmd) {
    if (cmd === 'uci') this.dire('uciok');
    else if (cmd === 'isready') this.dire('readyok');
    else if (cmd.startsWith('go ')) {
      if (plantages > 0) { plantages--; queueMicrotask(() => this.onerror()); return; }
      this.dire('info depth 8 multipv 1 score cp 20 pv e2e4 e7e5');
      this.dire('bestmove e2e4');
    }
  }
  terminate() { this.termine = true; }
};

const { parseFile, unreadableMessage } = await import('../core/sync.js');
const { WasmPool } = await import('../core/engine.js');
const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const chercher = (pool) => pool.run((e) => e.search(FEN, { depth: 8 }));

test('Synchro · un fichier valide est lu, y compris sans aucun enregistrement', () => {
  const r = { col: 'analysis', id: 'a', data: {}, updatedAt: 1 };
  assert.deepEqual(parseFile(JSON.stringify({ version: 1, records: [r] })), [r]);
  assert.deepEqual(parseFile('{"version":1,"records":[]}'), []);
});

test('Synchro · un fichier illisible ou d’un autre format n’est pas traité comme vide', () => {
  for (const texte of ['', '{"version":1,"records":[', '<<<<<<< HEAD', 'null', '{}', '[]', '{"version":2,"records":[]}', '{"records":[null]}', '{"records":[{"id":"a"}]}']) {
    assert.equal(parseFile(texte), null, texte);
  }
  assert.match(unreadableMessage(['a.json']), /Fichier illisible.*a\.json/);
});

test('Moteur · après un plantage, la recherche est relancée sur un moteur neuf', async () => {
  workers.length = 0; plantages = 1;
  const pool = new WasmPool(1);
  const infos = await chercher(pool);
  assert.equal(infos[0].pv[0], 'e2e4');
  assert.equal(workers.length, 2);
  assert.ok(workers[0].termine);
  assert.equal(pool.engines.length, 1);
  assert.equal(pool.free.length, 1);
});

test('Moteur · deux plantages de suite : erreur claire, et la réserve reste utilisable', async () => {
  plantages = 2;
  const pool = new WasmPool(1);
  await assert.rejects(chercher(pool), /s’est arrêté/);
  assert.equal(pool.engines.length, 1);
  assert.equal((await chercher(pool))[0].pv[0], 'e2e4');
});

test('Moteur · une recherche en attente obtient bien le moteur de remplacement', async () => {
  plantages = 1;
  const pool = new WasmPool(1);
  const resultats = await Promise.all([chercher(pool), chercher(pool)]);
  assert.deepEqual(resultats.map((r) => r[0].pv[0]), ['e2e4', 'e2e4']);
});

test('Moteur · des moteurs morts au repos sont remplacés avant de recevoir une recherche', async () => {
  plantages = 0;
  const pool = new WasmPool(3);
  await Promise.all([chercher(pool), chercher(pool), chercher(pool)]);
  for (const w of workers.slice(-3)) w.onerror();
  assert.equal((await chercher(pool))[0].pv[0], 'e2e4');
  assert.equal(pool.engines.length, 3);
});
