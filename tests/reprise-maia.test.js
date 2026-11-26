import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import { partieAGarder, relirePartie } from '../core/play-reprise.js';

function partie(sans = ['e4', 'e5', 'Nf3'], plus = {}) {
  const chess = new Chess();
  const startFen = chess.fen();
  const moves = sans.map((s) => chess.move(s));
  return { phase: 'play', startFen, moves, base: 0, user: 'b', elo: 1500, tc: 300, clock: { w: 250000.4, b: 123456 }, label: 'Italienne', etude: null, ...plus };
}

test('Reprise Maia · position, coups, couleur, niveau et pendules retrouvés', () => {
  const P = partie();
  const r = relirePartie(partieAGarder(P));
  assert.equal(r.chess.fen(), P.moves.at(-1).after);
  assert.deepEqual(r.moves.map((m) => m.san), ['e4', 'e5', 'Nf3']);
  assert.equal(r.ply, 3);
  assert.deepEqual([r.user, r.elo, r.tc, r.label], ['b', 1500, 300, 'Italienne']);
  assert.deepEqual(r.clock, { w: 250000, b: 123456 });
});

test('Reprise Maia · la répétition de position reste détectable', () => {
  const r = relirePartie(partieAGarder(partie(['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1'])));
  r.chess.move('Ng8');
  assert.ok(r.chess.isThreefoldRepetition());
});

test('Reprise Maia · séance d’étude gardée sans son état d’enregistrement', () => {
  const r = relirePartie(partieAGarder(partie(['e4'], { tc: 0, clock: null, etude: { id: 'x:1', joue: 'h5', enregistrement: 'en_cours' } })));
  assert.deepEqual(r.etude, { id: 'x:1', joue: 'h5' });
  assert.equal(r.clock, null);
});

test('Reprise Maia · rien à garder hors partie ; données abîmées ou partie finie refusées', () => {
  assert.equal(partieAGarder(partie(undefined, { phase: 'setup' })), null);
  assert.equal(partieAGarder(partie(undefined, { phase: 'over' })), null);
  for (const t of [null, '', '{', '{"v":2}', JSON.stringify({ v: 1, user: 'w', elo: 1500, ucis: ['e2e5'] })]) assert.equal(relirePartie(t), null, String(t));
  assert.equal(relirePartie(partieAGarder(partie(['f3', 'e5', 'g4', 'Qh4#']))), null);
});
