// Module « Ouvertures » — remplissage automatique d'un trou et scores du répertoire.
//
// Pour une position où vous jouez, chaque coup candidat (joué assez souvent à votre niveau) reçoit
// trois notes entre 0 et 1 :
//   - efficacité : score obtenu avec ce coup par les joueurs de votre niveau (base Lichess,
//     filtres de la roue ⚙) — 40 % ou moins = 0, 60 % ou plus = 1 ;
//   - solidité : évaluation (cloud Lichess, sinon Stockfish : Boost PC ou navigateur), comparée au
//     meilleur coup — 20 points de chances de gain perdus = 0 ;
//   - facilité : popularité (moyenne des bases Lichess et Masters), rapportée au coup le plus joué.
//     Un coup courant est plus facile à apprendre : la suite est connue et bien documentée.
// Le style répartit 6 points entre les trois ; le coup ajouté est celui de meilleure note pondérée.
// Les coups qui perdent plus de 25 points de chances de gain ne sont jamais proposés.
import { epd, winPct } from '../analysis.js';
import { local } from '../core/ui.js';
import { explore, moveFrequencies, expRatings, expSpeeds, lichessCfg } from '../core/lichess.js';
import { analyzePosition, cloudEval } from '../core/engine.js';
import { addMove, childrenOf, isActive, fenOf } from './openings.js';
import { covN } from './openings-coverage.js';
import { Chess } from '../vendor/chess.js';

function afterOf(p, uci) {
  try { const c = new Chess(fenOf(p)); c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); return epd(c.fen()); } catch { return null; }
}

export const CRITERIA = [
  ['eff', 'Efficacité', 'le coup qui rapporte le plus de points à votre niveau'],
  ['sound', 'Solidité', 'le coup le mieux évalué par le moteur'],
  ['learn', 'Facilité', 'le coup le plus joué, donc le plus simple à apprendre'],
];
export const STYLE_POINTS = 6;
export function fillStyle() {
  const v = String(local.get('fillStyle', '2,2,2')).split(',').map(Number);
  return v.length === 3 && v.every((x) => Number.isInteger(x) && x >= 0) && v.reduce((a, b) => a + b, 0) === STYLE_POINTS ? v : [2, 2, 2];
}
export const setFillStyle = (v) => local.set('fillStyle', v.join(','));

const clamp = (x) => Math.max(0, Math.min(1, x));
const MIN_N = 10; // parties minimum pour qu'un coup soit candidat
const MAX_CANDS = 5;
const EVAL_DEPTH = 16;
export const MAX_FILL_POSITIONS = 12; // positions où l'on choisit un coup, par remplissage
const MAX_FILL_PLY = 12; // demi-coups ajoutés au plus après le trou

const userScore = (m, color) => {
  const n = m.white + m.draws + m.black;
  return n ? ((color === 'w' ? m.white : m.black) + m.draws / 2) / n : null;
};

