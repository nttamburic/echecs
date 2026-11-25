import { PHASES, releverErreurs } from './erreurs.js';

export const PERIODES_STRATEGIE = Object.freeze([7, 15, 30, 90]);
export const periodeStrategie = valeur => PERIODES_STRATEGIE.includes(Number(valeur)) ? Number(valeur) : 7;
export const dansPeriode = (jeu, jours, maintenant = Date.now()) =>
  Number.isFinite(jeu.end) && jeu.end * 1000 >= maintenant - jours * 86400000 && jeu.end * 1000 <= maintenant;

export function grouperStrategie(analyses, jeux, travaux, user, book, seuils, periode, maintenant = Date.now()) {
  const jours = periodeStrategie(periode);
  const groupes = Object.fromEntries(PHASES.map(p => [p, []]));
  const travail = new Map(travaux.map(r => [r.id, r.data]));
  const donnees = new Map(analyses.map(r => [r.data.game.id, r.data]));
  const aAnalyser = jeux.filter(g => dansPeriode(g, jours, maintenant) && !donnees.get(g.id)?.summary?.complete).length;
  for (const { data } of analyses) {
    if (!dansPeriode(data.game, jours, maintenant)) continue;
    const jeu = data.game;
    for (const erreur of releverErreurs(data, user, book, seuils)) {
      if (erreur.tactique || travail.get(erreur.id)?.travaillee) continue;
      const [joueur, adverse] = erreur.color === 'w' ? [jeu.white, jeu.black] : [jeu.black, jeu.white];
      groupes[erreur.phase].push({ ...erreur, jeu, adversaire: adverse?.name, elo: joueur?.rating });
    }
  }
  for (const liste of Object.values(groupes)) liste.sort((a, b) => b.jeu.end - a.jeu.end || a.ply - b.ply);
  return { jours, groupes, aAnalyser };
}
