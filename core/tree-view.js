// Arbre des coups façon Lichess, commun à « Étude » et aux cours de finales : ligne principale en
// deux colonnes, commentaires et variantes intercalés. Mise en forme dans study.css.
// Nœud : { parent, children, fen (après le coup), comment, before }. La racine n'a pas de coup.

// Couleur du symbole de coup (codes NAG 1 à 6, mêmes familles que Lichess).
export const GLYPH_CLASS = { 1: 'g-good', 2: 'g-mistake', 3: 'g-brilliant', 4: 'g-blunder', 5: 'g-interesting', 6: 'g-dubious' };

export const moveNo = (node) => { const f = node.parent.fen.split(' '); return `${f[5]}${f[1] === 'w' ? '.' : '…'}`; };

// move(node, classe) et comment(node, texte, classe) renvoient le HTML d'un coup et d'un commentaire.
export function treeHtml(root, { move, comment }) {
  // Une variante : suite de coups sur une ligne ; ses propres embranchements sont entre parenthèses.
  const inlineLine = (first) => {
    let out = '';
    let node = first, force = true;
    let siblings = []; // variantes du coup en cours d'écriture, écrites juste après lui
    while (node) {
      if (node.before) { out += comment(node, node.before, 'before'); force = true; }
      const white = node.parent.fen.split(' ')[1] === 'w';
      if (white || force) out += `<span class="st-vno">${moveNo(node)}</span>`;
      out += move(node, 'inline');
      force = false;
      if (node.comment) { out += comment(node, node.comment); force = true; }
      for (const alt of siblings) { out += `<span class="st-par">(${inlineLine(alt)})</span> `; force = true; }
      siblings = node.children.slice(1);
      node = node.children[0];
    }
    return out;
  };

  let out = '';
  if (root.comment) out += `<div class="st-block">${comment(root, root.comment)}</div>`;
  let row = null; // rangée en cours : { no, cells: [] }
  const close = () => {
    if (!row) return;
    while (row.cells.length < 2) row.cells.push('<span class="st-gap"></span>');
    out += `<div class="st-row"><span class="mno">${row.no}</span>${row.cells.join('')}</div>`;
    row = null;
  };
  let p = root;
  while (p.children.length) {
    const [main, ...alts] = p.children;
    const [turn, no] = [main.parent.fen.split(' ')[1], main.parent.fen.split(' ')[5]];
    if (main.before) { close(); out += `<div class="st-block">${comment(main, main.before, 'before')}</div>`; }
    if (turn === 'w') { close(); row = { no, cells: [] }; }
    else if (!row) row = { no, cells: ['<span class="st-gap">…</span>'] };
    row.cells.push(move(main, ''));
    if (main.comment || alts.length) {
      if (turn === 'w' && main.children.length) row.cells.push('<span class="st-gap">…</span>');
      close();
      if (main.comment) out += `<div class="st-block">${comment(main, main.comment)}</div>`;
      if (alts.length) out += `<div class="st-vars">${alts.map((a) => `<div class="st-var">${inlineLine(a)}</div>`).join('')}</div>`;
    } else if (turn === 'b') close();
    p = main;
  }
  close();
  return out;
}

// Amène le coup courant dans la partie visible de la liste, sans faire défiler la page.
export function showInList(box, cur) {
  const r = cur.getBoundingClientRect(), b = box.getBoundingClientRect();
  if (r.top < b.top + 8) box.scrollTop -= b.top - r.top + b.height / 3;
  else if (r.bottom > b.bottom - 8) box.scrollTop += r.bottom - b.bottom + b.height / 3;
}
