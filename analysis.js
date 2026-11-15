// Classement des coups, précision et Elo estimé.
import { Chess } from './vendor/chess.js';

export const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// Chances de gain (formule Lichess), en %, pour un score en centipions du point de vue d'un joueur.
export function winPctFromCp(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

// Score {cp}|{mate} du point de vue des Blancs -> chances de gain du camp `color` ('w'|'b').
export function winPct(score, color) {
  if (!score) return 50;
  let w;
  if (score.mate !== undefined) w = score.mate > 0 ? 100 : score.mate < 0 ? 0 : 50;
  else w = winPctFromCp(score.cp);
  return color === 'w' ? w : 100 - w;
}

export function moveAccuracy(loss) {
  const a = 103.1668 * Math.exp(-0.04354 * loss) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

export function gameAccuracy(accs) {
  if (!accs.length) return null;
  const mean = accs.reduce((s, a) => s + a, 0) / accs.length;
  const harmonic = accs.length / accs.reduce((s, a) => s + 1 / Math.max(1, a), 0);
  return 0.3 * mean + 0.7 * harmonic;
}

// Elo estimé à partir de la précision de la partie (interpolation linéaire, approximative).
const ELO_TABLE = [[0, 100], [40, 400], [55, 700], [65, 1000], [72, 1250], [78, 1500], [83, 1750], [87, 2000], [90, 2250], [93, 2500], [95, 2700], [97, 2900], [99, 3150], [100, 3300]];
export function estimateElo(acc) {
  if (acc == null) return null;
  for (let i = 1; i < ELO_TABLE.length; i++) {
    const [a1, e1] = ELO_TABLE[i];
    const [a0, e0] = ELO_TABLE[i - 1];
    if (acc <= a1) return Math.round((e0 + (e1 - e0) * (acc - a0) / (a1 - a0)) / 25) * 25;
  }
  return 3300;
}

export const CLASSES = {
  brilliant: { label: 'Brillant', sym: '!!', color: '#1baaa6', order: 0 },
  great: { label: 'Très bon', sym: '!', color: '#5c8bb0', order: 1 },
  best: { label: 'Meilleur', sym: '★', color: '#81b64c', order: 2 },
  excellent: { label: 'Excellent', sym: '👍', color: '#96bc4b', order: 3 },
  good: { label: 'Bon', sym: '✓', color: '#95b776', order: 4 },
  book: { label: 'Théorie', sym: '📖', color: '#a88865', order: 5 },
  inaccuracy: { label: 'Imprécision', sym: '?!', color: '#f7c631', order: 6 },
  mistake: { label: 'Erreur', sym: '?', color: '#ffa459', order: 7 },
  miss: { label: 'Occasion manquée', sym: '✗', color: '#ff7769', order: 8 },
  blunder: { label: 'Gaffe', sym: '??', color: '#fa412d', order: 9 },
};
export const SUMMARY_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];

export function thresholds(rating) {
  const f = rating && rating < 1400 ? 1.25 : 1; // un peu plus indulgent sous 1400 Elo
  return { excellent: 2.5 * f, good: 6 * f, inaccuracy: 12 * f, mistake: 22 * f };
}

function material(chess) {
  let w = 0, b = 0;
  for (const row of chess.board()) for (const sq of row) if (sq) { if (sq.color === 'w') w += VALUES[sq.type]; else b += VALUES[sq.type]; }
  return { w, b };
}
const balanceFor = (chess, color) => { const m = material(chess); return color === 'w' ? m.w - m.b : m.b - m.w; };

function playUci(chess, u) {
  try { return chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { return null; }
}

// Bilan matériel le long d'une ligne, du point de vue de celui qui joue le 1er coup.
// Renvoie les bilans après chaque demi-coup (relatifs au départ).
export function materialTrace(fen, pv, plies = 8) {
  const c = new Chess(fen);
  const color = c.turn();
  const base = balanceFor(c, color);
  const out = [];
  for (const u of pv.slice(0, plies)) {
    if (!playUci(c, u)) break;
    out.push(balanceFor(c, color) - base);
  }
  return out;
}

// Gain matériel net de la ligne, mesuré après un coup de l'adversaire (position "calme").
export function materialGain(fen, pv, plies = 8) {
  const t = materialTrace(fen, pv, plies);
  if (!t.length) return 0;
  // on prend la dernière valeur après un coup adverse (indice impair) si possible
  for (let i = t.length - 1; i >= 0; i--) if (i % 2 === 1) return t[i];
  return t[t.length - 1];
}

// Sacrifice : après un de NOS coups suivants, on a au moins 2 points de matériel de moins qu'au départ.
export function isSacrifice(fen, pv) {
  const t = materialTrace(fen, pv, 8);
  for (let i = 2; i < t.length; i += 2) if (t[i] <= -2) return true;
  // ligne courte : la pièce est prise et rien ne la reprend
  if (t.length === 2 && t[1] <= -2) return true;
  return false;
}

// Prise "évidente" : on prend une pièce non défendue, ou d'une valeur au moins égale à la pièce qui prend.
function obviousCapture(fen, uci) {
  const c = new Chess(fen);
  const m = playUci(c, uci);
  if (!m || !m.captured) return false;
  if (VALUES[m.captured] >= VALUES[m.piece]) return true;
  const b = new Chess(fen);
  let defenders = [];
  try { defenders = b.attackers(m.to, m.color === 'w' ? 'b' : 'w'); } catch { /* ignore */ }
  return defenders.length === 0;
}

export function epd(fen) { return fen.split(' ').slice(0, 4).join(' '); }

// Classe un coup.
// ctx: { fenBefore, fenAfter, uci, color, rating, pos (analyse de la position avant), prevMove (verbose move précédent), prevClass, book (Map epd), nLegal }
export function classifyMove(ctx) {
  const { pos, color, uci } = ctx;
  if (!pos || !pos.lines || !pos.lines.length || !pos.played) return null;
  const best = pos.lines[0];
  const second = pos.lines[1];
  const winBefore = winPct(best.score, color);
  let winAfter = winPct(pos.played.score, color);
  const isBest = best.pv[0] === uci;
  if (isBest) winAfter = winBefore;
  const loss = Math.max(0, winBefore - winAfter);
  const acc = moveAccuracy(loss);
  const T = thresholds(ctx.rating);
  const base = { loss, acc, winBefore, winAfter, bestUci: best.pv[0], isBest, tablebase: pos.source === 'tablebase' };

  if (ctx.book && ctx.book[epd(ctx.fenAfter)]) return { ...base, cls: 'book' };

  if (ctx.nLegal === 1) return { ...base, cls: 'best', forced: true };

  if (loss < T.excellent) {
    // Brillant : sacrifice correct, pas déjà totalement gagnant, et position toujours bonne ensuite.
    if (winBefore <= 90 && winAfter >= 50 && isSacrifice(ctx.fenBefore, pos.played.pv)) {
      return { ...base, cls: 'brilliant' };
    }
    if (isBest && second) {
      const gap = winBefore - winPct(second.score, color);
      const recapture = ctx.prevMove && ctx.prevMove.captured && uci.slice(2, 4) === ctx.prevMove.to;
      if (gap >= 20 && winBefore >= 30 && winBefore <= 95 && !recapture && !obviousCapture(ctx.fenBefore, uci)) {
        return { ...base, cls: 'great', gap };
      }
    }
    if (isBest || loss <= 0.3) return { ...base, cls: 'best' };
    return { ...base, cls: 'excellent' };
  }
  if (loss < T.good) return { ...base, cls: 'good' };
  if (loss < T.inaccuracy) return { ...base, cls: 'inaccuracy' };

  // Occasion manquée : le meilleur coup gagnait du matériel ou matait, et on reste dans une position jouable.
  const bestMates = best.score.mate !== undefined && (color === 'w' ? best.score.mate > 0 : best.score.mate < 0);
  const tactical = bestMates || materialGain(ctx.fenBefore, best.pv) >= 2;
  if (tactical && winAfter >= 35 && winBefore >= 60) return { ...base, cls: 'miss' };

  if (loss < T.mistake) return { ...base, cls: 'mistake' };
  return { ...base, cls: 'blunder' };
}

// Classe toute la partie. moves = historique verbose chess.js, positions[i] = analyse avant le coup i.
export function classifyGame(moves, positions, ratings, book) {
  const out = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const color = m.color;
    const nLegal = new Chess(m.before).moves().length;
    const r = classifyMove({
      fenBefore: m.before, fenAfter: m.after, uci: m.from + m.to + (m.promotion || ''), color,
      rating: ratings[color], pos: positions[i], prevMove: moves[i - 1] || null, book, nLegal,
    });
    out.push(r);
  }
  return out;
}

export function summarize(moves, results, ratings = null) {
  const s = { w: { counts: {}, accs: [], contested: [] }, b: { counts: {}, accs: [], contested: [] } };
  results.forEach((r, i) => {
    if (!r) return;
    const c = moves[i].color;
    s[c].counts[r.cls] = (s[c].counts[r.cls] || 0) + 1;
    s[c].accs.push(r.acc);
    // Pour l'Elo estimé on ne garde que les coups hors théorie joués quand la partie était encore disputée :
    // dans une position déjà gagnée ou perdue, presque tous les coups paraissent "parfaits".
    // On écarte aussi les coups forcés et les finales jouées d'après les tables (décisions triviales).
    if (r.cls !== 'book' && !r.forced && !r.tablebase && r.winBefore >= 3 && r.winBefore <= 97) s[c].contested.push(r.acc);
  });
  for (const c of ['w', 'b']) {
    s[c].accuracy = gameAccuracy(s[c].accs);
    const n = s[c].contested.length;
    if (n >= 8) {
      let elo = estimateElo(gameAccuracy(s[c].contested));
      // Peu de coups disputés = estimation peu fiable : on la rapproche du classement réel du joueur.
      const rating = ratings && ratings[c];
      const K = 15;
      if (rating) elo = Math.round((n * elo + K * rating) / (n + K) / 25) * 25;
      s[c].elo = elo;
    } else s[c].elo = null;
  }
  return s;
}

// Score lisible : +1.25, -0.40, M3, -M2
export function fmtScore(score) {
  if (!score) return '';
  if (score.mate !== undefined) return score.mate === 0 ? '#' : (score.mate > 0 ? 'M' : '-M') + Math.abs(score.mate);
  if (score.tb && Math.abs(score.cp) > 5000) return score.cp > 0 ? 'Gain (TB)' : 'Perte (TB)';
  const v = score.cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(2);
}
