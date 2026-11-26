// « Mes 3 axes de travail » (sans DOM, testé avec node) : au plus trois points faibles trouvés par des
// règles simples, sans service extérieur. Rien n'est enregistré : tout vient des mesures de core/stats.js.
//
// Une seule unité pour les comparer : les points que vous n'avez pas marqués dans les parties concernées
// (défaite = 1, nulle = ½), ramenés à 10 parties. Dans une partie non gagnée, seule la faute la plus
// coûteuse désigne le domaine : additionner toutes les fautes gonflerait toujours les fautes de jeu.
import { MINIMUM, resultats, grouperResultats } from './stats.js';
import { couleurDe } from './revision.js';
import { issue } from './accueil.js';

export const AXES_MAX = 3;
export const PARTIES_TOUCHEES = 3; // en dessous, ce n'est pas un signal
export const COUT_MINIMUM = 0.5; // points sur 10 parties
export const PART_TEMPS = 0.2; // part des parties non gagnées (avec pendule) touchées par le temps
export const PART_NON_CONVERTIE = 0.25; // part des parties gagnantes non gagnées
export const ECART_OUVERTURE = 15; // points de score sous vos autres parties
export const ECART_SAUVETAGE = 15; // baisse du sauvetage face à votre période précédente
const SAUVETAGE_VAUT = 0.5; // une partie sauvée vaut au moins une nulle

export const TITRES = Object.freeze({
  tactique: 'Tactique',
  position: 'Fautes non tactiques',
  finale: 'Finales',
  conversion: 'Convertir l’avantage',
  manque: 'Manque de temps',
  vite: 'Coups joués trop vite',
  ouverture: 'Une ouverture en difficulté',
  defense: 'Défense',
});

// Points non marqués : 0 pour une victoire, ½ pour une nulle, 1 pour une défaite.
export const pointsPerdus = (m) => (m.gagnee ? 0 : m.sauvee ? 0.5 : 1);

const somme = (liste, f) => liste.reduce((a, x) => a + f(x), 0);

// Les exemples sont les parties les plus coûteuses, puis les plus récentes.
function axe(cle, touchees, total) {
  const tri = [...touchees].sort((a, b) => pointsPerdus(b) - pointsPerdus(a) || (b.decisive?.perte ?? 0) - (a.decisive?.perte ?? 0) || b.end - a.end);
  const points = somme(tri, pointsPerdus);
  return {
    cle, n: tri.length, points, total, sur10: total ? (10 * points) / total : 0,
    exemples: tri.slice(0, 3).map((m) => ({ id: m.id, ply: m.decisive?.ply ?? null })),
  };
}

// Axes tirés des analyses d'une période, retenus ou non (« signal »).
function depuisAnalyses(mesures) {
  const total = mesures.length;
  const perdues = mesures.filter((m) => pointsPerdus(m) > 0);
  const out = new Map();
  const ajouter = (a, signal = true) => out.set(a.cle, { ...a, signal });

  for (const cle of ['tactique', 'position', 'finale']) {
    ajouter(axe(cle, perdues.filter((m) => m.decisive?.categorie === cle), total));
  }

  const gagnantes = mesures.filter((m) => m.gagnante);
  const gachees = gagnantes.filter((m) => !m.gagnee);
  ajouter({ ...axe('conversion', gachees, total), sur: gagnantes.length },
    gachees.length >= PART_NON_CONVERTIE * gagnantes.length);

  const horloge = perdues.filter((m) => m.pendule);
  const manque = horloge.filter((m) => m.pendule.drapeau || m.decisive?.repere === 'manque');
  const drapeaux = manque.filter((m) => m.pendule.drapeau).length;
  ajouter({ ...axe('manque', manque, total), sur: horloge.length, drapeaux }, manque.length >= PART_TEMPS * horloge.length);
  const rapides = horloge.filter((m) => m.pendule.vitePossible);
  const vite = rapides.filter((m) => m.decisive?.repere === 'vite');
  ajouter({ ...axe('vite', vite, total), sur: rapides.length }, vite.length >= PART_TEMPS * rapides.length);
  return out;
}

// L'ouverture la plus coûteuse, comparée à vos autres parties (analysées ou non).
function ouvertureFaible(jeux, user, ouvertures) {
  const cle = (g) => (ouvertures.get(g.id) ? `${couleurDe(g, user)}|${ouvertures.get(g.id)}` : null);
  const tout = resultats(jeux, user);
  let pire = null;
  for (const groupe of grouperResultats(jeux, user, cle)) {
    const autres = tout.total - groupe.total;
    if (groupe.total < MINIMUM || autres < MINIMUM) continue;
    const scoreAutres = (tout.score * tout.total - groupe.score * groupe.total) / autres;
    if (scoreAutres - groupe.score < ECART_OUVERTURE) continue;
    const points = ((scoreAutres - groupe.score) / 100) * groupe.total;
    if (pire && pire.points >= points) continue;
    const [camp, famille] = groupe.cle.split('|');
    pire = {
      cle: 'ouverture', camp, famille, n: groupe.total, points, total: tout.total, sur10: (10 * points) / tout.total,
      score: groupe.score, scoreAutres, avant: null,
      exemples: jeux.filter((g) => cle(g) === groupe.cle && issue(g, user) === 'loss')
        .sort((a, b) => b.end - a.end).slice(0, 3).map((g) => ({ id: g.id, ply: null })),
    };
  }
  return pire;
}

// La défense n'a pas de référence absolue (il est normal de perdre une position très mauvaise) : elle
// n'est signalée que si vous en sauvez nettement moins qu'à la période précédente.
function defense(mesures, precedentes) {
  const mal = mesures.filter((m) => m.mauvaise), avant = precedentes.filter((m) => m.mauvaise);
  if (mal.length < MINIMUM || avant.length < MINIMUM) return null;
  const pct = (l) => (100 * l.filter((m) => m.sauvee).length) / l.length;
  const baisse = pct(avant) - pct(mal);
  if (baisse < ECART_SAUVETAGE) return null;
  const points = (baisse / 100) * mal.length * SAUVETAGE_VAUT;
  return {
    ...axe('defense', mal.filter((m) => !m.sauvee), mesures.length),
    points, sur10: (10 * points) / mesures.length, sur: mal.length, pct: pct(mal), pctAvant: pct(avant), avant: null,
  };
}

const retenu = (a) => a.signal !== false && a.n >= PARTIES_TOUCHEES && a.sur10 >= COUT_MINIMUM;

// mesures / precedentes : parties analysées de la période et de la précédente ; jeux : toutes les parties
// de la période ; ouvertures : Map identifiant → famille d'ouverture.
// → { axes (au plus 3, le plus coûteux d'abord), analysees, parties, assez }
export function trouverAxes({ mesures, precedentes = [], jeux = [], user, ouvertures = new Map() }) {
  const assez = mesures.length >= MINIMUM; // sans assez d'analyses, seule l'ouverture peut ressortir
  const candidats = [];
  if (assez) {
    const avant = precedentes.length >= MINIMUM ? depuisAnalyses(precedentes) : null;
    for (const a of depuisAnalyses(mesures).values()) candidats.push({ ...a, avant: avant ? avant.get(a.cle).sur10 : null });
    const d = defense(mesures, precedentes);
    if (d) candidats.push(d);
  }
  const o = ouvertureFaible(jeux, user, ouvertures);
  if (o) candidats.push(o);
  const axes = candidats.filter(retenu).sort((a, b) => b.sur10 - a.sur10 || b.n - a.n).slice(0, AXES_MAX);
  return { axes, analysees: mesures.length, parties: jeux.length, assez };
}
