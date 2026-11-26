// Données de la révision des erreurs : cartes de répétition espacée (collection errorCards) et essais de
// « Convertir l'avantage » (conversionWork), synchronisés comme le reste.
import * as store from './store.js';
import { local } from './ui.js';
import { getPseudoLichess } from './joueur.js';
import { review } from './srs.js';
import { erreursReglages } from './manu/erreurs.js';
import { dansPeriode } from './manu/strategie.js';
import { JOURS_NOUVELLES, candidats, clesArchivees, fileRevision } from './revision.js';

const CARTES = 'errorCards';
const CONVERSIONS = 'conversionWork';

const enMap = (rows) => new Map(rows.map((r) => [r.id, r.data]));
export const lireCartes = async () => enMap(await store.all(CARTES));
export const lireConversions = async () => enMap(await store.all(CONVERSIONS));

export async function noterErreur(exercice, note, maintenant = Date.now()) {
  const old = await store.get(CARTES, exercice.key);
  await store.put(CARTES, exercice.key, {
    exercice, card: review(old?.card, note, maintenant), first: old?.first ?? maintenant,
    plays: (old?.plays ?? 0) + 1, fails: (old?.fails ?? 0) + (note === 'again' ? 1 : 0), last: maintenant,
  }, { file: 'errors/cards.json' });
}

async function majConversion(id, changement) {
  const old = (await store.get(CONVERSIONS, id)) ?? {};
  await store.put(CONVERSIONS, id, { ...old, ...changement(old) }, { file: 'errors/conversions.json' });
}
export const noterConversion = (id, reussie, maintenant = Date.now()) =>
  majConversion(id, (old) => ({ essais: (old.essais ?? 0) + 1, reussie: !!old.reussie || reussie, last: maintenant }));
export const retirerConversion = (id, archivee = true) => majConversion(id, () => ({ archivee }));

// Relever les fautes rejoue chaque partie : le résultat est gardé en mémoire tant que l'analyse ne change pas,
// et le calcul rend régulièrement la main pour ne pas figer la page.
const memo = new Map();
export async function chargerFile(user, book, maintenant = Date.now()) {
  const [analyses, travaux, cartes] = await Promise.all([store.all('analysis'), store.all('strategyWork'), lireCartes()]);
  const seuils = erreursReglages(local.get);
  const liste = [];
  let calculees = 0;
  for (const row of analyses) {
    if (!row.data?.game || !dansPeriode(row.data.game, JOURS_NOUVELLES, maintenant)) continue;
    const signature = JSON.stringify([row.updatedAt, user, getPseudoLichess(), seuils, Object.keys(book).length > 0]);
    let m = memo.get(row.id);
    if (m?.signature !== signature) {
      m = { signature, liste: candidats([row], user, book, seuils, [], maintenant) };
      memo.set(row.id, m);
      if (++calculees % 3 === 0) await new Promise((r) => setTimeout(r));
    }
    liste.push(...m.liste);
  }
  const archivees = clesArchivees(travaux);
  const actifs = liste.filter((e) => !archivees.has(e.key)).sort((a, b) => (b.end ?? 0) - (a.end ?? 0) || a.ply - b.ply);
  return { ...fileRevision(actifs, cartes, archivees, maintenant), cartes: cartes.size };
}

// Séance demandée par un autre écran (bilan, listes d'erreurs) : { exercices, retour: { href, texte } }.
// Sans demande, l'écran d'exercice ouvre la séance de révision espacée.
let demande = null;
export const demanderSeance = (s) => { demande = s; };
export const prendreSeance = () => { const s = demande; demande = null; return s; };
