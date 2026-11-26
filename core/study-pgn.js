// Module « Étude » — arbre d'un chapitre et PGN (format des études Lichess).
// Un chapitre = des en-têtes PGN + un arbre. Contrairement au répertoire d'ouvertures (ensemble
// d'arêtes), une étude est un vrai arbre : le même coup commenté sur deux lignes reste distinct.
//
//   racine : { fen, comment, shapes, cmds, nags: [], children, parent: null }
//   nœud   : { san, uci, color, fen (après le coup), before (texte avant le coup, début de variante),
//              comment, nags: [numéros $n], shapes: ['Ge2e4' flèche, 'Rd5' cercle], cmds, children, parent }
// children[0] est la ligne principale, les suivants sont les variantes.
// shapes ↔ [%cal …] et [%csl …]. Les autres commandes ([%clk …], [%eval …]) sont gardées dans cmds.
import { Chess } from '../vendor/chess.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Les études Lichess contiennent des positions pédagogiques sans roi : chess.js les accepte sans contrôle.
export const chessAt = (fen) => new Chess(fen, { skipValidation: true });

const blank = () => ({ comment: '', nags: [], shapes: [], cmds: [], children: [] });
export const newRoot = (fen = START_FEN) => ({ ...blank(), fen, parent: null });

// ------------------------------------------------------------------ arbre
export function pathOf(node) {
  const out = [];
  for (let n = node; n && n.parent; n = n.parent) out.unshift(n);
  return out;
}
// Chemin « 0.1.0 » (indices des enfants) : sert à retrouver un nœud après relecture du PGN.
export const keyOf = (node) => pathOf(node).map((n) => n.parent.children.indexOf(n)).join('.');
export function nodeAt(root, key) {
  let n = root;
  for (const i of key ? key.split('.') : []) {
    if (!n.children[+i]) break;
    n = n.children[+i];
  }
  return n;
}
export function countMoves(root) {
  let n = 0;
  const todo = [root];
  while (todo.length) { const x = todo.pop(); n += x.children.length; todo.push(...x.children); }
  return n;
}
export const isMainline = (node) => pathOf(node).every((n) => n.parent.children[0] === n);

// Joue un coup (SAN, UCI ou { from, to, promotion }) après « parent ». Renvoie l'enfant existant ou
// nouveau, ou null si le coup est illégal.
export function addChild(parent, move) {
  let m = null;
  try {
    const c = chessAt(parent.fen);
    if (typeof move === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) m = c.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
    else m = c.move(move);
  } catch { return null; }
  if (!m || m.san === '--') return null;
  const uci = m.from + m.to + (m.promotion || '');
  const old = parent.children.find((x) => x.uci === uci);
  if (old) return old;
  const node = { ...blank(), san: m.san, uci, color: m.color, fen: m.after, before: '', parent };
  parent.children.push(node);
  return node;
}

export function removeNode(node) {
  const list = node.parent.children;
  const i = list.indexOf(node);
  if (i >= 0) list.splice(i, 1);
  return i;
}
// Monte d'un rang la variante qui contient « node » (au premier embranchement en remontant qui n'est
// pas déjà en tête). Renvoie false si le coup est déjà sur la ligne principale.
export function promote(node) {
  for (let n = node; n && n.parent; n = n.parent) {
    const list = n.parent.children;
    const i = list.indexOf(n);
    if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; return true; }
  }
  return false;
}
export function makeMainline(node) {
  let changed = false;
  while (promote(node)) changed = true;
  return changed;
}

