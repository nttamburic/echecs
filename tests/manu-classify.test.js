// Tests de la nature d'une erreur (core/manu/classify.js), seam : classifyError.
// Règle : tactique si un motif tactique apparaît dans les 6 premiers demi-coups de la meilleure suite
// ou de la suite jouée (le coup joué puis la réfutation du moteur). Sinon stratégique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import { classifyError } from '../core/manu/classify.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

test('erreur qui permet un mat rapide : tactique, motif de la suite jouée', () => {
  // 1. f3? e5 2. g4?? Dh4#
  const r = classifyError({ fen: START, playedUci: 'f2f3', bestPv: ['e2e4'], refutationPv: ['e7e5', 'g2g4', 'd8h4'] });
  assert.equal(r.kind, 'tactique');
  assert.equal(r.suite, 'jouee');
  assert.deepEqual(r.motif, { famille: 'Échec et mat', camp: 'b', acteur: 'h4', cibles: ['e1'], coups: ['f2f3', 'e7e5', 'g2g4', 'd8h4'] });
});

test('fourchette manquée : tactique, motif de la meilleure suite', () => {
  const c = new Chess('r3brk1/5pp1/p1nqpn1p/P2pN3/2pP4/2P1PN2/5PPP/RB1QK2R b KQ - 4 16');
  c.move('Nxe5');
  const r = classifyError({ fen: c.fen(), playedUci: 'h2h3', bestPv: ['d4e5', 'd6e7', 'e5f6'] });
  assert.equal(r.kind, 'tactique');
  assert.equal(r.suite, 'meilleure');
  assert.equal(r.motif.famille, 'Fourchette');
  assert.equal(r.motif.camp, 'w');
});

test('motif au-delà du 6e demi-coup : stratégique', () => {
  // Le mat du berger inversé n'arrive qu'au 8e demi-coup de la meilleure suite.
  const bestPv = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'f2f3', 'e7e5', 'g2g4', 'd8h4'];
  const r = classifyError({ fen: START, playedUci: 'a2a3', bestPv });
  assert.deepEqual(r, { kind: 'strategique' });
});

test('aucune suite tactique : stratégique, sans motif', () => {
  const r = classifyError({ fen: START, playedUci: 'a2a3', bestPv: ['e2e4', 'e7e5'], refutationPv: ['e7e5'] });
  assert.deepEqual(r, { kind: 'strategique' });
});
