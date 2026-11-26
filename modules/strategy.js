// Module « Erreurs stratégiques » (la présentation est dans liste-erreurs.js).
import { local } from '../core/ui.js';
import { erreursReglages } from '../core/manu/erreurs.js';
import { grouperStrategie } from '../core/manu/strategie.js';
import { BOOK, getGames, getUser } from './analyse.js';
import { creerListeErreurs } from './liste-erreurs.js';

export const { show, leave } = creerListeErreurs({
  prefixe: 'strategy',
  titre: 'Erreurs stratégiques',
  onglets: { ouverture: 'Ouverture', milieu: 'Milieu de jeu', finale: 'Finale' },
  nomOnglets: 'Phase de la partie',
  textes: {
    chargement: 'Chargement des erreurs stratégiques…',
    vide: 'Aucune erreur stratégique sur cette période.',
    echec: 'Impossible de charger les erreurs stratégiques.',
  },
  charger: (analyses, travaux, periode) =>
    grouperStrategie(analyses, getGames(), travaux, getUser(), BOOK, erreursReglages(local.get), periode),
});
