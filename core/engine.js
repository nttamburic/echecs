// Couche moteur commune à tous les modules.
// Trois sources, choisies automatiquement :
//   1. « Boost PC » : le petit serveur local (Stockfish 19 natif, plusieurs cœurs, profondeur 22),
//      s'il répond sur http://127.0.0.1:8765 ;
//   2. sinon Stockfish 19 « lite » compilé en WebAssembly, directement dans le navigateur
//      (fonctionne aussi sur téléphone, un peu moins fort, profondeur plus faible) ;
//   3. dans les deux cas : analyse cloud Lichess et tables de finales Lichess d'abord.
// Tous les scores renvoyés sont du point de vue des Blancs.
import { Chess } from '../vendor/chess.js';
import { fetchJson, local, isMobile } from './ui.js';

export const DEPTH_PC = 18;
const MULTIPV = 2;
const SEARCH_TIMEOUT_MS = 45000;
const HANG_TIMEOUT_MS = 15000; // délai de réponse au-delà duquel un moteur est considéré comme mort
const LOAD_TIMEOUT_MS = 90000;
const DEAD_MESSAGE = 'Le moteur d’analyse du navigateur s’est arrêté. Réessayez.';

// ------------------------------------------------------------------ utilitaires
const sideToMove = (fen) => fen.split(' ')[1];
const flip = (s) => (s.mate !== undefined ? { ...s, mate: -s.mate } : { ...s, cp: -s.cp });
const toWhite = (fen, s) => (sideToMove(fen) === 'w' ? s : flip(s));
export const countPieces = (fen) => fen.split(' ')[0].replace(/[^a-zA-Z]/g, '').length;

// Rejoue une ligne UCI, corrige le roque « e1h1 » (Lichess) en « e1g1 », s'arrête au premier coup illégal.
export function normalizePv(fen, ucis) {
  const c = new Chess(fen);
  const out = [];
  for (let u of ucis) {
    const from = u.slice(0, 2);
    const piece = c.get(from);
    if (piece && piece.type === 'k') {
      const fix = { e1h1: 'e1g1', e1a1: 'e1c1', e8h8: 'e8g8', e8a8: 'e8c8' }[u];
      if (fix) u = fix;
    }
    try { c.move({ from, to: u.slice(2, 4), promotion: u[4] }); } catch { break; }
    out.push(u);
  }
  return out;
}

export function parseInfo(line) {
  const t = line.split(' ');
  const info = { multipv: 1, depth: 0, bound: false, pv: [] };
  for (let i = 1; i < t.length; i++) {
    const k = t[i];
    if (k === 'depth') info.depth = +t[++i];
    else if (k === 'multipv') info.multipv = +t[++i];
    else if (k === 'score') {
      const type = t[++i];
      const val = +t[++i];
      info.score = type === 'mate' ? { mate: val } : { cp: val };
      if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') { info.bound = true; i++; }
    } else if (k === 'pv') { info.pv = t.slice(i + 1); break; }
  }
  return info.score && info.pv.length ? info : null;
}

// ------------------------------------------------------------------ Lichess
export async function tablebase(fen, played, npv = MULTIPV) {
  if (countPieces(fen) > 7 || fen.split(' ')[2] !== '-') return null;
  const { status, body } = await fetchJson('https://tablebase.lichess.ovh/standard?fen=' + encodeURIComponent(fen));
  if (status !== 200 || !body || !body.moves || !body.moves.length) return null;
  if (!['win', 'loss', 'draw', 'cursed-win', 'blessed-loss'].includes(body.category)) return null;
  // Catégorie d'un coup = point de vue de l'adversaire après le coup : on la remet du point de vue du joueur.
  const moveScore = (m) => {
    if (m.checkmate) return { mate: 1, tb: true };
    const cat = m.category;
    if (cat === 'loss' || cat === 'maybe-loss') {
      return m.dtm != null ? { mate: Math.ceil((Math.abs(m.dtm) + 1) / 2), tb: true } : { cp: 9000 - Math.abs(m.dtz || 0), tb: true };
    }
    if (cat === 'win' || cat === 'maybe-win') {
      return m.dtm != null ? { mate: -Math.ceil((Math.abs(m.dtm) + 1) / 2), tb: true } : { cp: -(9000 - Math.abs(m.dtz || 0)), tb: true };
    }
    return { cp: 0, tb: true };
  };
  const lines = body.moves.slice(0, npv).map((m) => ({ pv: [m.uci], score: toWhite(fen, moveScore(m)) }));
  const pm = body.moves.find((m) => m.uci === played);
  const result = { source: 'tablebase', depth: 0, lines, tb: body };
  if (played) {
    if (!pm) return null;
    result.played = { pv: [pm.uci], score: toWhite(fen, moveScore(pm)) };
  }
  return result;
}

