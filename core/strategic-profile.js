// Profil stratégique (étude stratégique, point 1) : pour chaque caractéristique structurelle de la position
// (paire de fous, pion isolé…), le taux de gaffes, erreurs et occasions manquées du joueur quand cette
// caractéristique est présente au moment de jouer.
//
// Indicatif : une corrélation dans ses parties, pas une cause. Une caractéristique n'est retenue qu'à partir
// de MIN_SAMPLE coups où elle est présente. Module sans DOM : utilisable hors navigateur.
import { Chess } from '../vendor/chess.js';
import { classifyGame } from '../analysis.js';
import { MISTAKE_CLASSES } from './puzzle-mine.js';

export const MIN_SAMPLE = 30;
export const FEATURE_LABEL = {
  bishop_pair: 'Paire de fous',
  isolated_pawn: 'Pion isolé',
  doubled_pawn: 'Pions doublés',
  passed_pawn: 'Pion passé',
  open_file: 'Colonne ouverte',
  rook_semi_open: 'Tour sur colonne semi-ouverte',
  material_ahead: 'Avance matérielle (2 points ou plus)',
  material_behind: 'Retard matériel (2 points ou plus)',
};
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

// Caractéristiques présentes du point de vue de `color` dans la position `fen`.
export function featuresOf(fen, color) {
  const pieces = [];
  new Chess(fen).board().forEach((row, i) => row.forEach((p, f) => {
    if (p) pieces.push({ type: p.type, color: p.color, f, r: 7 - i });
  }));
  const mine = pieces.filter((p) => p.color === color);
  const theirs = pieces.filter((p) => p.color !== color);
  const filesOf = (list) => {
    const n = Array(8).fill(0);
    for (const p of list) if (p.type === 'p') n[p.f]++;
    return n;
  };
  const myFiles = filesOf(mine), theirFiles = filesOf(theirs);
  const myPawns = mine.filter((p) => p.type === 'p');
  const theirPawns = theirs.filter((p) => p.type === 'p');
  const out = [];
  const bishops = (list) => list.filter((p) => p.type === 'b').length;
  if (bishops(mine) >= 2 && bishops(theirs) < 2) out.push('bishop_pair');
  if (myPawns.some((p) => !(myFiles[p.f - 1] > 0) && !(myFiles[p.f + 1] > 0))) out.push('isolated_pawn');
  if (myFiles.some((n) => n >= 2)) out.push('doubled_pawn');
  // Passé : aucun pion adverse sur la même colonne ou une colonne voisine, devant lui.
  if (myPawns.some((p) => !theirPawns.some((e) => Math.abs(e.f - p.f) <= 1 && (color === 'w' ? e.r > p.r : e.r < p.r)))) out.push('passed_pawn');
  if (myFiles.some((n, f) => n === 0 && theirFiles[f] === 0)) out.push('open_file');
  if (mine.some((p) => p.type === 'r' && myFiles[p.f] === 0 && theirFiles[p.f] > 0)) out.push('rook_semi_open');
  const mat = (list) => list.reduce((s, p) => s + (VALUE[p.type] || 0), 0);
  const diff = mat(mine) - mat(theirs);
  if (diff >= 2) out.push('material_ahead');
  if (diff <= -2) out.push('material_behind');
  return out;
}

// Verdict pour une caractéristique : n coups où elle est présente, `rate` = part de gaffes/erreurs/occasions
// manquées sur ces coups, `base` = part sur l'ensemble des coups du joueur.
export function verdictOf(n, rate, base) {
  if (n < MIN_SAMPLE) return 'insuffisant';
  if (base === 0) return rate > 0 ? 'faiblesse' : 'neutre';
  const ratio = rate / base;
  return ratio >= 1.25 ? 'faiblesse' : ratio <= 0.75 ? 'force' : 'neutre';
}

// Coups du joueur dans une partie analysée. null si la partie n'est pas exploitable
// (pseudo absent, PGN illisible, analyse incomplète).
export function playerMoves(a, user, book = {}) {
  if (!a || !a.game || !a.positions || !a.game.pgn) return null;
  const u = String(user || '').toLowerCase();
  const g = a.game;
  const color = (g.white && g.white.name || '').toLowerCase() === u ? 'w'
    : (g.black && g.black.name || '').toLowerCase() === u ? 'b' : null;
  if (!color) return null;
  let mv;
  try {
    const c = new Chess();
    c.loadPgn(g.pgn);
    mv = c.history({ verbose: true });
  } catch { return null; }
  const pos = a.positions.slice(0, mv.length);
  if (!mv.length || !pos.every(Boolean)) return null;
  const res = classifyGame(mv, pos, { w: g.white.rating, b: g.black.rating }, book);
  return { game: g, color, mv, pos, res };
}

// Profil : `rows` = store.all('analysis').
export function buildProfile(rows, user, book = {}) {
  const tally = {};
  for (const k of Object.keys(FEATURE_LABEL)) tally[k] = { n: 0, m: 0 };
  const games = [];
  let moves = 0, mistakes = 0;
  for (const r of rows) {
    let pm = null;
    try { pm = playerMoves(r.data, user, book); } catch { pm = null; }
    if (!pm) continue;
    let gm = 0;
    pm.mv.forEach((m, i) => {
      if (m.color !== pm.color || !pm.res[i]) return;
      const bad = MISTAKE_CLASSES.includes(pm.res[i].cls);
      moves++;
      if (bad) { mistakes++; gm++; }
      for (const f of featuresOf(m.before, pm.color)) {
        tally[f].n++;
        if (bad) tally[f].m++;
      }
    });
    games.push({ id: pm.game.id, white: pm.game.white && pm.game.white.name || '', black: pm.game.black && pm.game.black.name || '', mistakes: gm });
  }
  const base = moves ? mistakes / moves : 0;
  const features = Object.keys(FEATURE_LABEL).map((key) => {
    const { n, m } = tally[key];
    const rate = n ? m / n : 0;
    return { key, label: FEATURE_LABEL[key], n, mistakes: m, rate, verdict: verdictOf(n, rate, base) };
  });
  return {
    games,
    moves,
    mistakes,
    base,
    features,
    strengths: features.filter((f) => f.verdict === 'force'),
    weaknesses: features.filter((f) => f.verdict === 'faiblesse'),
    insufficient: features.filter((f) => f.verdict === 'insuffisant' && f.n > 0),
  };
}