// ------------------------------------------------------------------ symboles d'annotation (NAG)
// Un seul symbole « coup » et un seul « évaluation » à la fois ; les observations se cumulent.
export const GLYPHS = {
  move: [[1, '!', 'Bon coup'], [2, '?', 'Erreur'], [3, '!!', 'Coup brillant'], [4, '??', 'Gaffe'], [5, '!?', 'Coup intéressant'], [6, '?!', 'Coup douteux'], [7, '□', 'Seul coup'], [22, '⨀', 'Zugzwang']],
  position: [[10, '=', 'Égalité'], [13, '∞', 'Position incertaine'], [14, '⩲', 'Les Blancs sont un peu mieux'], [15, '⩱', 'Les Noirs sont un peu mieux'], [16, '±', 'Les Blancs sont mieux'], [17, '∓', 'Les Noirs sont mieux'], [18, '+−', 'Les Blancs gagnent'], [19, '−+', 'Les Noirs gagnent']],
  observation: [[146, 'N', 'Nouveauté'], [32, '↑↑', 'Développement'], [36, '↑', 'Initiative'], [40, '→', 'Attaque'], [132, '⇆', 'Contre-jeu'], [138, '⊕', 'Zeitnot'], [44, '=∞', 'Compensation'], [140, '∆', 'Avec l’idée']],
};
const GLYPH_BY_NAG = new Map(Object.entries(GLYPHS).flatMap(([group, list]) => list.map(([nag, sym, label]) => [nag, { nag, sym, label, group }])));
export const glyphOf = (nag) => GLYPH_BY_NAG.get(nag) || null;
export function toggleGlyph(node, nag) {
  if (node.nags.includes(nag)) { node.nags = node.nags.filter((n) => n !== nag); return; }
  const g = glyphOf(nag);
  if (g && g.group !== 'observation') node.nags = node.nags.filter((n) => glyphOf(n)?.group !== g.group);
  node.nags = [...node.nags, nag];
}

// ------------------------------------------------------------------ formes (flèches et cercles)
export const BRUSHES = { G: '#15781b', R: '#c62d2d', B: '#1565c0', Y: '#e68f00' };
const SHAPE_RE = /^[GRBY](?:[a-h][1-8]){1,2}$/;
// Ajoute la forme, ou la retire si elle est déjà là ; même tracé d'une autre couleur : la couleur change.
export function toggleShape(node, brush, from, to) {
  const squares = from === to ? from : from + to;
  const shape = brush + squares;
  const had = node.shapes.includes(shape);
  node.shapes = node.shapes.filter((s) => s.slice(1) !== squares);
  if (!had) node.shapes.push(shape);
}

// ------------------------------------------------------------------ commentaires
const CMD_RE = /\[%(\w+)((?:\s+|,)?(?:"[^"]*"|[^\]"])*)\]/g;
// Texte d'un commentaire PGN → { text, shapes, cmds }.
export function parseComment(raw) {
  const shapes = [];
  const cmds = [];
  const text = String(raw).replace(CMD_RE, (all, name, args) => {
    if (name === 'cal' || name === 'csl') {
      for (const s of args.split(',').map((x) => x.trim())) if (SHAPE_RE.test(s)) shapes.push(s);
    } else cmds.push(all);
    return ' ';
  }).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
  return { text, shapes, cmds };
}
const join = (a, b) => (a && b ? `${a}\n${b}` : a || b);
function addComment(node, raw) {
  const c = parseComment(raw);
  node.comment = join(node.comment, c.text);
  for (const s of c.shapes) if (!node.shapes.includes(s)) node.shapes.push(s);
  node.cmds.push(...c.cmds);
}

// ------------------------------------------------------------------ lecture du PGN
const TOKEN_RE = /\s+|\[\s*(\w+)\s+"((?:\\.|[^"\\])*)"\s*\]|\{([^}]*)(?:\}|$)|;[^\n]*|^%[^\n]*|(\()|(\))|\$(\d+)|(1-0|0-1|1\/2-1\/2|\*)|([^\s(){};$]+)/gmy;
const SUFFIX = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
const SYMBOLS = new Map(Object.values(GLYPHS).flat().map(([nag, sym]) => [sym, nag]));