let cloudBlockedUntil = 0;
const cloudCache = new Map();
export async function cloudEval(fen, minDepth, npv = MULTIPV) {
  const key = fen + '|' + minDepth + '|' + npv;
  if (cloudCache.has(key)) return cloudCache.get(key);
  const r = await cloudEvalRaw(fen, minDepth, npv);
  if (!r.blocked) cloudCache.set(key, r);
  if (cloudCache.size > 5000) cloudCache.delete(cloudCache.keys().next().value);
  return r;
}
async function cloudEvalRaw(fen, minDepth, npv) {
  if (Date.now() < cloudBlockedUntil) return { miss: true, blocked: true };
  const { status, body } = await fetchJson(`https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${npv}`, { timeout: 8000 });
  if (status === 429) { cloudBlockedUntil = Date.now() + 60000; return { miss: true, blocked: true }; }
  if (status === 0) return { miss: true, blocked: true };
  if (status !== 200 || !body || !body.pvs || body.depth < minDepth) return { miss: true };
  const nLegal = new Chess(fen).moves().length;
  if (body.pvs.length < Math.min(npv, nLegal)) return { miss: true };
  const lines = body.pvs.map((p) => ({
    pv: normalizePv(fen, p.moves.split(' ')),
    score: p.mate !== undefined ? { mate: p.mate } : { cp: p.cp },
  })).filter((l) => l.pv.length);
  return lines.length ? { lines, depth: body.depth } : { miss: true };
}

// ------------------------------------------------------------------ Stockfish WASM (navigateur)
// Stockfish 19 Lite « single » : un cœur par moteur. Pour utiliser plusieurs cœurs, on lance plusieurs
// moteurs en parallèle, chacun sur une position différente (mesuré : à profondeur fixe, la version
// multi-thread explore 4 fois plus de positions pour la même profondeur, donc sans gain de temps).
class WasmEngine {
  constructor() {
    this.queue = Promise.resolve();
    this.onLine = null;
    this.dead = false;
    this.ready = this.start();
  }
  start() {
    this.worker = new Worker(new URL('../vendor/stockfish/stockfish-19-lite-single.js', import.meta.url));
    this.worker.onmessage = (e) => {
      const line = String(e.data || '').trim();
      if (this.onLine) this.onLine(line);
    };
    this.worker.onerror = () => this.kill();
    return this.init();
  }
  // Moteur planté ou muet : il est arrêté, et la recherche en attente est libérée.
  kill() {
    if (this.dead) return;
    this.dead = true;
    this.worker.terminate();
    if (this.onLine) this.onLine('__exit__');
  }
  alive() { if (this.dead) throw Object.assign(new Error(DEAD_MESSAGE), { engineDead: true }); }
  send(cmd) { this.worker.postMessage(cmd); }
  waitFor(pred, timeout = HANG_TIMEOUT_MS) {
    if (this.dead) return Promise.resolve('__exit__');
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.kill(), timeout);
      this.onLine = (line) => { if (line === '__exit__' || pred(line)) { clearTimeout(timer); this.onLine = null; resolve(line); } };
    });
  }
  async init() {
    const p = this.waitFor((l) => l === 'uciok', LOAD_TIMEOUT_MS); // premier chargement : le téléchargement peut être long
    this.send('uci');
    await p;
    this.send('setoption name Hash value 32');
    const r = this.waitFor((l) => l === 'readyok');
    this.send('isready');
    await r;
  }
  search(fen, { depth, multipv = 1, searchmoves = null, nodes = null, movetime = 0 } = {}) {
    const job = async () => {
      await this.ready;
      this.alive();
      this.send(`setoption name MultiPV value ${multipv}`);
      const r = this.waitFor((l) => l === 'readyok');
      this.send('isready');
      await r;
      this.alive();
      this.send(`position fen ${fen}`);
      const exact = new Map();
      const bounded = new Map();
      const done = new Promise((resolve) => {
        this.onLine = (line) => {
          if (line === '__exit__') { this.onLine = null; resolve(); return; }
          if (line.startsWith('info ') && line.includes(' pv ') && line.includes(' score ')) {
            const info = parseInfo(line);
            if (info) (info.bound ? bounded : exact).set(info.multipv, info);
          } else if (line.startsWith('bestmove')) { this.onLine = null; resolve(); }
        };
      });
      let hang = null;
      const timer = setTimeout(() => { this.send('stop'); hang = setTimeout(() => this.kill(), HANG_TIMEOUT_MS); }, SEARCH_TIMEOUT_MS);
      this.send((nodes ? `go nodes ${nodes}` : `go depth ${depth}`) + (movetime ? ` movetime ${movetime}` : '') + (searchmoves ? ` searchmoves ${searchmoves.join(' ')}` : ''));
      await done;
      clearTimeout(timer);
      clearTimeout(hang);
      this.alive(); // un résultat partiel ou vide ne doit pas être gardé en cache
      const out = [];
      for (let k = 1; k <= multipv; k++) {
        const v = exact.get(k) || bounded.get(k);
        if (v) out.push(v);
      }
      return out;
    };
    const p = this.queue.then(job, job);
    this.queue = p.catch(() => {});
    return p;
  }
}

