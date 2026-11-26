// Série de puzzles mise de côté le temps d'une analyse avec Stockfish (route #/free/new), pour la
// retrouver au retour. Elle est gardée en mémoire seulement, et oubliée dès que l'on va ailleurs.
export const ANALYSE_HASH = '#/free/new';

let garde = null; // { hash, reprendre }

export function garder(hash, reprendre) { garde = { hash, reprendre }; }

// Au retour sur « hash » : renvoie la fonction de reprise (une seule fois), sinon null.
export function reprise(hash) {
  if (!garde || garde.hash !== hash) return null;
  const { reprendre } = garde;
  garde = null;
  return reprendre;
}

// À chaque changement de route : seules l'analyse et la série d'origine conservent la reprise.
export function oublierSiAilleurs(hash) {
  if (garde && hash !== garde.hash && hash !== ANALYSE_HASH) garde = null;
}