// Découpe le texte en parties : { headers, tokens: [[type, valeur]] }.
function splitGames(text) {
  const src = String(text || '').replace(/^﻿/, '').replace(/\r/g, '');
  const games = [];
  let game = null, moves = false, depth = 0;
  const open = () => { game = { headers: {}, tokens: [] }; games.push(game); moves = false; depth = 0; };
  TOKEN_RE.lastIndex = 0;
  let at = 0;
  while (at < src.length) {
    TOKEN_RE.lastIndex = at;
    const m = TOKEN_RE.exec(src);
    if (!m) { at++; continue; } // caractère isolé illisible (« } » orpheline…)
    at = TOKEN_RE.lastIndex;
    let [, tag, value, comment, po, pc, nag, result, word] = m;
    // commentaire jamais refermé : il s'arrête à la partie suivante, sinon il l'avalerait
    const cut = comment === undefined ? -1 : comment.search(/\n\s*\n\[Event "/);
    if (cut >= 0) { comment = comment.slice(0, cut); at = m.index + 1 + cut; }
    if (tag !== undefined) {
      if (!game || moves) open();
      game.headers[tag] = value.replace(/\\(["\\])/g, '$1');
      continue;
    }
    if (comment === undefined && !po && !pc && nag === undefined && !result && word === undefined) continue;
    if (!game) open();
    moves = true;
    if (comment !== undefined) game.tokens.push(['c', comment]);
    else if (po) { depth++; game.tokens.push(['(']); }
    else if (pc) { depth--; game.tokens.push([')']); }
    else if (nag !== undefined) game.tokens.push(['n', Number(nag)]);
    else if (result) { if (depth <= 0) { game.headers.Result ||= result; game = null; } }
    else game.tokens.push(['m', word]);
  }
  return games;
}

function buildTree(headers, tokens, errors) {
  const fen = headers.FEN || START_FEN;
  const full = fen.trim().split(/\s+/);
  while (full.length < 6) full.push(['w', '-', '-', '0', '1'][full.length - 1]);
  const root = newRoot(full.join(' '));
  chessAt(root.fen); // lève une erreur si la position est illisible
  // cur : dernier coup lu ; started : false au début d'une variante (le commentaire précède le coup)
  let cur = { node: root, started: true, broken: false, before: '', pre: [] };
  const stack = [];
  for (const [type, v] of tokens) {
    if (type === '(') {
      stack.push(cur);
      const from = cur.node.parent;
      cur = { node: from || cur.node, started: false, broken: cur.broken || !from, before: '', pre: [] };
    } else if (type === ')') {
      if (stack.length) cur = stack.pop();
    } else if (cur.broken) {
      continue;
    } else if (type === 'c') {
      if (cur.started) addComment(cur.node, v); else cur.pre.push(v);
    } else if (type === 'n') {
      if (cur.started && cur.node.parent && v > 0 && !cur.node.nags.includes(v)) cur.node.nags.push(v);
    } else {
      let t = v.replace(/^\d+\.(\.\.)?/, '').replace(/^\.+/, '').replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O');
      if (!t || /^\d+\.*$/.test(t)) continue;
      if (SYMBOLS.has(t)) { const n = SYMBOLS.get(t); if (cur.started && cur.node.parent && !cur.node.nags.includes(n)) cur.node.nags.push(n); continue; }
      let suffix = '';
      t = t.replace(/[!?]+$/, (s) => { suffix = s; return ''; });
      const node = addChild(cur.node, t);
      if (!node) { cur.broken = true; if (errors.length < 5) errors.push(t); continue; }
      if (SUFFIX[suffix] && !node.nags.includes(SUFFIX[suffix])) node.nags.push(SUFFIX[suffix]);
      for (const raw of cur.pre) {
        const c = parseComment(raw);
        node.before = join(node.before, c.text);
        node.cmds.push(...c.cmds);
        for (const s of c.shapes) if (!node.shapes.includes(s)) node.shapes.push(s);
      }
      cur.pre = [];
      cur.node = node;
      cur.started = true;
    }
  }
  return root;
}

// Nom d'un chapitre : [ChapterName], sinon les joueurs, sinon [Event] (« Étude: Chapitre » chez Lichess).
export function chapterName(headers, i = 0) {
  const known = (s) => (s && !/^[?\s.-]*$/.test(s) ? s.trim() : '');
  if (known(headers.ChapterName)) return headers.ChapterName.trim();
  const w = known(headers.White), b = known(headers.Black);
  if (w && b) return `${w} - ${b}`;
  let ev = known(headers.Event);
  const study = known(headers.StudyName);
  if (study && ev.startsWith(study + ':')) ev = ev.slice(study.length + 1).trim();
  return ev || `Chapitre ${i + 1}`;
}

// PGN (une ou plusieurs parties) → { studyName, chapters: [{ name, orientation, headers, root }],
// skipped (parties illisibles), errors (premiers coups refusés : la ligne s'arrête là) }.
export function parsePgn(text) {
  const chapters = [];
  const errors = [];
  let skipped = 0, studyName = '';
  for (const g of splitGames(text)) {
    let root;
    try { root = buildTree(g.headers, g.tokens, errors); } catch { skipped++; continue; }
    // une « partie » sans en-tête, sans coup ni commentaire est du texte parasite
    if (!Object.keys(g.headers).length && !root.children.length && !root.comment) continue;
    // du texte quelconque, dont aucun mot n'est un coup, n'est pas un chapitre
    if (!Object.keys(g.headers).length && !root.children.length && g.tokens.some((t) => t[0] === 'm')) { skipped++; continue; }
    studyName ||= g.headers.StudyName || '';
    const name = chapterName(g.headers, chapters.length);
    // [Event] est réécrit avec le nom du chapitre : le tournoi d'une partie ordinaire est mis de côté
    const ev = g.headers.Event;
    if (!g.headers.StudyName && ev && ev !== name && !/^[?\s.-]*$/.test(ev)) g.headers.Tournament ||= ev;
    chapters.push({
      name,
      orientation: g.headers.Orientation === 'black' ? 'b' : 'w',
      headers: g.headers,
      root,
    });
  }
  return { studyName, chapters, skipped, errors };
}

// ------------------------------------------------------------------ écriture du PGN
const clean = (s) => String(s).replace(/\}/g, ')');
function commentToken(text, shapes = [], cmds = []) {
  const cal = shapes.filter((s) => s.length === 5), csl = shapes.filter((s) => s.length === 3);
  const parts = [...cmds, csl.length ? `[%csl ${csl.join(',')}]` : '', cal.length ? `[%cal ${cal.join(',')}]` : '', clean(text || '').trim()].filter(Boolean);
  return parts.length ? `{ ${parts.join(' ')} }` : '';
}

function moveText(root) {
  const out = [];
  const first = commentToken(root.comment, root.shapes, root.cmds);
  if (first) out.push(first);
  // Écrit un coup ; renvoie true si le coup noir suivant doit répéter le numéro.
  const write = (node, force) => {
    if (node.before) out.push(commentToken(node.before));
    const f = node.parent.fen.split(' ');
    const no = f[1] === 'w' ? `${f[5]}. ` : force || node.before ? `${f[5]}... ` : '';
    out.push(no + node.san);
    for (const n of node.nags) out.push('$' + n);
    const c = commentToken(node.comment, node.shapes, node.cmds);
    if (c) out.push(c);
    return !!c;
  };
  // Suite à partir de « parent » : coup principal, variantes entre parenthèses, puis la suite.
  const line = (parent, force) => {
    let p = parent;
    while (p.children.length) {
      const [main, ...others] = p.children;
      let again = write(main, force);
      for (const alt of others) {
        out.push('(');
        line(alt, write(alt, true));
        out.push(')');
        again = true;
      }
      force = again;
      p = main;
    }
  };
  line(root, true);
  return out;
}

const tag = (k, v) => `[${k} "${String(v).replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
// En-têtes écrits à partir du chapitre lui-même (les autres sont repris tels quels).
export const MANAGED_TAGS = ['Event', 'StudyName', 'ChapterName', 'Orientation', 'Result', 'SetUp', 'FEN'];

export function chapterToPgn(chapter, studyName = '') {
  const h = chapter.headers || {};
  const result = h.Result || '*';
  const head = [tag('Event', studyName ? `${studyName}: ${chapter.name}` : chapter.name)];
  for (const [k, v] of Object.entries(h)) if (!MANAGED_TAGS.includes(k) && /^\w+$/.test(k) && v !== '') head.push(tag(k, v));
  head.push(tag('Result', result));
  if (studyName) head.push(tag('StudyName', studyName));
  head.push(tag('ChapterName', chapter.name), tag('Orientation', chapter.orientation === 'b' ? 'black' : 'white'));
  if (chapter.root.fen !== START_FEN) head.push(tag('SetUp', '1'), tag('FEN', chapter.root.fen));
  // les parenthèses des variantes sont collées ici, jamais par remplacement dans le texte : les commentaires en contiennent aussi
  let text = '';
  for (const t of [...moveText(chapter.root), result]) text += (!text || text.endsWith('(') && text.at(-2) !== '{' || t === ')' ? '' : ' ') + t;
  return `${head.join('\n')}\n\n${text}\n`;
}

export const studyToPgn = (name, chapters) => chapters.map((c) => chapterToPgn(c, name)).join('\n\n');
