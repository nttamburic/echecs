// Manu AI, version web : nature d'une erreur (tactique ou stratégique). Module pur, sans DOM.
//
// classifyError({ fen, playedUci, bestPv, refutationPv }) :
//   fen          position avant l'erreur
//   playedUci    coup joué
//   bestPv       meilleure suite du moteur depuis `fen`
//   refutationPv suite du moteur après le coup joué (facultative)
// Renvoie { kind: 'tactique', motif, suite: 'meilleure' | 'jouee' } ou { kind: 'strategique' }.
// Le motif retenu est le plus précoce des deux suites ; à égalité, celui de la meilleure suite.
import { detectMotifs } from './motifs.js';

export const HORIZON = 6; // demi-coups

function premier(fen, pv) {
  return detectMotifs(fen, pv.slice(0, HORIZON))[0] || null;
}

export function classifyError({ fen, playedUci, bestPv = [], refutationPv = [] }) {
  const best = premier(fen, bestPv);
  const played = premier(fen, [playedUci, ...refutationPv]);
  if (best && (!played || best.coups.length <= played.coups.length)) return { kind: 'tactique', motif: best, suite: 'meilleure' };
  if (played) return { kind: 'tactique', motif: played, suite: 'jouee' };
  return { kind: 'strategique' };
}