export class WasmPool {
  constructor(n) {
    this.n = n;
    this.retired = false;
    this.engines = [];
    this.free = [];
    this.waiting = [];
  }
  ensure() {
    if (this.engines.length) return;
    for (let i = 0; i < this.n; i++) { const e = new WasmEngine(); this.engines.push(e); this.free.push(e); }
  }
  acquire(priority) {
    this.ensure();
    if (this.free.length) {
      const e = this.free.pop();
      // un moteur peut aussi mourir au repos : il est remplacé avant d'être confié à une recherche
      return Promise.resolve(e.dead ? this.replace(e) : e);
    }
    return new Promise((resolve) => { if (priority) this.waiting.unshift(resolve); else this.waiting.push(resolve); });
  }
  // La réserve garde toujours le même nombre de moteurs.
  replace(dead) {
    const e = new WasmEngine();
    this.engines = this.engines.map((x) => (x === dead ? e : x));
    return e;
  }
  release(e) {
    if (e.dead) {
      if (this.retired && !this.waiting.length) return;
      e = this.replace(e);
    }
    const next = this.waiting.shift();
    if (next) next(e);
    else if (this.retired) e.worker.terminate(); // ancien réglage : le moteur s'arrête une fois sa recherche finie
    else this.free.push(e);
  }
  retire() { this.retired = true; for (const e of this.free) e.worker.terminate(); this.free = []; }
  // Si le moteur meurt pendant la recherche, elle est relancée une fois sur un moteur neuf.
  async run(fn, priority = false, retry = true) {
    const e = await this.acquire(priority);
    try { return await fn(e); } catch (err) {
      if (!retry || !err.engineDead) throw err;
    } finally { this.release(e); }
    return this.run(fn, true, false);
  }
}

const hw = navigator.hardwareConcurrency || 2;
// « Threads » (roue dentée) : nombre de moteurs Stockfish 1 cœur en parallèle, réglable par appareil.
// Par défaut : tous les cœurs logiques sauf 2 sur PC (10 sur un processeur à 12 threads), 2 sur téléphone.
export const MAX_THREADS = Math.max(1, hw);
export const DEFAULT_THREADS = isMobile() ? Math.min(2, hw) : Math.max(1, hw - 2);
export const wasmThreads = () => Math.min(MAX_THREADS, Math.max(1, Number(local.get('threads')) || DEFAULT_THREADS));
let WASM_ENGINES = 0;
let wasmPool = null;
function getPool() {
  const n = wasmThreads();
  if (n !== WASM_ENGINES) {
    if (wasmPool) wasmPool.retire();
    wasmPool = new WasmPool(n);
    WASM_ENGINES = n;
  }
  return wasmPool;
}
getPool();
const wasmDesc = () => `${wasmThreads()} moteur${wasmThreads() > 1 ? 's' : ''}`;
export const wasmDepth = () => Number(local.get('wasmDepth')) || (isMobile() ? 16 : 18);
// Réglages de la roue dentée (vue partie) : profondeur avec le Boost PC, temps maximum par position (ms, 0 = sans limite)
// et nombre de variantes affichées par l'analyse en direct.
export const pcDepth = () => Number(local.get('depthPc')) || DEPTH_PC;
export const maxTime = () => Number(local.get('movetime')) || 0;
export const nLines = () => Math.min(5, Math.max(1, Number(local.get('multipv')) || 3));
export const PC_DEPTHS = [16, 18, 20, 22, 24];
export const WEB_DEPTHS = [12, 14, 16, 18, 20];

