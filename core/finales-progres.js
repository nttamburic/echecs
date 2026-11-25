// Progression des cours de finales (sans DOM ni stockage, testé avec node).
// Un essai : { position, at, resultat: 'reussi' | 'aide' | 'rate' }. Chaque essai est un enregistrement
// distinct, jamais modifié : deux appareils ne peuvent donc pas s'écraser à la synchronisation.
import { startOfDay } from './srs.js';

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