// Coups candidats d'une position (fen complète), avec leurs trois notes. Renvoie [] faute de données.
export async function rateMoves(fen) {
  const color = fen.split(' ')[1];
  const [li, ma] = await Promise.all([
    explore('lichess', fen, { ratings: expRatings(), speeds: expSpeeds(), moves: 12 }).catch(() => null),
    explore('masters', fen, { moves: 12 }).catch(() => null),
  ]);
  const tot = (j) => (j && j.moves ? j.moves.reduce((s, m) => s + m.white + m.draws + m.black, 0) : 0);
  const liT = tot(li), maT = tot(ma);
  const byUci = new Map();
  const add = (j, T, k) => {
    for (const m of (j && j.moves) || []) {
      const n = m.white + m.draws + m.black;
      const c = byUci.get(m.uci) || { uci: m.uci, san: m.san, liN: 0, maN: 0, liScore: null, maScore: null };
      c[k + 'N'] = n;
      c[k + 'P'] = T ? n / T : 0;
      c[k + 'Score'] = userScore(m, color);
      byUci.set(m.uci, c);
    }
  };
  add(li, liT, 'li');
  add(ma, maT, 'ma');
  const useLi = liT >= 50; // trop peu de parties à votre niveau : on prend les maîtres
  let cands = [...byUci.values()].filter((c) => (useLi ? c.liN : c.maN) >= MIN_N);
  if (!cands.length) return [];
  cands.forEach((c) => { c.pop = ((c.liP || 0) + (c.maP || 0)) / ((liT ? 1 : 0) + (maT ? 1 : 0) || 1); });
  cands.sort((a, b) => b.pop - a.pop);
  cands = cands.slice(0, MAX_CANDS);

  // évaluation : les 5 meilleures lignes, puis chaque candidat absent de ces lignes
  const wp = new Map();
  try {
    const r = await analyzePosition(fen, null, { cloud: true, multipv: 5, depth: EVAL_DEPTH });
    if (r && !r.miss) for (const l of r.lines) if (l.pv[0] && !wp.has(l.pv[0])) wp.set(l.pv[0], winPct(l.score, color));
    for (const c of cands) {
      if (wp.has(c.uci)) continue;
      const r2 = await analyzePosition(fen, c.uci, { cloud: true, depth: EVAL_DEPTH });
      if (r2 && !r2.miss && r2.played) wp.set(c.uci, winPct(r2.played.score, color));
    }
  } catch { /* moteur indisponible : solidité neutre */ }
  const best = wp.size ? Math.max(...wp.values()) : null;
  const maxPop = Math.max(...cands.map((c) => c.pop)) || 1;
  const out = [];
  for (const c of cands) {
    const w = wp.get(c.uci);
    if (best != null && w != null && best - w > 25) continue; // coup franchement mauvais
    const score = useLi ? c.liScore : c.maScore;
    out.push({
      uci: c.uci, san: c.san, n: useLi ? c.liN : c.maN, score, wp: w ?? null,
      eff: score == null ? 0.5 : clamp((score - 0.4) / 0.2),
      sound: best == null || w == null ? 0.5 : clamp(1 - (best - w) / 20),
      learn: clamp(c.pop / maxPop),
    });
  }
  return out;
}

export const weighted = (c, style) => (style[0] * c.eff + style[1] * c.sound + style[2] * c.learn) / STYLE_POINTS;

// Remplit le trou : à partir d'une position où vous jouez (epd), atteinte avec la probabilité p.
// Ajoute le meilleur coup selon le style, puis les réponses adverses assez fréquentes, et ainsi
// de suite (les branches les plus probables d'abord) jusqu'au seuil de couverture.
// Les coups ajoutés portent auto: true. Renvoie { added: [Edge], positions, stopped }.
export async function fillGap(rep, start, p, { style = fillStyle(), n = covN(), onProgress = null, isCancelled = () => false, rate = rateMoves, freqOf = (f) => moveFrequencies(f) } = {}) {
  if (rate === rateMoves && !lichessCfg.connected) throw new Error('Jeton Lichess requis (Paramètres → Connexion)');
  const threshold = 1 / n;
  const added = [];
  const add = (from, uci) => {
    const before = rep.edges.length;
    const e = addMove(rep, from, uci);
    if (e && rep.edges.length > before) { e.auto = true; added.push(e); }
    return e;
  };
  // Un coup adverse n'est ajouté qu'au moment où l'on prépare la réponse : si le remplissage
  // s'arrête avant (limite atteinte), il ne laisse pas de coup adverse sans réponse.
  const queue = [{ p: start, prob: p, ply: 0, opp: null }];
  let positions = 0, stopped = false;
  while (queue.length) {
    if (isCancelled()) { stopped = true; break; }
    queue.sort((a, b) => b.prob - a.prob);
    const { prob, ply, opp } = queue.shift();
    const pos = opp ? opp.after : start;
    if (prob < threshold || ply >= MAX_FILL_PLY) continue;
    const old = opp && childrenOf(rep, opp.from).find((x) => x.uci === opp.uci);
    if (old && !isActive(old)) continue; // coup adverse désactivé par l'utilisateur
    if (childrenOf(rep, pos).some(isActive)) { if (opp) add(opp.from, opp.uci); continue; } // déjà préparé (transposition)
    if (positions >= MAX_FILL_POSITIONS) { stopped = true; break; }
    positions++;
    if (onProgress) onProgress({ positions, added: added.length });
    const cands = await rate(fenOf(pos));
    if (!cands.length) continue; // aucun coup convenable : le coup adverse n'est pas ajouté
    cands.sort((a, b) => weighted(b, style) - weighted(a, style));
    if (opp && !add(opp.from, opp.uci)) continue;
    const mine = add(pos, cands[0].uci);
    if (!mine) continue;
    const f = await freqOf(fenOf(mine.fenAfter));
    if (!f) continue;
    for (const m of f.moves) {
      const q = prob * m.p;
      if (q < threshold) break; // trié par fréquence décroissante
      const after = afterOf(mine.fenAfter, m.uci);
      if (after) queue.push({ prob: q, ply: ply + 2, opp: { from: mine.fenAfter, uci: m.uci, after } });
    }
  }
  return { added, positions, stopped };
}

