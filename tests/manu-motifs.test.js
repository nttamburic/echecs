// Tests du moteur de motifs (core/manu/motifs.js), seam : detectMotifs(fen, pvUci).
// Vérité de référence : annotations humaines de Manu AI sur des puzzles Lichess (tests/fixtures).
// Lancer : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectMotifs } from '../core/manu/motifs.js';

const { entrees } = JSON.parse(readFileSync(new URL('./fixtures/manu-annotations.json', import.meta.url), 'utf8'));
const cas = (famille) => entrees.filter((e) => e.famille === famille);

// Le motif annoté apparaît au demi-coup annoté, avec son acteur et ses cibles.
function trouve(e) {
  const found = detectMotifs(e.fen, e.coups);
  return found.find((m) => m.famille === e.famille && m.coups.length === e.demiCoup
    && (e.acteur == null || m.acteur === e.acteur)
    && e.cibles.every((z) => m.cibles.includes(z)));
}

for (const e of cas('Échec et mat')) {
  test(`mat annoté : ${e.id}`, () => {
    const m = trouve(e);
    assert.ok(m, `mat attendu au demi-coup ${e.demiCoup}`);
  });
}

test('le mat a le camp qui mate et rejoue les coups jusqu’au mat', () => {
  // Mat du couloir : 1… Te8? 2. Td8+ Txd8 3. Txd8#. Les Blancs matent.
  const fen = '3r2k1/4nppp/pq1p1b2/1p2P3/2r2P2/2P1NR2/PP1Q2BP/3R2K1 b - - 0 24';
  const pv = ['d6e5', 'd2d8', 'b6d8', 'd1d8'];
  const mat = detectMotifs(fen, pv).find((m) => m.famille === 'Échec et mat');
  assert.deepEqual(mat, { famille: 'Échec et mat', camp: 'w', acteur: 'd8', cibles: ['g8'], coups: pv });
});

for (const e of cas('Fourchette')) {
  test(`fourchette annotée : ${e.id}`, () => {
    assert.ok(trouve(e), `fourchette ${e.acteur} → ${e.cibles} attendue au demi-coup ${e.demiCoup}`);
  });
}

test('pas de fourchette quand aucune cible ne se gagne', () => {
  // Nd3 attaque les cavaliers c5 et e5, chacun défendu par un pion et qui reprennent en d3.
  const fen = '4k3/8/1p3p2/2n1n3/8/8/1N6/4K3 w - - 0 1';
  assert.equal(detectMotifs(fen, ['b2d3']).filter((m) => m.famille === 'Fourchette').length, 0);
});

test('fourchette de pion : camp et cibles', () => {
  // dxe5 attaque la dame d6 et le cavalier f6 (puzzle 002IE).
  const fen = 'r3brk1/5pp1/p1nqpn1p/P2pN3/2pP4/2P1PN2/5PPP/RB1QK2R b KQ - 4 16';
  const f = detectMotifs(fen, ['c6e5', 'd4e5']).find((m) => m.famille === 'Fourchette');
  assert.deepEqual(f, { famille: 'Fourchette', camp: 'w', acteur: 'e5', cibles: ['d6', 'f6'], coups: ['c6e5', 'd4e5'] });
});

test('aucun motif sur une suite calme', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  assert.deepEqual(detectMotifs(fen, ['e2e4', 'e7e5', 'g1f3', 'b8c6']), []);
});
