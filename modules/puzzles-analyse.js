// « Analyser la position » : ouvre la position du puzzle dans l'analyse libre (Stockfish en direct),
// avec un bouton pour revenir à la série là où on l'a laissée.
import { ANALYSE_HASH, garder } from '../core/puzzle-reprise.js';
import { stashFree } from './analyse.js';

// run : le PuzzleRun affiché ; onglet : module à garder en surbrillance dans la navigation ;
// reprendre : appelé au retour sur la série.
export function analyserPuzzle(run, { onglet, reprendre }) {
  garder(location.hash, reprendre);
  stashFree({ fen: run.puzzle.fen, ucis: run.line, orient: run.color, live: true, tab: onglet, back: { label: 'Retour au puzzle' } });
  location.hash = ANALYSE_HASH;
}
