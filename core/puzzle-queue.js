// File de puzzles recommandés : d'abord ceux à revoir (cartes échues), puis des nouveaux.
// Fonction pure : les données (puzzles tirés des parties, puzzles d'ouverture, cartes) sont fournies par l'appelant.
import { isDue } from './srs.js';

function shuffle(a, rnd) {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Puzzles d'une source : échus (les plus en retard d'abord), puis nouveaux dans un ordre aléatoire.
export function sourceQueue(kind, { fresh, cards, now = Date.now(), rnd = Math.random }) {
  const due = [...cards.values()]
    .filter((r) => r.puzzle && r.puzzle.source === kind && isDue(r.card, now))
    .sort((a, b) => a.card.due - b.card.due)
    .map((r) => r.puzzle);
  const seen = new Set(cards.keys());
  const news = shuffle(fresh.filter((p) => !seen.has(p.id)), rnd);
  return { due, fresh: news };
}

// src : 'mistake' | 'opening' | 'mix' (moitié-moitié, l'une complète l'autre si elle manque de puzzles).
export function buildQueue({ src = 'mix', size = 10, mined = [], openings = [], cards = new Map(), now = Date.now(), rnd = Math.random }) {
  const m = sourceQueue('mistake', { fresh: mined, cards, now, rnd });
  const o = sourceQueue('opening', { fresh: openings, cards, now, rnd });
  const flat = (q) => [...q.due, ...q.fresh];
  let out;
  if (src === 'mistake') out = flat(m);
  else if (src === 'opening') out = flat(o);
  else {
    const a = flat(m), b = flat(o);
    out = [];
    for (let i = 0; out.length < a.length + b.length; i++) { // alterne, une erreur puis une ouverture
      if (i < a.length) out.push(a[i]);
      if (i < b.length) out.push(b[i]);
    }
  }
  return out.slice(0, size);
}
