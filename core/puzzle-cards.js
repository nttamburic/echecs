// Révision espacée des puzzles recommandés : une « carte » par puzzle déjà tenté (core/srs.js), gardée avec
// le puzzle lui-même pour pouvoir le reproposer plus tard sans le retélécharger ni le recalculer.
// Collection `puzzleCards` (fichier puzzles/cards.json, synchronisé) : { puzzle, card, plays, fails, last }.
import * as store from './store.js';
import { review, isDue } from './srs.js';

const COL = 'puzzleCards';
const FILE = 'puzzles/cards.json';

const slim = (p) => ({ id: p.id, fen: p.fen, moves: p.moves, alt: p.alt || [], rating: p.rating, source: p.source, reason: p.reason, openingTags: p.openingTags || [] });

export async function allCards() {
  const rows = await store.all(COL).catch(() => []);
  return new Map(rows.map((r) => [r.id, r.data]));
}

// Note un puzzle : raté -> à revoir dans 10 minutes ; réussi -> intervalle croissant (avec indice : « hard »).
export async function gradePuzzle(puzzle, { success, hinted = false }, now = Date.now()) {
  const old = await store.get(COL, puzzle.id).catch(() => null);
  const grade = !success ? 'again' : hinted ? 'hard' : 'good';
  const rec = {
    puzzle: slim(puzzle),
    card: review(old && old.card, grade, now),
    plays: ((old && old.plays) || 0) + 1,
    fails: ((old && old.fails) || 0) + (success ? 0 : 1),
    last: now,
  };
  await store.put(COL, puzzle.id, rec, { file: FILE });
  return rec;
}

export { isDue };
