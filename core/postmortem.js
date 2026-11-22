// Post-mortem d'une partie analysée (étude stratégique, point 2) : chaque gaffe, erreur ou occasion manquée
// du joueur devient un moment, avec la position, le coup joué, le coup du moteur et les caractéristiques
// de la position. Module sans DOM.
import { Chess } from '../vendor/chess.js';
import { MISTAKE_CLASSES } from './puzzle-mine.js';
import { featuresOf, playerMoves } from './strategic-profile.js';

const uciOf = (m) => m.from + m.to + (m.promotion || '');

// Suite de coups (UCI) jouée depuis `fen` : renvoie les coups chess.js (san, color), au plus `max`.
export function sanLine(fen, pv, max = 4) {
  const c = new Chess(fen), out = [];
  for (const u of pv.slice(0, max)) {
    try { out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] })); } catch { break; }
  }
  return out;
}

// a : enregistrement d'analyse { game, positions }. Renvoie { game, color, moments } ou null.
export function momentsOf(a, user, book = {}) {
  const pm = playerMoves(a, user, book);
  if (!pm) return null;
  const moments = [];
  pm.mv.forEach((m, i) => {
    const r = pm.res[i];
    if (m.color !== pm.color || !r || !MISTAKE_CLASSES.includes(r.cls)) return;
    const best = pm.pos[i].lines && pm.pos[i].lines[0];
    const line = best && best.pv && best.pv.length ? sanLine(m.before, best.pv) : [];
    moments.push({
      ply: i,
      moveNo: Math.floor(i / 2) + 1,
      fen: m.before,
      played: { san: m.san, uci: uciOf(m) },
      cls: r.cls,
      loss: Math.round(r.loss),
      best: line.length ? { uci: best.pv[0], line } : null,
      features: featuresOf(m.before, pm.color),
    });
  });
  return { game: pm.game, color: pm.color, moments };
}