// ------------------------------------------------------------------ Boost PC
const PC_PORT = 8765;
const sameOriginPc = location.hostname === '127.0.0.1' && Number(location.port) === PC_PORT;
const boostBase = () => (sameOriginPc ? '' : (local.get('boostUrl') || `http://127.0.0.1:${PC_PORT}`));
export const boostEnabled = () => local.get('boost', '1') === '1';
const LOOPBACK = sameOriginPc ? {} : { targetAddressSpace: 'loopback' };

export const status = { boost: null, checked: false, listeners: new Set() };
function notify() { for (const f of status.listeners) { try { f(status); } catch { /* */ } } }
export function onStatus(f) { status.listeners.add(f); f(status); return () => status.listeners.delete(f); }

export async function detectBoost() {
  if (!boostEnabled()) { status.boost = null; status.checked = true; notify(); return null; }
  // Chrome demande une fois l'autorisation « accéder aux appareils du réseau local » : on laisse le temps de répondre.
  const { status: code, body } = await fetchJson(boostBase() + '/api/status', { timeout: sameOriginPc ? 60000 : 20000, ...LOOPBACK });
  status.boost = code === 200 && body && body.engine ? body : null;
  status.checked = true;
  notify();
  return status.boost;
}
// Si le PC n'était pas joignable, on retente de temps en temps (le serveur a pu être lancé entre-temps).
setInterval(() => { if (!status.boost && boostEnabled() && document.visibilityState === 'visible') detectBoost(); }, 30000);

export function parallelism() { return status.boost ? status.boost.engines || 4 : (getPool(), WASM_ENGINES); }

// Moteur utilisé par l'analyse multiple : nom, nombre de moteurs, profondeurs proposées et par défaut.
// Un Boost PC lancé avant cette version ne sait pas changer de profondeur (depthOption absent).
export function engineInfo() {
  if (status.boost) {
    const b = status.boost;
    return { boost: true, label: `Boost PC : ${b.engine} · ${b.engines} moteurs`, engines: b.engines, depths: b.depthOption ? [16, 18, 20, 22, 24] : [b.depth], def: b.depthOption ? 18 : b.depth, fixed: !b.depthOption };
  }
  const d = wasmDepth();
  const depths = [...new Set([12, 14, 16, 18, 20, d])].sort((x, y) => x - y);
  return { boost: false, label: `Navigateur : Stockfish 19 lite · ${wasmDesc()}`, engines: wasmThreads(), depths, def: d, fixed: false };
}

// Moteur et profondeur utilisés pour analyser une partie (réglages de la roue dentée).
// Un Boost PC lancé avant la version « depthOption » garde sa profondeur fixe.
export function analysisSettings() {
  const b = status.boost;
  if (b) return { boost: true, name: b.engine || 'Stockfish 19', engines: b.engines, fixed: !b.depthOption, depth: b.depthOption ? pcDepth() : b.depth };
  return { boost: false, name: 'Stockfish 19 Lite', engines: wasmThreads(), fixed: false, depth: wasmDepth() };
}

export function engineLabel() {
  if (!status.checked) return 'Recherche du moteur…';
  if (status.boost) return `Boost PC : ${status.boost.engine} · ${status.boost.engines} moteurs · profondeur ${analysisSettings().depth}`;
  return `Navigateur : Stockfish 19 lite · ${wasmDesc()} · profondeur ${wasmDepth()}`;
}