// Coups ajoutés automatiquement (encore présents).
export function autoEdges(rep) { return rep.edges.filter((e) => e.auto); }

// ------------------------------------------------------------------ scores du répertoire
// Moyenne des trois notes de vos coups, pondérée par la probabilité d'atteindre chaque position
// (même parcours que la couverture). La solidité utilise seulement l'évaluation cloud de Lichess
// (pas de Stockfish : trop long sur tout le répertoire) ; les positions sans évaluation cloud
// n'entrent pas dans cette moyenne.
const MAX_SCORE_POSITIONS = 40;
export async function repertoireScores(rep, { n = covN(), onProgress = null, isCancelled = () => false,
  freqOf = (f) => moveFrequencies(f, { background: true }),
  lichessOf = (f) => explore('lichess', f, { ratings: expRatings(), speeds: expSpeeds(), moves: 12, background: true }),
  cloudOf = (f) => cloudEval(f, 0, 5), injected = false } = {}) {
  if (!lichessCfg.connected && !injected) return null; // injected : sources de données fournies (tests)
  const threshold = 1 / n;
  const acc = { eff: [0, 0], sound: [0, 0], learn: [0, 0] };
  const stack = [{ p: epd(rep.root), prob: 1, ply: 0 }];
  const mineList = [];
  // 1) positions où vous jouez, avec leur probabilité
  while (stack.length) {
    if (isCancelled()) return null;
    stack.sort((a, b) => a.prob - b.prob);
    const { p, prob, ply } = stack.pop();
    if (prob < threshold || ply >= 30) continue;
    const active = childrenOf(rep, p).filter(isActive);
    if (!active.length) continue;
    if (p.split(' ')[1] === rep.color) {
      mineList.push({ p, prob, edges: active });
      if (mineList.length >= MAX_SCORE_POSITIONS) break;
      for (const e of active) stack.push({ p: e.fenAfter, prob: prob / active.length, ply: ply + 1 });
      continue;
    }
    const f = await freqOf(fenOf(p));
    for (const e of active) {
      const m = f && f.moves.find((x) => x.uci === e.uci);
      stack.push({ p: e.fenAfter, prob: f ? prob * (m ? m.p : 0) : prob / active.length, ply: ply + 1 });
    }
  }
  // 2) notes de vos coups
  let done = 0;
  for (const { p, prob, edges } of mineList) {
    if (isCancelled()) return null;
    const fen = fenOf(p);
    const color = fen.split(' ')[1];
    const li = await Promise.resolve(lichessOf(fen)).catch(() => null);
    const moves = (li && li.moves) || [];
    const maxN = Math.max(0, ...moves.map((m) => m.white + m.draws + m.black));
    let cl = null;
    try { cl = await cloudOf(fen); } catch { cl = null; }
    const cwp = new Map();
    if (cl && !cl.miss) for (const l of cl.lines) if (l.pv[0] && !cwp.has(l.pv[0])) cwp.set(l.pv[0], winPct(l.score, color));
    const best = cwp.size ? Math.max(...cwp.values()) : null;
    const w = prob / edges.length;
    for (const e of edges) {
      const m = moves.find((x) => x.uci === e.uci);
      const nn = m ? m.white + m.draws + m.black : 0;
      if (m && nn >= MIN_N) { acc.eff[0] += w * clamp((userScore(m, color) - 0.4) / 0.2); acc.eff[1] += w; }
      if (maxN) { acc.learn[0] += w * clamp(nn / maxN); acc.learn[1] += w; }
      // un coup hors des 5 lignes du cloud n'a pas d'évaluation : il n'entre pas dans la moyenne
      if (best != null && cwp.has(e.uci)) { acc.sound[0] += w * clamp(1 - (best - cwp.get(e.uci)) / 20); acc.sound[1] += w; }
    }
    done++;
    if (onProgress) onProgress(done, mineList.length);
  }
  const avg = ([s, t]) => (t ? s / t : null);
  return { eff: avg(acc.eff), sound: avg(acc.sound), learn: avg(acc.learn), positions: mineList.length };
}
