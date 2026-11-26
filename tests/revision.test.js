import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import {
  candidats, clesArchivees, coupsDe, debutDeJournee, evaluer, exerciceDe, fileRevision, noteDe,
  occasionConversion, occasionsConversion, verdictConnu,
} from '../core/revision.js';

const FINALE = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
const MAINTENANT = new Date(2026, 10, 26, 12).getTime();
const HIER = MAINTENANT / 1000 - 86400;

function partie(san, { fen, id = 'p1', end = HIER, resultat = 'repetition', result = '1/2-1/2' } = {}) {
  const c = new Chess(fen);
  for (const s of san.split(' ')) c.move(s);
  return { id, end, result, pgn: c.pgn(), white: { name: 'Moi', rating: 1500, result: resultat }, black: { name: 'Autre', rating: 1550, result: 'x' } };
}
const pos = (meilleur, cp, joue = cp) => ({ lines: [{ pv: [meilleur], score: { cp } }, { pv: ['e1f2'], score: { cp: cp - 20 } }], played: { pv: [], score: { cp: joue } } });
// Une faute en finale : le coup joué (Kd1) laisse filer le gain.
const faute = (options) => ({ game: partie('Kd1', { fen: FINALE, ...options }), positions: [pos('e2e4', 600, 0)] });

test('Trouvez mieux · exercice tiré d’une faute ; rien si le coup joué était le meilleur', () => {
  const d = faute();
  const ex = exerciceDe(d, coupsDe(d.game), 0, { gravite: 'blunder' });
  assert.deepEqual([ex.key, ex.color, ex.joue, ex.meilleur, ex.adversaire, ex.gravite], ['p1:0', 'w', 'e1d1', 'e2e4', 'Autre', 'blunder']);
  assert.equal(ex.precedent, null);
  assert.equal(exerciceDe({ ...d, positions: [pos('e1d1', 600)] }, coupsDe(d.game), 0), null);
  assert.equal(exerciceDe({ ...d, positions: [null] }, coupsDe(d.game), 0), null);
});

test('Trouvez mieux · verdict : meilleur, coup de la partie, ligne connue, sinon moteur', () => {
  const d = faute();
  const ex = exerciceDe(d, coupsDe(d.game), 0);
  assert.equal(verdictConnu(ex, 'e2e4'), 'juste');
  assert.equal(verdictConnu(ex, 'e1d1'), 'partie');
  assert.equal(verdictConnu(ex, 'e1f2'), 'juste'); // à 0,2 pion du meilleur dans une position gagnante
  assert.equal(verdictConnu(ex, 'e1d2'), null);
});

test('Trouvez mieux · un mat est toujours juste', () => {
  const ex = { fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', color: 'w', meilleur: 'g1f1', joue: 'g1h1', lignes: [] };
  assert.equal(verdictConnu(ex, 'a1a8'), 'juste');
});

test('Trouvez mieux · seuils : équivalent, bon mais perfectible, faux ; pour les Noirs aussi', () => {
  assert.equal(evaluer('w', { cp: 100 }, { cp: 90 }), 'juste');
  assert.equal(evaluer('w', { cp: 100 }, { cp: 50 }), 'proche');
  assert.equal(evaluer('w', { cp: 100 }, { cp: -150 }), 'faux');
  assert.equal(evaluer('b', { cp: -100 }, { cp: 150 }), 'faux');
  assert.equal(evaluer('b', { cp: -100 }, { cp: -400 }), 'juste');
});

test('Révision · note : un coup faux ou la solution comptent comme un échec', () => {
  assert.equal(noteDe({}), 'good');
  assert.equal(noteDe({ indice: true }), 'hard');
  assert.equal(noteDe({ fautes: 1, indice: true }), 'again');
  assert.equal(noteDe({ solution: true }), 'again');
});

test('Révision · candidats : fautes récentes, sans doublon, les archivées écartées', () => {
  const rows = [
    { data: faute({ id: 'vieux', end: HIER - 200 * 86400 }) },
    { data: faute({ id: 'ancien', end: HIER - 5000 }) },
    { data: faute({ id: 'recent' }) },
    { data: faute({ id: 'archive' }) },
  ];
  const travaux = [{ id: 'f:archive:1', data: { archivee: true } }, { id: 'g:recent:1', data: { travaillee: true } }];
  assert.deepEqual(candidats(rows, 'moi', {}, undefined, travaux, MAINTENANT).map((e) => e.key), ['recent:0', 'ancien:0']);
  assert.deepEqual(candidats(rows, 'inconnu', {}, undefined, [], MAINTENANT), []);
  assert.deepEqual([...clesArchivees([{ id: 'g:a-b:12', data: { archivee: true } }])], ['a-b:11']);
});

test('Révision · file : cartes dues d’abord, puis les nouvelles dans la limite du jour', () => {
  const ex = (key) => ({ key });
  const carte = (key, due, first = 0) => [key, { exercice: ex(key), card: { due }, first }];
  const cartes = new Map([
    carte('due-tard', MAINTENANT - 10), carte('due-tot', MAINTENANT - 1000),
    carte('pas-due', MAINTENANT + 86400000, MAINTENANT - 60000), carte('archivee', 0),
  ]);
  const liste = ['due-tot', 'n1', 'n2', 'n3'].map(ex);
  const f = fileRevision(liste, cartes, new Set(['archivee']), MAINTENANT, 3);
  assert.deepEqual(f.dues.map((e) => e.key), ['due-tot', 'due-tard']);
  assert.deepEqual(f.nouvelles.map((e) => e.key), ['n1', 'n2']); // une nouvelle déjà commencée aujourd'hui
  assert.equal(f.enAttente, 3);
});

test('Révision · la journée commence à 4 h', () => {
  assert.equal(debutDeJournee(new Date(2026, 10, 26, 2).getTime()), new Date(2026, 10, 25, 4).getTime());
  assert.equal(debutDeJournee(new Date(2026, 10, 26, 9).getTime()), new Date(2026, 10, 26, 4).getTime());
});

const SAN = 'e4 e5 Nf3 Nc6 Bc4 Bc5';
const conversion = (cps, options) => ({ game: partie(SAN, options), positions: cps.map((cp) => ({ lines: [{ pv: ['a2a3'], score: { cp } }] })) });

test('Convertir · première position gagnante qui le reste au coup suivant', () => {
  const o = occasionConversion(conversion([500, 20, 20, 20, 600, 600]), 'moi');
  assert.equal(o.ply, 4); // le pic du premier coup ne tient pas
  assert.deepEqual([o.color, o.adversaire, o.elo, o.nulle], ['w', 'Autre', 1550, true]);
});

test('Convertir · rien si la partie est gagnée, si l’avantage ne tient pas ou n’est pas le vôtre', () => {
  assert.equal(occasionConversion(conversion([600, 600, 600, 600, 600, 600], { resultat: 'win' }), 'moi'), null);
  assert.equal(occasionConversion(conversion([600, 600, 0, 0, 0, 0]), 'moi'), null);
  assert.equal(occasionConversion(conversion([-600, -600, -600, -600, -600, -600]), 'moi'), null);
});

test('Convertir · liste : les réussies après les autres, les retirées absentes', () => {
  const gagnante = [600, 600, 600, 600, 600, 600];
  const rows = ['a', 'b', 'c'].map((id, i) => ({ data: conversion(gagnante, { id, end: HIER - i }) }));
  const suivis = new Map([['a', { reussie: true }], ['c', { archivee: true }]]);
  assert.deepEqual(occasionsConversion(rows, 'moi', suivis, MAINTENANT).map((o) => o.id), ['b', 'a']);
});
