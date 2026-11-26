import test from 'node:test';
import assert from 'node:assert/strict';
import { PuzzleRun } from '../modules/puzzles-engine.js';
import { garder, reprise, oublierSiAilleurs, ANALYSE_HASH } from '../core/puzzle-reprise.js';

// Deux coups du joueur : l'adversaire joue a7a6, puis 1. Te8+ Txe8 2. Txe8 mat.
const PUZZLE = { id: 'x', fen: 'r5k1/p4ppp/8/8/8/8/4RPPP/4R1K1 b - - 0 1', moves: ['a7a6', 'e2e8', 'a8e8', 'e1e8'], rating: 1200 };
const lancer = () => { const r = new PuzzleRun(PUZZLE); r.start(); return r; };

test('Puzzles · après un mauvais coup, on réessaie dans la même position', () => {
  const r = lancer();
  const avant = r.fen;
  assert.equal(r.move('e2', 'e3').ok, false);
  assert.equal(r.move('e2', 'e4').ok, false);
  assert.equal(r.fen, avant);
  assert.equal(r.status, 'playing');
  assert.equal(r.mistakes, 2);
  assert.equal(r.move('e2', 'e8').ok, true);
});

test('Puzzles · plusieurs coups : une erreur au second coup laisse reprendre là où l’on était', () => {
  const r = lancer();
  const premier = r.move('e2', 'e8');
  assert.equal(premier.done, false);
  assert.equal(premier.reply.uci, 'a8e8');
  assert.equal(r.move('g1', 'f1').ok, false);
  const fin = r.move('e1', 'e8');
  assert.equal(fin.done, true);
  assert.equal(r.status, 'solved');
});

test('Puzzles · un puzzle réussi après une erreur reste compté comme raté', () => {
  const r = lancer();
  r.move('e2', 'e3');
  assert.equal(r.settle(false), true); // première erreur : à enregistrer
  assert.equal(r.settle(false), false); // erreur suivante : rien de plus
  r.move('e2', 'e8');
  r.move('e1', 'e8');
  assert.equal(r.settle(true), false);
  assert.equal(r.verdict, false);
});

test('Puzzles · sans erreur, la réussite est comptée une fois', () => {
  const r = lancer();
  r.move('e2', 'e8');
  r.move('e1', 'e8');
  assert.equal(r.settle(true), true);
  assert.equal(r.settle(true), false);
  assert.equal(r.verdict, true);
});

test('Puzzles · la ligne jouée part de la position de départ et mène à la position affichée', () => {
  const r = lancer();
  assert.deepEqual(r.line, ['a7a6']);
  r.move('e2', 'e3'); // une erreur n’y entre pas
  r.move('e2', 'e8');
  assert.deepEqual(r.line, ['a7a6', 'e2e8', 'a8e8']);
  r.move('e1', 'e8');
  assert.deepEqual(r.line, PUZZLE.moves);
});

test('Puzzles · la série mise de côté pour l’analyse n’est reprise qu’une fois, sur sa page', () => {
  const f = () => {};
  garder('#/puzzles/theme/fork', f);
  oublierSiAilleurs(ANALYSE_HASH);
  assert.equal(reprise('#/puzzles/theme/pin'), null);
  oublierSiAilleurs('#/puzzles/theme/fork');
  assert.equal(reprise('#/puzzles/theme/fork'), f);
  assert.equal(reprise('#/puzzles/theme/fork'), null);
});

test('Puzzles · aller ailleurs depuis l’analyse oublie la série mise de côté', () => {
  garder('#/endgames/puzzles/rookEndgame', () => {});
  oublierSiAilleurs(ANALYSE_HASH);
  oublierSiAilleurs('#/games');
  assert.equal(reprise('#/endgames/puzzles/rookEndgame'), null);
});
