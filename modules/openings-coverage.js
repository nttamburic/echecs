// Module « Ouvertures » — couverture du répertoire et trous.
//
// On part de la racine avec une probabilité 1 et on descend :
//   - position où joue l'adversaire : chaque coup réellement joué à votre niveau (explorateur
//     Lichess, voir moveFrequencies) reçoit sa part de probabilité. Un coup assez fréquent que le
//     répertoire ne prévoit pas est un TROU (« 1…c5 : 25 % de vos parties, sans réponse ») ;
//   - position où vous jouez : on suit vos coups actifs (la probabilité est partagée entre eux) ;
//     si le répertoire n'y a aucun coup, c'est aussi un trou (la ligne s'arrête trop tôt).
// On s'arrête quand la probabilité passe sous le seuil (par défaut une partie sur 150) ou à
// MAX_PLY demi-coups. Couverture = part de la probabilité qui ne tombe pas dans un trou : les
// coups adverses sous le seuil comptent comme couverts (inutile de les préparer).
// Une position adverse sans statistiques n'est pas évaluée (ni couverte ni trou).
import { Chess } from '../vendor/chess.js';
import { epd } from '../analysis.js';
import { local } from '../core/ui.js';
import { moveFrequencies, lichessCfg, expRatings, expSpeeds } from '../core/lichess.js';
import { childrenOf, isActive, fenOf } from './openings.js';

export const MAX_PLY = 30;
export const THRESHOLDS = [50, 100, 150, 300, 500]; // « positions vues dans 1 partie sur N »
export const covN = () => { const n = Number(local.get('covThreshold', '150')); return THRESHOLDS.includes(n) ? n : 150; };

const turnOf = (p) => p.split(' ')[1];

// Signature : tout ce qui change le résultat (coups actifs, seuil, filtres de l'explorateur).
export function coverageKey(rep, n = covN()) {
  const edges = rep.edges.filter(isActive).map((e) => `${e.fenBefore}|${e.uci}`).sort().join(';');
  return `${rep.root}#${edges}#${n}#${expRatings().join(',')}#${expSpeeds().join(',')}`;
}

function sanOf(p, uci) {
  try { const c = new Chess(fenOf(p)); return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san; } catch { return uci; }
}

// Calcule la couverture. freqOf(fen) → Promise<{ moves: [{ uci, san, p }] } | null> (par défaut
// l'explorateur Lichess, en tâche de fond). onProgress(done, todo) pendant le calcul.
// Renvoie { coverage (0..1), gaps: [{ epd, p, path: [Edge], opp: { uci, san } | null }],
//           positions, unknown (probabilité non évaluée faute de données) }
// ou { unavailable: true } sans jeton Lichess.
export async function computeCoverage(rep, { n = covN(), freqOf = null, onProgress = null, isCancelled = () => false } = {}) {
  if (!freqOf && !lichessCfg.connected) return { unavailable: true };
  const freq = freqOf || ((fen) => moveFrequencies(fen, { background: true }));
  const threshold = 1 / n;
  const gaps = [];
  let covered = 0, unknown = 0, positions = 0, done = 0, todo = 1;
  // parcours en profondeur, les branches les plus probables d'abord
  const stack = [{ p: epd(rep.root), prob: 1, ply: 0, path: [] }];
  while (stack.length) {
    if (isCancelled()) return null;
    const { p, prob, ply, path } = stack.pop();
    if (prob < threshold || ply >= MAX_PLY) { covered += prob; continue; }
    positions++;
    const kids = childrenOf(rep, p);
    const active = kids.filter(isActive);
    if (turnOf(p) === rep.color) {
      if (!active.length) {
        if (kids.length) { covered += prob; continue; } // coups tous désactivés : choix de l'utilisateur
        gaps.push({ epd: p, p: prob, path, opp: null });
        continue;
      }
      for (const e of active) stack.push({ p: e.fenAfter, prob: prob / active.length, ply: ply + 1, path: [...path, e] });
      continue;
    }
    // l'adversaire joue
    const f = await freq(fenOf(p));
    done++;
    if (onProgress) onProgress(done, todo);
    if (!f || !f.moves || !f.moves.length) {
      // pas de statistiques : on suit seulement les coups du répertoire, à parts égales
      if (!active.length) { unknown += prob; continue; }
      for (const e of active) stack.push({ p: e.fenAfter, prob: prob / active.length, ply: ply + 1, path: [...path, e], opp: true });
      todo += active.filter((e) => childrenOf(rep, e.fenAfter).some(isActive)).length;
      continue;
    }
    const next = [];
    let frequent = 0;
    for (const m of f.moves) {
      const q = prob * m.p;
      if (q < threshold) continue; // trop rare : le répertoire n'a pas à aller plus loin
      frequent += q;
      const e = active.find((x) => x.uci === m.uci);
      if (e) next.push({ p: e.fenAfter, prob: q, ply: ply + 1, path: [...path, e] });
      else if (!kids.some((x) => x.uci === m.uci)) gaps.push({ epd: p, p: q, path, opp: { uci: m.uci, san: m.san || sanOf(p, m.uci) } });
      else covered += q; // coup adverse prévu mais désactivé
    }
    covered += Math.max(0, prob - frequent); // coups rares (sous le seuil) : rien à préparer
    next.sort((a, b) => a.prob - b.prob); // le plus probable en haut de la pile
    stack.push(...next);
    todo += next.length;
  }
  const gapMass = gaps.reduce((s, g) => s + g.p, 0);
  gaps.sort((a, b) => b.p - a.p);
  const total = covered + gapMass;
  const coverage = total ? covered / total : 0;
  return { coverage: coverage < 1e-9 ? 0 : Math.min(1, coverage), gaps, positions, unknown, n };
}

// Cache par répertoire (mémoire), invalidé dès que la signature change.
const cache = new Map(); // id → { key, res }
const running = new Map(); // id → { key, promise }
export function cachedCoverage(rep) {
  const c = cache.get(rep.id);
  return c && c.key === coverageKey(rep) ? c.res : null;
}
export function coverageOf(rep, opts = {}) {
  const key = coverageKey(rep);
  const c = cache.get(rep.id);
  if (c && c.key === key) return Promise.resolve(c.res);
  const r = running.get(rep.id);
  if (r && r.key === key) return r.promise;
  const snapshot = { ...rep, edges: rep.edges.map((e) => ({ ...e })) };
  // enregistré AVANT de lancer le calcul : il vérifie dès son premier pas qu'il est toujours le bon
  const entry = { key, promise: null };
  running.set(rep.id, entry);
  const mine = () => running.get(rep.id) === entry;
  entry.promise = computeCoverage(snapshot, { ...opts, isCancelled: () => !mine() }).then((res) => {
    if (mine()) { running.delete(rep.id); if (res) cache.set(rep.id, { key, res }); }
    return res;
  }, (err) => { if (mine()) running.delete(rep.id); throw err; });
  return entry.promise;
}

export const pct = (x) => (x >= 0.995 ? '100 %' : x < 0.005 && x > 0 ? '< 1 %' : `${Math.round(x * 100)} %`);
