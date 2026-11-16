// Worker Maia3 : réseau de neurones (ONNX) qui prédit le coup qu'un humain d'un Elo donné jouerait.
// Encodage repris du dépôt CSSLab/maia3 (dataset.py, utils.py) :
//   - échiquier vu du camp au trait (miroir quand les Noirs jouent : rangées inversées, couleurs échangées) ;
//   - 64 cases (a1 = 0, rang × 8 + colonne) × 12 canaux (P C F T D R blancs, puis noirs) ;
//   - vocabulaire de 4352 coups : 64 × 64 départ/arrivée, puis 256 promotions de la 7e à la 8e rangée.
import * as ort from '../vendor/onnxruntime/ort.wasm.min.mjs';
import { Chess } from '../vendor/chess.js';

ort.env.wasm.wasmPaths = new URL('../vendor/onnxruntime/', import.meta.url).href;
ort.env.wasm.numThreads = 1;

const FILES = 'abcdefgh';
const sqName = (i) => FILES[i % 8] + (Math.floor(i / 8) + 1);
const MOVES = [];
for (let a = 0; a < 64; a++) for (let b = 0; b < 64; b++) MOVES.push(sqName(a) + sqName(b));
for (const f of FILES) for (const t of FILES) for (const p of 'qrbn') MOVES.push(`${f}7${t}8${p}`);
const INDEX = new Map(MOVES.map((m, i) => [m, i]));
const PIECE = { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 };
const mirrorSq = (s) => s[0] + (9 - Number(s[1]));
const mirrorMove = (u) => mirrorSq(u.slice(0, 2)) + mirrorSq(u.slice(2, 4)) + u.slice(4);

let session = null;
let sessionModel = null;

async function load(model) {
  if (session && sessionModel === model) return session;
  const url = new URL(`../vendor/maia3/maia3-${model}.fp16.onnx`, import.meta.url).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Modèle Maia introuvable (' + res.status + ')');
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0, last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (Date.now() - last > 200) { last = Date.now(); postMessage({ type: 'progress', got, total }); }
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  postMessage({ type: 'progress', got, total: got, compiling: true });
  session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'basic' });
  sessionModel = model;
  return session;
}

function tokens(chess) {
  const t = new Float32Array(64 * 12);
  const black = chess.turn() === 'b';
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p) continue;
      const f = FILES.indexOf(p.square[0]);
      let r = Number(p.square[1]) - 1;
      let white = p.color === 'w';
      if (black) { r = 7 - r; white = !white; }
      t[(r * 8 + f) * 12 + PIECE[p.type] + (white ? 0 : 6)] = 1;
    }
  }
  return t;
}

async function predict({ fen, elo, oppo, model, temperature }) {
  const s = await load(model);
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true });
  if (!legal.length) return { uci: null, probs: [] };
  const black = chess.turn() === 'b';
  const t0 = performance.now();
  const out = await s.run({
    tokens: new ort.Tensor('float32', tokens(chess), [1, 64, 12]),
    elo_self: new ort.Tensor('float32', new Float32Array([elo]), [1]),
    elo_oppo: new ort.Tensor('float32', new Float32Array([oppo ?? elo]), [1]),
  });
  const logits = out.logits_move.data;
  const v = out.logits_value.data;
  const cands = legal.map((m) => {
    const u = m.from + m.to + (m.promotion || '');
    const idx = INDEX.get(black ? mirrorMove(u) : u);
    return { uci: u, san: m.san, logit: idx == null ? -Infinity : Number(logits[idx]) };
  });
  const T = temperature > 0 ? temperature : 1;
  const mx = Math.max(...cands.map((c) => c.logit));
  let sum = 0;
  for (const c of cands) { c.p = Math.exp((c.logit - mx) / T); sum += c.p; }
  for (const c of cands) c.p /= sum;
  cands.sort((a, b) => b.p - a.p);
  let pick = cands[0];
  if (temperature > 0) {
    let x = Math.random();
    for (const c of cands) { x -= c.p; if (x <= 0) { pick = c; break; } }
  }
  const ev = Array.from(v).map(Number);
  const em = Math.max(...ev);
  const e = ev.map((z) => Math.exp(z - em));
  const es = e.reduce((a, b) => a + b, 0);
  return { uci: pick.uci, san: pick.san, ms: performance.now() - t0, wdl: e.map((z) => z / es), probs: cands.slice(0, 8).map((c) => ({ uci: c.uci, san: c.san, p: c.p })) };
}

onmessage = async (e) => {
  const { id, type, args } = e.data;
  try {
    if (type === 'load') { await load(args.model); postMessage({ id, ok: true, result: true }); return; }
    postMessage({ id, ok: true, result: await predict(args) });
  } catch (err) {
    postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
