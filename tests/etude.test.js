import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePgn, chapterToPgn, studyToPgn, newRoot, addChild, removeNode, promote, makeMainline, isMainline, keyOf, nodeAt,
  countMoves, toggleGlyph, toggleShape, START_FEN,
} from '../core/study-pgn.js';

const PGN = `[Event "Mon étude: Italienne"]
[StudyName "Mon étude"]
[ChapterName "Italienne"]
[Orientation "black"]

{ Introduction (avec parenthèses ). } 1. e4 { Le centre. [%cal Ge4d5,Re4f5] [%csl Yd5] } 1... e5 2. Nf3!? (2. Bc4 { Le fou } 2... Nc6 (2... Nf6)) (2. f4?) 2... Nc6 $10 { [%clk 0:01:00] } 3. Bb5 *`;

// Forme comparable d'un arbre, sans les liens vers les parents.
const shape = (n) => ({ san: n.san, comment: n.comment, before: n.before || '', nags: n.nags, shapes: [...n.shapes].sort(), cmds: n.cmds, children: n.children.map(shape) });

test('lecture : variantes, commentaires, symboles et formes', () => {
  const { studyName, chapters, errors } = parsePgn(PGN);
  assert.equal(studyName, 'Mon étude');
  assert.deepEqual(errors, []);
  const [c] = chapters;
  assert.equal(c.name, 'Italienne');
  assert.equal(c.orientation, 'b');
  assert.equal(c.root.comment, 'Introduction (avec parenthèses ).');
  const e4 = c.root.children[0];
  assert.equal(e4.comment, 'Le centre.');
  assert.deepEqual([...e4.shapes].sort(), ['Ge4d5', 'Re4f5', 'Yd5']);
  const e5 = e4.children[0];
  assert.deepEqual(e5.children.map((n) => n.san), ['Nf3', 'Bc4', 'f4']);
  assert.deepEqual(e5.children[0].nags, [5]);
  assert.deepEqual(e5.children[2].nags, [2]);
  assert.deepEqual(e5.children[1].children.map((n) => n.san), ['Nc6', 'Nf6']);
  const nc6 = e5.children[0].children[0];
  assert.deepEqual(nc6.nags, [10]);
  assert.deepEqual(nc6.cmds, ['[%clk 0:01:00]']);
  assert.equal(countMoves(c.root), 9);
});

test('écriture puis relecture : le même arbre', () => {
  const a = parsePgn(PGN);
  const b = parsePgn(studyToPgn(a.studyName, a.chapters));
  assert.deepEqual(shape(b.chapters[0].root), shape(a.chapters[0].root));
  assert.equal(b.chapters[0].orientation, 'b');
  assert.equal(b.chapters[0].name, 'Italienne');
});

test('commentaire placé avant le premier coup d’une variante', () => {
  const { chapters } = parsePgn('1. e4 ({ Autre idée. } 1. d4 d5) 1... c5 *');
  assert.equal(chapters[0].root.children[1].before, 'Autre idée.');
  const again = parsePgn(chapterToPgn(chapters[0])).chapters[0];
  assert.equal(again.root.children[1].before, 'Autre idée.');
  assert.equal(again.root.children[0].children[0].san, 'c5');
});

test('position de départ personnalisée, numéros des Noirs, position sans roi', () => {
  const { chapters, skipped } = parsePgn('[FEN "8/8/8/3p4/8/8/3P4/8 b - - 0 12"]\n[SetUp "1"]\n\n12... d4 13. d3 *');
  assert.equal(skipped, 0);
  assert.equal(countMoves(chapters[0].root), 2);
  assert.match(chapterToPgn(chapters[0]), /12\.\.\. d4 13\. d3 \*/);
});

test('un coup illisible arrête sa ligne seulement', () => {
  const { chapters, errors } = parsePgn('1. e4 (1. d4 Qh8 2. c4) 1... e5 *');
  assert.deepEqual(errors, ['Qh8']);
  assert.equal(chapters[0].root.children[0].children[0].san, 'e5');
  assert.equal(chapters[0].root.children[1].children.length, 0);
});

test('commentaire jamais refermé : la partie suivante reste lue', () => {
  const { chapters } = parsePgn('[Event "A"]\n\n{ ouvert\n\n[Event "B"]\n\n{ texte } 1. e4 *');
  assert.deepEqual(chapters.map((c) => c.name), ['A', 'B']);
  assert.equal(chapters[0].root.comment, 'ouvert');
});

test('texte sans aucune partie : aucun chapitre', () => {
  assert.equal(parsePgn('').chapters.length, 0);
  assert.equal(parsePgn('bonjour tout le monde').chapters.length, 0);
});

test('arbre : coup existant réutilisé, promotion, ligne principale, suppression', () => {
  const root = newRoot();
  const e4 = addChild(root, 'e2e4');
  assert.equal(addChild(root, 'e4'), e4);
  assert.equal(addChild(root, 'e2e5'), null);
  const d4 = addChild(root, 'd4');
  const d5 = addChild(d4, 'd5');
  const nf6 = addChild(d4, 'Nf6');
  assert.equal(isMainline(nf6), false);
  assert.equal(keyOf(nf6), '1.1');
  assert.equal(nodeAt(root, '1.1'), nf6);
  assert.equal(promote(nf6), true);
  assert.deepEqual(d4.children, [nf6, d5]);
  assert.equal(makeMainline(nf6), true);
  assert.deepEqual(root.children, [d4, e4]);
  assert.equal(isMainline(nf6), true);
  assert.equal(promote(nf6), false);
  removeNode(d4);
  assert.deepEqual(root.children, [e4]);
  assert.equal(root.fen, START_FEN);
});

test('symboles et formes : un seul symbole de coup, bascule des flèches', () => {
  const n = addChild(newRoot(), 'e4');
  toggleGlyph(n, 1); toggleGlyph(n, 16); toggleGlyph(n, 3); toggleGlyph(n, 146); toggleGlyph(n, 36);
  assert.deepEqual(n.nags, [16, 3, 146, 36]);
  toggleGlyph(n, 3);
  assert.deepEqual(n.nags, [16, 146, 36]);
  toggleShape(n, 'G', 'e2', 'e4'); toggleShape(n, 'R', 'd5', 'd5');
  assert.deepEqual(n.shapes, ['Ge2e4', 'Rd5']);
  toggleShape(n, 'B', 'e2', 'e4');
  assert.deepEqual(n.shapes, ['Rd5', 'Be2e4']);
  toggleShape(n, 'R', 'd5', 'd5');
  assert.deepEqual(n.shapes, ['Be2e4']);
});
