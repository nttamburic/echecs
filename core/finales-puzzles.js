// Puzzles de finales : thèmes, niveau adaptatif et choix du puzzle suivant (sans DOM, testé avec node).
// Un essai : { theme, puzzle, note, depart, resultat: 'reussi' | 'aide' | 'rate', at }. Chaque essai est
// un enregistrement distinct, jamais modifié : le niveau est recalculé à partir d'eux, ce qui permet
// de réunir les essais de deux appareils sans conflit.
import { ELO_START, updateElo } from '../modules/puzzles-engine.js';
import { pickByRating } from './puzzle-data.js';

// Noms des packs « thème » de la base Lichess.
export const THEMES_FINALES = Object.freeze([
  ['endgame', 'Toutes les finales'],
  ['pawnEndgame', 'Pions'],
  ['rookEndgame', 'Tours'],
  ['bishopEndgame', 'Fous'],
  ['knightEndgame', 'Cavaliers'],
  ['queenEndgame', 'Dames'],
  ['queenRookEndgame', 'Dame et tour'],
]);
export const nomTheme = (theme) => THEMES_FINALES.find(([k]) => k === theme)?.[1] ?? null;

export const NIVEAU_MIN = 400;
export const NIVEAU_MAX = 3200;
const borner = (n) => Math.min(NIVEAU_MAX, Math.max(NIVEAU_MIN, Math.round(n)));

const parDate = (a, b) => a.at - b.at || (String(a.puzzle) < String(b.puzzle) ? -1 : 1);

// Bilan d'un thème : niveau actuel, puzzles joués et réussis sans aide, puzzles déjà vus.
// « depart » est le niveau utilisé avant le tout premier essai du thème.
// Réussite ou échec : le niveau monte ou baisse selon la note du puzzle (formule de Lichess).
// Réussite avec indice : le niveau ne change pas.
export function bilanTheme(theme, essais, departParDefaut = ELO_START) {
  const liste = essais.filter((e) => e.theme === theme).sort(parDate);
  let niveau = borner(liste[0]?.depart ?? departParDefaut);
  let reussis = 0;
  for (const e of liste) {
    if (e.resultat === 'reussi') reussis++;
    if (e.resultat !== 'aide') niveau = borner(updateElo(niveau, e.note, e.resultat === 'reussi').user);
  }
  return { niveau, joues: liste.length, reussis, vus: new Set(liste.map((e) => e.puzzle)) };
}

// Un puzzle jamais vu, proche du niveau ; null si le pack n'en contient plus.
export const choisirPuzzle = (pack, niveau, vus, rnd = Math.random) =>
  pickByRating(pack, niveau, { spread: 100, n: 20, exclude: vus, rnd })[0] ?? null;