export const SOURCE_LABEL = (pos) => ({
  stockfish: `Stockfish 19 (PC) · profondeur ${pos.depth}`,
  wasm: `Stockfish 19 lite (navigateur) · profondeur ${pos.depth}`,
  cloud: `Analyse cloud Lichess · profondeur ${pos.depth}`,
  tablebase: 'Tables de finales Lichess',
}[pos.source] || pos.source);

// ------------------------------------------------------------------ analyse d'une position
const posCache = new Map();

async function boostPosition(body) {
  const r = await fetchJson(boostBase() + '/api/position', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeout: 120000, ...LOOPBACK,
  });
  if (r.status === 0) throw Object.assign(new Error('PC injoignable'), { down: true });
  if (!r.ok) throw new Error((r.body && r.body.error) || 'Erreur ' + r.status);
  return r.body;
}

// Analyse « fen », avec le coup joué « played » (UCI) évalué dans la même recherche.
// opts : { cloud, priority, cloudOnly, depth, multipv, movetime }. « depth » : profondeur imposée, sinon celle par défaut ;
// « multipv » : nombre de meilleures lignes (au moins 2) ; « movetime » : temps maximum par recherche en ms (0 = sans limite).
// Renvoie { source, depth, lines:[{pv,score}], played:{pv,score} } ou { miss:true }.
export async function analyzePosition(fen, played = null, { cloud = false, priority = false, cloudOnly = false, depth = null, multipv = 0, movetime = 0 } = {}) {
  const key = `${fen}|${played || ''}|${depth || ''}|${multipv || ''}|${movetime || ''}`;
  if (posCache.has(key)) return posCache.get(key);
  if (!status.checked) await detectBoost();
  if (status.boost) {
    try {
      const r = await boostPosition({ fen, played, cloud, priority, cloudOnly, ...(depth ? { depth } : {}), ...(multipv ? { multipv } : {}), ...(movetime ? { movetime } : {}) });
      if (!r.miss) remember(key, r);
      return r;
    } catch (e) {
      if (!e.down) throw e;
      status.boost = null; notify(); // le serveur a été fermé : on bascule sur le navigateur
    }
  }
  const r = await localPosition(fen, played, cloud, priority, cloudOnly, depth, multipv, movetime);
  if (!r.miss) remember(key, r);
  return r;
}
function remember(key, r) { posCache.set(key, r); if (posCache.size > 5000) posCache.delete(posCache.keys().next().value); }

async function localPosition(fen, played, useCloud, priority, cloudOnly, forcedDepth = null, multipv = 0, movetime = 0) {
  const depth = forcedDepth || wasmDepth();
  const npv = Math.max(MULTIPV, multipv || 0);
  if (cloudOnly) {
    if (countPieces(fen) > 7) {
      const cl = await cloudEval(fen, depth, npv);
      if (cl.miss) return { miss: true };
    }
    return localPosition(fen, played, true, priority, false, forcedDepth, multipv, movetime);
  }
  if (played) {
    const c = new Chess(fen);
    try { c.move({ from: played.slice(0, 2), to: played.slice(2, 4), promotion: played[4] }); } catch { throw new Error('Coup illégal : ' + played); }
  }
  let result = await tablebase(fen, played, npv);
  let cloudMiss = false;
  if (!result && useCloud) {
    const cl = await cloudEval(fen, depth, npv);
    if (cl.miss) cloudMiss = true; else result = { source: 'cloud', depth: cl.depth, lines: cl.lines };
  }
  if (result) delete result.tb;
  const pre = result;
  result = await getPool().run(async (eng) => {
    let r = pre;
    if (!r) {
      const infos = await eng.search(fen, { depth, multipv: npv, movetime });
      r = { source: 'wasm', depth: Math.max(...infos.map((i) => i.depth)), lines: infos.map((i) => ({ pv: i.pv, score: toWhite(fen, i.score) })) };
    }
    if (played && !r.played) {
      const inLines = r.lines.find((l) => l.pv[0] === played);
      if (inLines) r.played = { pv: inLines.pv, score: inLines.score };
      else {
        const infos = await eng.search(fen, { depth, multipv: 1, searchmoves: [played], movetime });
        if (infos[0]) r.played = { pv: infos[0].pv, score: toWhite(fen, infos[0].score), source: 'wasm' };
      }
    }
    return r;
  }, priority);
  result.cloudMiss = cloudMiss;
  return result;
}
