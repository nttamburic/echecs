import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import { epd } from '../analysis.js';
import { cadencePendule, lirePendule, tempsDePartie, pendule, repere, reperesDe, fmtDuree, fmtPendule } from '../core/temps.js';

const partie = (pgn) => {
  const chess = new Chess();
  chess.loadPgn(pgn);
  return { chess, coups: chess.history({ verbose: true }) };
};
const clk = (c) => `{[%clk ${c}]}`;

test('Temps · cadence et pendule', () => {
  assert.deepEqual(cadencePendule('600'), { base: 600, increment: 0 });
  assert.deepEqual(cadencePendule('180+2'), { base: 180, increment: 2 });
  assert.equal(cadencePendule('1/86400'), null);
  assert.equal(cadencePendule('-'), null);
  assert.equal(cadencePendule(undefined), null);
  assert.equal(lirePendule('[%eval 0.3] [%clk 1:02:03.5]'), 3723.5);
  assert.equal(lirePendule('bon coup'), null);
});

test('Temps · temps passé avec incrément, pendules au fil des coups', () => {
  const { chess, coups } = partie(`[TimeControl "180+2"]\n\n1. e4 ${clk('0:03:01.9')} 1... e5 ${clk('0:02:50')} 2. Nf3 ${clk('0:02:40')} 2... Nc6 ${clk('0:02:51')} *`);
  const t = tempsDePartie(chess, {});
  assert.deepEqual(t.passe, [0.1, 12, 23.9, 1]);
  assert.deepEqual(t.avant, [180, 180, 181.9, 170]);
  assert.equal(pendule(t, coups, 0, 'w'), 180);
  assert.equal(pendule(t, coups, 3, 'w'), 160);
  assert.equal(pendule(t, coups, 3, 'b'), 170);
});

test('Temps · pendule manquante : inconnu sur le coup et le suivant du même camp seulement', () => {
  const { chess } = partie(`1. e4 ${clk('0:09:50')} 1... e5 ${clk('0:09:55')} 2. Nf3 2... Nc6 ${clk('0:09:40')} 3. Bb5 ${clk('0:09:00')} 3... a6 ${clk('0:09:30')} *`);
  const t = tempsDePartie(chess, { timeControl: '600' });
  assert.deepEqual(t.passe, [10, 5, null, 15, null, 10]);
});

test('Temps · partie sans pendule ou par correspondance', () => {
  assert.equal(tempsDePartie(partie('1. e4 e5 *').chess, { timeControl: '600' }), null);
  assert.equal(tempsDePartie(partie(`1. e4 ${clk('23:59:00')} *`).chess, { timeControl: '1/86400' }), null);
});

// 600 s : les Blancs tombent à 55 s au 3e coup ; les Noirs jouent leur 2e coup en 3 s avec 590 s.
const COUPS = `1. e4 ${clk('0:09:58')} 1... e5 ${clk('0:09:50')} 2. Nf3 ${clk('0:00:55')} 2... Nc6 ${clk('0:09:47')} 3. Bb5 ${clk('0:00:50')} 3... a6 ${clk('0:08:00')} *`;

test('Temps · repères : manque de temps et faute jouée trop vite', () => {
  const { chess, coups } = partie(COUPS);
  const t = tempsDePartie(chess, { timeControl: '600' });
  const o = (classe, cadence = 'rapid', book = {}) => ({ classe, cadence, book });
  assert.equal(repere(t, coups, 4, o('blunder')), 'manque'); // 55 s avant le coup : sous 60 s
  assert.equal(repere(t, coups, 2, o('blunder')), null); // 598 s avant, 543 s de réflexion
  assert.equal(repere(t, coups, 3, o('mistake')), 'vite');
  assert.equal(repere(t, coups, 3, o('inaccuracy')), null); // une imprécision n'est pas repérée
  assert.equal(repere(t, coups, 3, o('mistake', 'blitz')), null); // 3 s > 2 s en blitz
  assert.equal(repere(t, coups, 3, o('mistake', 'bullet')), null);
  assert.equal(repere(t, coups, 3, o('mistake', 'rapid', { [epd(coups[3].after)]: ['C60', 'x'] })), null);
  const resultats = coups.map(() => ({ cls: 'blunder' }));
  // Blancs : 1. e4 en 2 s (vite), 2. Nf3 après une longue réflexion (rien), 3. Bb5 avec 55 s (manque).
  assert.deepEqual(reperesDe(t, coups, resultats, 'w', { cadence: 'rapid' }), [{ ply: 0, repere: 'vite' }, { ply: 4, repere: 'manque' }]);
});

test('Temps · un coup forcé n’est jamais « trop vite »', () => {
  const fen = '7k/8/8/8/8/8/6q1/7K w - - 0 1'; // seul coup : Rxg2
  const { chess, coups } = partie(`[SetUp "1"]\n[FEN "${fen}"]\n\n1. Kxg2 ${clk('0:09:59')} *`);
  assert.equal(chess.history().length, 1);
  const t = tempsDePartie(chess, { timeControl: '600' });
  assert.equal(repere(t, coups, 0, { classe: 'blunder', cadence: 'rapid' }), null);
});

test('Temps · affichage', () => {
  assert.equal(fmtDuree(0.1), '0,1 s');
  assert.equal(fmtDuree(12.4), '12 s');
  assert.equal(fmtDuree(65), '1 min 05');
  assert.equal(fmtDuree(59.7), '1 min 00');
  assert.equal(fmtPendule(582.9), '9:42');
  assert.equal(fmtPendule(3723), '1:02:03');
  assert.equal(fmtPendule(9.4), '0:09,4');
  assert.equal(fmtPendule(0), '0:00,0');
});
