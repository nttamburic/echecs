// Bot « humain » Maia3 (CSSLab, AGPL-3.0), exécuté dans un Worker avec onnxruntime-web.
// Le modèle (5M = 10 Mo, 23M = 44 Mo) n'est téléchargé qu'à la première partie, puis mis en cache.
import { local, isMobile } from './ui.js';

export const MAIA_MODELS = [['5m', 'Maia3 5M (10 Mo, plus léger)'], ['23m', 'Maia3 23M (44 Mo, plus humain)']];
export const maiaModel = () => { const m = local.get('maiaModel'); return MAIA_MODELS.some(([k]) => k === m) ? m : (isMobile() ? '5m' : '23m'); };

let worker = null;
let seq = 0;
const pending = new Map();
let onProgress = null;

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./maia-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const d = e.data;
    if (d.type === 'progress') { if (onProgress) onProgress(d); return; }
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.ok) p.resolve(d.result); else p.reject(new Error(d.error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Maia : erreur du worker'));
    pending.clear();
    worker = null;
  };
  return worker;
}

function call(type, args) {
  const w = getWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); w.postMessage({ id, type, args }); });
}

export function setMaiaProgress(f) { onProgress = f; }
export const loadMaia = (model = maiaModel()) => call('load', { model });
// Coup de Maia pour « fen » au niveau « elo » : tirage selon les probabilités du modèle (température 1 = jeu humain).
export const maiaMove = (fen, elo, { model = maiaModel(), temperature = 1, oppo = null } = {}) => call('predict', { fen, elo, oppo, model, temperature });
