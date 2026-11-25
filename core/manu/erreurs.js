import { Chess } from '../../vendor/chess.js';
import { classifyGame, epd, materialTrace } from '../../analysis.js';
import { uciOf } from '../ui.js';
import { detecterThemes, themeFiable } from './zero/themes.js';

export const SEUILS_ERREURS = Object.freeze({ seuilCp: 150, fourchetteCp: 300 });
export const PHASES = ['ouverture', 'milieu', 'finale'];
// Un thème ne rend l'erreur tactique que s'il apparaît dans les 6 premiers demi-coups de B ou R
// (même fenêtre que l'écart matériel ; décision utilisateur du 2026-11-25).
export const FENETRE_THEMES = 6;
const exclus = new Set(['trappedPiece', 'quietMove', 'defensiveMove', 'promotion', 'underPromotion']);

export const scoreJoueur = (score, color) => color === 'w' ? score :
  score.mate != null ? { mate: -score.mate } : { cp: -score.cp };

export function phase(fen, precedente = 'ouverture') {
  if (precedente === 'finale') return precedente;
  const grille = new Chess(fen).board();
  const pieces = grille.flat().filter(p => p && 'qrbn'.includes(p.type)).length;
  if (pieces <= 6) return 'finale';
  if (precedente === 'milieu' || pieces <= 10 || grille[0].filter(p => p?.color === 'b').length < 4 ||
      grille[7].filter(p => p?.color === 'w').length < 4) return 'milieu';
  return 'ouverture';
}

function detailsLigne(fen, pv, nom, precedent) {
  const chess = new Chess(fen);
  const joues = [];
  let mat = null;
  for (const uci of pv.slice(0, 10)) {
    try { chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); }
    catch { break; }
    joues.push(uci);
    if (chess.isCheckmate()) { mat = { ligne: nom, demiCoup: joues.length }; break; }
  }
  const trace = materialTrace(fen, joues, 8);
  const index = trace.findIndex((gain, i) => i < 6 && i + 2 < trace.length && Math.abs(gain) >= 2 &&
    trace.slice(i + 1, i + 3).every(suite => Math.sign(suite) === Math.sign(gain) && Math.abs(suite) >= 2));
  const materiel = index < 0 ? null : { ligne: nom, demiCoup: index + 1, ecart: trace[index] };
  const baseThemes = nom === 'R' && joues.length ? new Chess(fen) : null;
  if (baseThemes) baseThemes.move(joues[0]);
  const themes = detecterThemes(baseThemes?.fen() ?? fen, baseThemes ? joues.slice(1) : joues,
    baseThemes ? { coupAdversePrecedent: joues[0], fenAvantCoupAdverse: fen } :
      { coupAdversePrecedent: precedent && uciOf(precedent), fenAvantCoupAdverse: precedent?.before })
    .filter(t => themeFiable(t.theme) && !exclus.has(t.theme)).map(t => ({ ...t, ligne: nom,
      demiCoup: t.demiCoup + (baseThemes ? 2 : 1) }))
    .filter(t => t.demiCoup <= FENETRE_THEMES);
  return { mat, materiel, themes };
}

export function estTactique(fen, B, R, precedent = null) {
  const lignes = [detailsLigne(fen, B, 'B', precedent), detailsLigne(fen, R, 'R')];
  const mat = lignes.flatMap(l => l.mat ? [l.mat] : []);
  const materiel = lignes.flatMap(l => l.materiel ? [l.materiel] : []);
  const themes = lignes.flatMap(l => l.themes);
  return { tactique: Boolean(mat.length || materiel.length || themes.length), mat, materiel, themes };
}

export function erreursReglages(lire) {
  return Object.fromEntries(Object.entries(SEUILS_ERREURS).map(([k, defaut]) => {
    const n = Number(lire(k, defaut));
    return [k, Number.isSafeInteger(n) && n > 0 ? n : defaut];
  }));
}

export function releverErreurs(analysis, user, book = {}, { seuilCp = 150, fourchetteCp = 300 } = {}) {
  const game = analysis?.game;
  const pseudo = String(user ?? '').trim().toLowerCase();
  if (!game?.pgn || !pseudo || !Array.isArray(analysis.positions)) return [];
  const color = game.white?.name?.toLowerCase() === pseudo ? 'w' : game.black?.name?.toLowerCase() === pseudo ? 'b' : null;
  if (!color) return [];
  const chess = new Chess();
  try { chess.loadPgn(game.pgn); } catch { return []; }

  const moves = chess.history({ verbose: true });
  const positions = analysis.positions;
  const classes = classifyGame(moves, positions, { w: game.white?.rating, b: game.black?.rating }, book);
  const out = [];
  let phaseCourante = 'ouverture';
  for (const [ply, coup] of moves.entries()) {
    phaseCourante = phase(coup.before, phaseCourante);
    if (coup.color !== color || book[epd(coup.after)]) continue;
    const best = positions[ply]?.lines?.[0], played = positions[ply]?.played;
    const signe = color === 'w' ? 1 : -1;
    if (!Number.isFinite(best?.score?.cp) || best.score.mate != null || Math.abs(best.score.cp) > fourchetteCp || !played?.score) continue;
    const perdMat = played.score.mate != null && signe * played.score.mate < 0;
    if (!perdMat && (played.score.mate != null || !Number.isFinite(played.score.cp))) continue;
    const ecartCp = perdMat ? seuilCp : signe * (best.score.cp - played.score.cp);
    if (ecartCp < seuilCp || !best.pv?.length) continue;
    const joue = uciOf(coup);
    const R = [joue, ...(positions[ply + 1]?.lines?.[0]?.pv ?? [])];
    out.push({ id: 'g:' + game.id + ':' + (ply + 1), ply, numero: Number(coup.before.split(' ')[5]),
      fen: coup.before, color, joue, san: coup.san, meilleur: best.pv[0], phase: phaseCourante,
      gravite: classes[ply]?.cls ?? null, avant: scoreJoueur(best.score, color),
      apres: scoreJoueur(played.score, color), ecartCp, perdMat,
      B: best.pv, R, ...estTactique(coup.before, best.pv, R, moves[ply - 1]) });
  }
  return out;
}
