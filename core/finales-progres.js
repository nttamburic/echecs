// Progression et révisions des finales (sans DOM ni stockage, testé avec node).
// Un essai : { position, at, resultat: 'reussi' | 'aide' | 'rate' }. Chaque essai est un enregistrement
// distinct, jamais modifié : deux appareils ne peuvent donc pas s'écraser à la synchronisation.
import { isDue, review, startOfDay } from './srs.js';

export const REUSSITES_POUR_MAITRISE = 3; // réussites sans aide, sur des jours différents

// La journée change à 4 h, comme pour les révisions des ouvertures et des puzzles.
const jourDe = (at) => startOfDay(at - 4 * 3600000);

// { etat: 'decouvrir' | 'encours' | 'maitrisee', jours : jours réussis depuis le dernier échec, essais }
export function etatPosition(essais) {
  const jours = new Set();
  for (const e of [...essais].sort((a, b) => a.at - b.at)) {
    if (e.resultat === 'rate') jours.clear(); // un échec remet le compte à zéro
    else if (e.resultat === 'reussi') jours.add(jourDe(e.at));
  }
  const etat = !essais.length ? 'decouvrir' : jours.size >= REUSSITES_POUR_MAITRISE ? 'maitrisee' : 'encours';
  return { etat, jours: Math.min(jours.size, REUSSITES_POUR_MAITRISE), essais: essais.length };
}

// Map position → état, pour les leçons données.
export function progression(lecons, essais) {
  const parPosition = new Map(lecons.map((l) => [l.id, []]));
  for (const e of essais) parPosition.get(e.position)?.push(e);
  return new Map([...parPosition].map(([id, liste]) => [id, etatPosition(liste)]));
}

// Map famille → { total, maitrisees }
export function resumeFamilles(lecons, etats) {
  const out = new Map();
  for (const l of lecons) {
    const f = out.get(l.famille) ?? { total: 0, maitrisees: 0 };
    f.total++;
    if (etats.get(l.id)?.etat === 'maitrisee') f.maitrisees++;
    out.set(l.famille, f);
  }
  return out;
}

// ------------------------------------------------------------------ répétition espacée
const NOTES = Object.freeze({ rate: 'again', aide: 'hard', reussi: 'good' });

// Carte de révision d'une position, recalculée à partir de ses essais (rien d'autre à synchroniser).
// Une réussite avant la date prévue ne repousse pas la révision : s'entraîner plusieurs fois le même
// jour n'espace pas les rappels. Un échec compte toujours.
export function carteDe(essais) {
  let carte = null;
  for (const e of [...essais].sort((a, b) => a.at - b.at)) {
    if (carte && e.resultat !== 'rate' && e.at < carte.due) continue;
    carte = review(carte ?? { due: e.at, interval: 0, ease: 2.5, reps: 0, lapses: 0 }, NOTES[e.resultat], e.at);
  }
  return carte;
}

// Map position → carte, pour les seules positions déjà essayées.
export function cartesDe(lecons, essais) {
  const parPosition = new Map(lecons.map((l) => [l.id, []]));
  for (const e of essais) parPosition.get(e.position)?.push(e);
  return new Map([...parPosition].filter(([, liste]) => liste.length).map(([id, liste]) => [id, carteDe(liste)]));
}

const parEcheance = (cartes) => (a, b) => cartes.get(a.id).due - cartes.get(b.id).due;

// Positions à revoir maintenant, la plus en retard d'abord.
export const aRevoir = (lecons, cartes, now = Date.now()) =>
  lecons.filter((l) => cartes.has(l.id) && isDue(cartes.get(l.id), now)).sort(parEcheance(cartes));

// Date de la prochaine révision à venir, ou null.
export function prochaineRevision(cartes, now = Date.now()) {
  const futures = [...cartes.values()].map((c) => c.due).filter((due) => due > now);
  return futures.length ? Math.min(...futures) : null;
}

// Ordre des positions d'une série. cle : 'revoir', 'tous' ou une famille.
// Par thème : les révisions dues, puis les positions jamais essayées (dans l'ordre du catalogue),
// puis les autres, de la plus proche échéance à la plus lointaine.
export function fileSerie(cle, lecons, cartes, now = Date.now()) {
  if (cle === 'revoir') return aRevoir(lecons, cartes, now);
  const choisies = cle === 'tous' ? lecons : lecons.filter((l) => l.famille === cle);
  const dues = aRevoir(choisies, cartes, now);
  const neuves = choisies.filter((l) => !cartes.has(l.id));
  const plusTard = choisies.filter((l) => cartes.has(l.id) && !isDue(cartes.get(l.id), now)).sort(parEcheance(cartes));
  return [...dues, ...neuves, ...plusTard];
}

// « maintenant », « dans quelques minutes », « demain », « le 28 novembre »…
export function quandRevoir(due, now = Date.now()) {
  if (due <= now) return 'maintenant';
  if (due - now <= 3600000) return 'dans quelques minutes';
  const jours = Math.round((jourDe(due) - jourDe(now)) / 86400000);
  if (jours <= 1) return 'demain';
  return 'le ' + new Date(due).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}
