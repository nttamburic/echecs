// « Mes finales » : les fautes commises en finale dans vos parties analysées (sans DOM, testé avec node).
// La finale commence comme dans « Erreurs stratégiques » (6 pièces au maximum hors rois et pions).
// Contrairement à ce module, toutes les fautes sont gardées : tactiques ou non, y compris dans les
// positions déjà nettement gagnantes ou perdantes. Seules les inexactitudes sont ignorées.
import { Chess } from '../vendor/chess.js';
import { classifyGame } from '../analysis.js';
import { uciOf } from './ui.js';
import { phase, scoreJoueur } from './manu/erreurs.js';
import { dansPeriode, periodeStrategie } from './manu/strategie.js';

export const TYPES_FINALES = Object.freeze({ pions: 'Pions', tours: 'Tours', mineures: 'Pièces mineures', dame: 'Dame', mixte: 'Mixte' });
export const FAUTES = Object.freeze(['mistake', 'miss', 'blunder']);

// Type de finale d'après les pièces des deux camps, hors rois et pions.
export function typeFinale(fen) {
  const familles = new Set();
  for (const p of fen.split(' ')[0].toLowerCase()) {
    if (p === 'r') familles.add('tours');
    else if (p === 'b' || p === 'n') familles.add('mineures');
    else if (p === 'q') familles.add('dame');
  }
  return familles.size === 0 ? 'pions' : familles.size === 1 ? [...familles][0] : 'mixte';
}

export function releverFinales(analysis, user, book = {}) {
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
    if (phaseCourante !== 'finale' || coup.color !== color || !FAUTES.includes(classes[ply]?.cls)) continue;
    const meilleur = positions[ply]?.lines?.[0], joue = positions[ply]?.played;
    if (!meilleur?.pv?.length || !meilleur.score) continue;
    // identifiant préfixé « f: » : archiver ici ne retire rien de « Erreurs stratégiques »
    out.push({ id: 'f:' + game.id + ':' + (ply + 1), ply, numero: Number(coup.before.split(' ')[5]),
      fen: coup.before, color, joue: uciOf(coup), san: coup.san, meilleur: meilleur.pv[0],
      type: typeFinale(coup.before), gravite: classes[ply].cls,
      avant: scoreJoueur(meilleur.score, color), apres: joue?.score ? scoreJoueur(joue.score, color) : null });
  }
  return out;
}

export function grouperFinales(analyses, jeux, travaux, user, book, periode, maintenant = Date.now()) {
  const jours = periodeStrategie(periode);
  const groupes = Object.fromEntries(Object.keys(TYPES_FINALES).map((t) => [t, []]));
  const travail = new Map(travaux.map((r) => [r.id, r.data]));
  const donnees = new Map(analyses.map((r) => [r.data.game.id, r.data]));
  const aAnalyser = jeux.filter((g) => dansPeriode(g, jours, maintenant) && !donnees.get(g.id)?.summary?.complete).length;
  for (const { data } of analyses) {
    if (!dansPeriode(data.game, jours, maintenant)) continue;
    const jeu = data.game;
    for (const erreur of releverFinales(data, user, book)) {
      const suivi = travail.get(erreur.id);
      if (suivi?.travaillee || suivi?.archivee) continue;
      const [joueur, adverse] = erreur.color === 'w' ? [jeu.white, jeu.black] : [jeu.black, jeu.white];
      groupes[erreur.type].push({ ...erreur, jeu, adversaire: adverse?.name, elo: joueur?.rating });
    }
  }
  for (const liste of Object.values(groupes)) liste.sort((a, b) => b.jeu.end - a.jeu.end || a.ply - b.ply);
  return { jours, groupes, aAnalyser };
}
