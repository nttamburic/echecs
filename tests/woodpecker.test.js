import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composerJeu, chargerPaquets, bilanJeu, prochainPuzzle, jeuActif, chrono, formatDuree, nouveauJeu,
  cleEssai, fichierJeux, fichierEssais, COL_JEUX, COL_ESSAIS, DELAIS, NB_CYCLES, TAILLES,
} from '../core/woodpecker.js';
import { parseBackup } from '../core/backup.js';

const pack = (prefixe, n = 150) => Array.from({ length: n }, (_, i) => ({ id: prefixe + i, fen: 'f', moves: ['a2a3', 'a7a6'], rating: 1100 + (i % 200), themes: [prefixe], gameUrl: 'x' }));
const JEU = { id: 'w1', creeLe: 1, niveau: 1200, puzzles: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
const jour = (j, h = 12) => new Date(2026, 0, j, h).getTime();
const e = (cycle, puzzle, ok, ms, at, fini = true) => ({ jeu: 'w1', cycle, puzzle, ok, fini, ms, debut: at - ms, at });
const cycleComplet = (n, ms, j) => ['a', 'b', 'c'].map((p) => e(n, p, true, ms, jour(j)));

test('Woodpecker · jeu de la taille demandée, sans doublon, mélangeant les thèmes, par difficulté croissante', () => {
  for (const taille of TAILLES) {
    const partage = pack('x', 20); // les mêmes puzzles dans deux paquets
    const jeu = composerJeu([pack('f'), pack('p'), partage, partage], { taille, niveau: 1200 });
    assert.equal(jeu.length, taille);
    assert.equal(new Set(jeu.map((p) => p.id)).size, taille);
    assert.ok(jeu.some((p) => p.id.startsWith('f')) && jeu.some((p) => p.id.startsWith('p')));
    assert.deepEqual(jeu.map((p) => p.rating), jeu.map((p) => p.rating).sort((a, b) => a - b));
    assert.equal(jeu[0].gameUrl, undefined);
  }
});

test('Woodpecker · paquets insuffisants : le jeu est plus court, sans boucle sans fin', () => {
  assert.equal(composerJeu([pack('f', 30)], { taille: 50, niveau: 1200 }).length, 30);
});

test('Woodpecker · un paquet indisponible est remplacé ; aucun paquet : erreur', async () => {
  const manifest = { theme: ['fork', 'pin', 'skewer'].map((name) => ({ name })) };
  const packs = await chargerPaquets(manifest, async (k, t) => { if (t === 'pin') throw new Error('hors ligne'); return [t]; });
  assert.deepEqual(packs.flat().sort(), ['fork', 'skewer']);
  await assert.rejects(chargerPaquets(manifest, async () => { throw new Error('hors ligne'); }), /hors ligne/);
});

test('Woodpecker · précision, temps et avancement du cycle en cours', () => {
  const essais = [e(1, 'a', true, 10000, jour(2)), e(1, 'b', false, 30000, jour(3)), e(1, 'c', null, 5000, jour(4), false)];
  const b = bilanJeu(JEU, essais, jour(4));
  const c = b.courant;
  assert.equal(c.n, 1);
  assert.deepEqual([c.faits, c.total, c.reussis, c.precision, c.ms, c.moyenne], [2, 3, 1, 50, 45000, 20000]);
  assert.equal(c.jours, 3);
  assert.equal(c.delai, 28);
});

test('Woodpecker · le cycle suivant démarre quand tous les puzzles sont finis, avec le temps gagné', () => {
  const b = bilanJeu(JEU, [...cycleComplet(1, 40000, 2), ...cycleComplet(2, 30000, 10)], jour(20));
  assert.equal(b.courant.n, 3);
  assert.equal(b.cycles[0].termine, true);
  assert.equal(b.cycles[0].jours, 1); // la durée d'un cycle terminé ne grandit plus
  assert.equal(b.cycles[1].gain, 25);
  assert.equal(b.cycles[2].gain, null);
});

test('Woodpecker · après le dernier cycle, le jeu est terminé et n’est plus actif', () => {
  const essais = DELAIS.flatMap((_, i) => cycleComplet(i + 1, 1000, i + 1));
  const b = bilanJeu(JEU, essais);
  assert.equal(b.cycles.length, NB_CYCLES);
  assert.equal(b.termine, true);
  assert.equal(jeuActif([JEU], essais), null);
});

test('Woodpecker · même ordre à chaque cycle ; un puzzle entamé reprend avec son temps et son résultat', () => {
  const entame = e(1, 'b', false, 7000, jour(2), false);
  const essais = [e(1, 'a', true, 1000, jour(2)), entame];
  assert.deepEqual(prochainPuzzle(JEU, essais, 1), { index: 1, puzzle: JEU.puzzles[1], essai: entame });
  assert.equal(prochainPuzzle(JEU, essais, 2).puzzle.id, 'a');
  assert.equal(prochainPuzzle(JEU, cycleComplet(1, 1, 2), 1), null);
});

test('Woodpecker · un seul jeu actif : le plus récent, sauf abandon', () => {
  const vieux = { ...JEU, id: 'w0', creeLe: 0 };
  assert.equal(jeuActif([vieux, JEU], []).id, 'w1');
  assert.equal(jeuActif([vieux, { ...JEU, abandonneLe: 5 }], []).id, 'w0');
});

test('Woodpecker · le temps ne s’écoule que chronomètre lancé', () => {
  let t = 1000;
  const c = chrono(5000, () => t);
  t = 9000;
  assert.equal(c.lire(), 5000);
  c.lancer(); t = 12000; c.lancer(); t = 13000;
  assert.equal(c.lire(), 9000);
  c.arreter(); t = 100000;
  assert.equal(c.lire(), 9000);
  assert.deepEqual([formatDuree(42000), formatDuree(605000), formatDuree(3720000)], ['42 s', '10 min 05 s', '1 h 02 min']);
});

test('Woodpecker · les données passent par la sauvegarde et la restauration', () => {
  const jeu = nouveauJeu([{ id: 'a' }], 1200);
  const records = [
    { col: COL_JEUX, id: jeu.id, data: jeu, updatedAt: 1, file: fichierJeux() },
    { col: COL_ESSAIS, id: cleEssai(jeu.id, 5, 'a'), data: e(5, 'a', true, 1, 2), updatedAt: 1, file: fichierEssais(jeu.id, 5) },
  ];
  assert.equal(parseBackup(JSON.stringify({ app: 'chess-journey', format: 1, records })).records.length, 2);
});
