// Module « Analyse libre » : page d'accueil (Nouvelle analyse / Définir la position) et éditeur de position.
import { Chess, validateFen } from '../vendor/chess.js';
import { $ } from '../core/ui.js';
import { stashFree } from './analyse.js';

const FILES = 'abcdefgh';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const NAMES = { K: 'Roi', Q: 'Dame', R: 'Tour', B: 'Fou', N: 'Cavalier', P: 'Pion' };

// ------------------------------------------------------------------ page d'accueil
// Petit échiquier statique (accueil) : cases du thème et pièces cburnett.
function miniBoard(placementStr, size = 150) {
  let html = '';
  const rows = placementStr.split('/');
  for (let y = 0; y < 8; y++) {
    let x = 0;
    const cells = {};
    for (const ch of rows[y]) { if (/\d/.test(ch)) x += +ch; else { cells[x] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase(); x++; } }
    for (let c = 0; c < 8; c++) html += `<span class="mb-sq ${(c + y) % 2 ? 'd' : 'l'}">${cells[c] ? `<img src="pieces/${cells[c]}.svg" alt="">` : ''}</span>`;
  }
  return `<span class="mini-board" style="width:${size}px;height:${size}px" aria-hidden="true">${html}</span>`;
}

export function renderHome(el) {
  el.innerHTML = `<header class="free-head"><h1 class="page-title">Analyse libre</h1>
      <p class="muted">Explorez une position avec Stockfish, sans partie associée.</p></header>
    <div class="free-cards">
      <a class="card free-card" href="#/free/new">
        ${miniBoard(START)}
        <div><h2>Nouvelle analyse</h2><p class="muted">Depuis la position de départ. Jouez les coups des deux camps, le moteur suit.</p>
          <span class="btn primary fc-cta">Commencer</span></div>
      </a>
      <a class="card free-card" href="#/free/setup">
        ${miniBoard('8/5pk1/6p1/8/3R4/6P1/5PK1/1r6')}
        <div><h2>Définir la position</h2><p class="muted">Placez les pièces, collez un FEN, choisissez le trait et les roques.</p>
          <span class="btn fc-cta">Ouvrir l’éditeur</span></div>
      </a>
    </div>
    <form id="free-fen-form" class="free-fen"><label for="free-fen">Coller un FEN</label>
      <div class="row"><input id="free-fen" spellcheck="false" autocomplete="off" placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1">
      <button class="btn" type="submit">Analyser</button></div>
      <p id="free-fen-err" class="small err" role="alert"></p></form>`;
  $('#free-fen-form', el).onsubmit = (e) => {
    e.preventDefault();
    const v = $('#free-fen').value.trim();
    const full = v.split(/\s+/).length === 1 ? v + ' w - - 0 1' : v;
    const r = validateFen(full);
    if (!r.ok) { $('#free-fen-err').textContent = 'FEN invalide : ' + r.error; return; }
    stashFree({ fen: full, orient: full.split(' ')[1] === 'b' ? 'b' : 'w' });
    location.hash = '#/free/new';
  };
}

// ------------------------------------------------------------------ éditeur
const E = { pos: {}, turn: 'w', castle: { K: false, Q: false, k: false, q: false }, orient: 'w', tool: 'move', drag: null, el: null };

function parsePlacement(pl) {
  const pos = {};
  const rows = pl.split('/');
  if (rows.length !== 8) throw new Error('8 rangées attendues');
  rows.forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else if (/[KQRBNPkqrbnp]/.test(ch)) { if (f > 7) throw new Error('rangée trop longue'); pos[FILES[f] + (8 - i)] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase(); f++; }
      else throw new Error('caractère inconnu « ' + ch + ' »');
    }
    if (f !== 8) throw new Error('rangée ' + (8 - i) + ' incomplète');
  });
  return pos;
}

function placement() {
  let s = '';
  for (let r = 8; r >= 1; r--) {
    let empty = 0;
    for (const f of FILES) {
      const p = E.pos[f + r];
      if (!p) { empty++; continue; }
      if (empty) { s += empty; empty = 0; }
      s += p[0] === 'w' ? p[1] : p[1].toLowerCase();
    }
    if (empty) s += empty;
    if (r > 1) s += '/';
  }
  return s;
}

// Roques possibles seulement si le roi et la tour sont sur leurs cases d'origine.
const CASTLE_REQ = { K: ['e1', 'wK', 'h1', 'wR'], Q: ['e1', 'wK', 'a1', 'wR'], k: ['e8', 'bK', 'h8', 'bR'], q: ['e8', 'bK', 'a8', 'bR'] };
const castleOk = (k) => { const [ks, kp, rs, rp] = CASTLE_REQ[k]; return E.pos[ks] === kp && E.pos[rs] === rp; };

function fen() {
  const c = Object.keys(E.castle).filter((k) => E.castle[k] && castleOk(k)).join('') || '-';
  return `${placement()} ${E.turn} ${c} - 0 1`;
}

// Position valide ? Renvoie un message d'erreur en français, ou null.
function problem() {
  const all = Object.values(E.pos);
  const n = (p) => all.filter((x) => x === p).length;
  if (n('wK') !== 1) return n('wK') ? `Il ne peut y avoir qu'un seul roi blanc (${n('wK')} placés).` : 'Placez le roi blanc.';
  if (n('bK') !== 1) return n('bK') ? `Il ne peut y avoir qu'un seul roi noir (${n('bK')} placés).` : 'Placez le roi noir.';
  if (Object.entries(E.pos).some(([sq, p]) => p[1] === 'P' && (sq[1] === '1' || sq[1] === '8'))) return 'Un pion ne peut pas être sur la 1re ou la 8e rangée.';
  for (const c of ['w', 'b']) {
    const mine = all.filter((x) => x[0] === c);
    if (mine.length > 16) return `Trop de pièces ${c === 'w' ? 'blanches' : 'noires'} (16 au maximum).`;
    if (mine.filter((x) => x[1] === 'P').length > 8) return `Trop de pions ${c === 'w' ? 'blancs' : 'noirs'} (8 au maximum).`;
  }
  const f = fen();
  const v = validateFen(f);
  if (!v.ok) return 'Position impossible : ' + v.error;
  // le camp qui n'a pas le trait ne peut pas être en échec
  const other = f.replace(/ [wb] /, ` ${E.turn === 'w' ? 'b' : 'w'} `);
  try { if (new Chess(other).inCheck()) return `Le roi ${E.turn === 'w' ? 'noir' : 'blanc'} est en échec alors que ce sont les ${E.turn === 'w' ? 'Blancs' : 'Noirs'} qui ont le trait : position impossible.`; } catch { /* */ }
  return null;
}

function coords(sq) {
  const f = FILES.indexOf(sq[0]), r = +sq[1] - 1;
  return E.orient === 'w' ? { x: f, y: 7 - r } : { x: 7 - f, y: r };
}
function squareAt(x, y) {
  const rect = $('#setup-board').getBoundingClientRect();
  const cx = Math.floor(((x - rect.left) / rect.width) * 8), cy = Math.floor(((y - rect.top) / rect.height) * 8);
  if (cx < 0 || cx > 7 || cy < 0 || cy > 7) return null;
  return E.orient === 'w' ? FILES[cx] + (8 - cy) : FILES[7 - cx] + (cy + 1);
}

function renderBoard() {
  let sq = '', pc = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const name = E.orient === 'w' ? FILES[x] + (8 - y) : FILES[7 - x] + (y + 1);
      let inner = '';
      if (x === 0) inner += `<span class="coord rank">${name[1]}</span>`;
      if (y === 7) inner += `<span class="coord file">${name[0]}</span>`;
      sq += `<div class="sq ${(x + y) % 2 ? 'dark' : 'light'}" style="left:${x * 12.5}%;top:${y * 12.5}%">${inner}</div>`;
    }
  }
  for (const [s, p] of Object.entries(E.pos)) {
    const { x, y } = coords(s);
    pc += `<img class="piece" data-sq="${s}" draggable="false" src="pieces/${p}.svg" style="left:${x * 12.5}%;top:${y * 12.5}%">`;
  }
  $('#setup-board .squares').innerHTML = sq;
  $('#setup-board .pieces').innerHTML = pc;
}

function renderSide() {
  document.querySelectorAll('.palette [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === E.tool));
  $('#setup-turn').value = E.turn;
  document.querySelectorAll('#setup-turn-seg [data-turn]').forEach((b) => { const on = b.dataset.turn === E.turn; b.setAttribute('aria-checked', String(on)); b.setAttribute('aria-pressed', String(on)); });
  for (const k of Object.keys(E.castle)) {
    const cb = $('#setup-c' + k);
    const ok = castleOk(k);
    cb.disabled = !ok;
    cb.checked = ok && E.castle[k];
  }
  const f = fen();
  if (document.activeElement !== $('#setup-fen')) $('#setup-fen').value = f;
  const err = problem();
  let okTxt = 'Position valide.';
  if (!err) { try { okTxt = `Position valide · ${E.turn === 'w' ? 'Blancs' : 'Noirs'} au trait · ${new Chess(f).moves().length} coups légaux`; } catch { /* */ } }
  $('#setup-msg').textContent = err || okTxt;
  $('#setup-msg').className = 'msg ' + (err ? 'err' : 'ok');
  $('#setup-ok').disabled = !!err;
}

function render() { renderBoard(); renderSide(); }

function setPosition(pl, turn = 'w', castling = '-') {
  E.pos = parsePlacement(pl);
  E.turn = turn;
  for (const k of Object.keys(E.castle)) E.castle[k] = castling.includes(k);
}

function startDrag(e, piece, from) {
  const img = document.createElement('img');
  img.src = `pieces/${piece}.svg`;
  img.className = 'setup-drag';
  const size = $('#setup-board').getBoundingClientRect().width / 8;
  img.style.width = img.style.height = size + 'px';
  document.body.appendChild(img);
  E.drag = { piece, from, img, size };
  moveDrag(e);
  if (from) { delete E.pos[from]; renderBoard(); }
}
function moveDrag(e) {
  const d = E.drag;
  if (!d) return;
  d.img.style.left = e.clientX - d.size / 2 + 'px';
  d.img.style.top = e.clientY - d.size / 2 + 'px';
}
function endDrag(e) {
  const d = E.drag;
  if (!d) return;
  E.drag = null;
  d.img.remove();
  const sq = squareAt(e.clientX, e.clientY);
  if (sq) E.pos[sq] = d.piece; // déposée hors de l'échiquier : la pièce est retirée
  render();
}

export function renderEditor(el) {
  E.el = el;
  const pal = (c) => ['K', 'Q', 'R', 'B', 'N', 'P'].map((t) => `<button type="button" data-tool="${c}${t}" title="${NAMES[t]} ${c === 'w' ? 'blanc' : 'noir'}"><img src="pieces/${c}${t}.svg" alt=""></button>`).join('');
  el.innerHTML = `<div class="setup">
    <div class="setup-left">
      <div class="palette">${pal('b')}<button type="button" data-tool="move" title="Déplacer les pièces (glisser)" aria-label="Main : déplacer les pièces"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.8-2.4L3 16.3a1.5 1.5 0 0 1 2.3-1.9L8 17"/></svg></button></div>
      <div id="setup-board" class="board"><div class="squares"></div><div class="pieces"></div></div>
      <div class="palette">${pal('w')}<button type="button" data-tool="erase" title="Gomme : retirer une pièce" aria-label="Gomme : retirer une pièce" class="erase"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 20h12M5 15l9-9 5 5-8 9H8zM10 10l5 5"/></svg></button></div>
      <p class="muted small">Choisissez une pièce puis cliquez sur les cases pour la poser. Glissez une pièce pour la déplacer, ou hors de l'échiquier pour la retirer (clic droit : retirer).</p>
    </div>
    <aside class="card setup-side">
      <h1>Définir la position</h1>
      <div class="setup-sec"><span class="lbl-up" id="lbl-turn">Trait</span>
        <div class="segctl" id="setup-turn-seg" role="radiogroup" aria-labelledby="lbl-turn">
          <button type="button" role="radio" class="chip" data-turn="w"><img src="pieces/wK.svg" alt="" width="20" height="20"> Blancs</button>
          <button type="button" role="radio" class="chip" data-turn="b"><img src="pieces/bK.svg" alt="" width="20" height="20"> Noirs</button></div>
        <select id="setup-turn" class="sr-only" aria-label="Trait aux" tabindex="-1"><option value="w">Blancs</option><option value="b">Noirs</option></select></div>
      <fieldset class="castles"><legend class="lbl-up">Roques possibles</legend>
        <label><input type="checkbox" id="setup-cK"> Blancs O-O</label><label><input type="checkbox" id="setup-cQ"> Blancs O-O-O</label>
        <label><input type="checkbox" id="setup-ck"> Noirs O-O</label><label><input type="checkbox" id="setup-cq"> Noirs O-O-O</label>
      </fieldset>
      <div class="row">
        <button type="button" id="setup-start" class="btn">Position de départ</button>
        <button type="button" id="setup-clear" class="btn">Vider l'échiquier</button>
        <button type="button" id="setup-flip" class="btn">⇅ Retourner</button>
      </div>
      <label class="fenl lbl-up">FEN<input id="setup-fen" spellcheck="false" autocomplete="off"></label>
      <p id="setup-msg" class="small"></p>
      <button type="button" id="setup-ok" class="btn big primary">Valider et analyser</button>
      <p><a href="#/free">← Retour</a></p>
    </aside>
  </div>`;
  const boardEl = $('#setup-board');
  boardEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const sq = squareAt(e.clientX, e.clientY);
    if (sq && E.pos[sq]) { delete E.pos[sq]; render(); }
  });
  boardEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const sq = squareAt(e.clientX, e.clientY);
    if (!sq) return;
    e.preventDefault();
    if (E.tool === 'erase') { delete E.pos[sq]; render(); return; }
    if (E.tool === 'move' || (E.pos[sq] && E.pos[sq] === E.tool)) {
      if (E.pos[sq]) startDrag(e, E.pos[sq], sq);
      return;
    }
    E.pos[sq] = E.tool;
    render();
  });
  el.querySelectorAll('.palette [data-tool]').forEach((b) => {
    b.onpointerdown = (e) => {
      E.tool = b.dataset.tool;
      renderSide();
      if (/^[wb][KQRBNP]$/.test(E.tool)) { e.preventDefault(); startDrag(e, E.tool, null); }
    };
  });
  $('#setup-turn').onchange = (e) => { E.turn = e.target.value; render(); };
  document.querySelectorAll('#setup-turn-seg [data-turn]').forEach((b) => { b.onclick = () => { E.turn = b.dataset.turn; render(); }; });
  for (const k of Object.keys(E.castle)) $('#setup-c' + k).onchange = (e) => { E.castle[k] = e.target.checked; render(); };
  $('#setup-start').onclick = () => { setPosition(START, 'w', 'KQkq'); render(); };
  $('#setup-clear').onclick = () => { E.pos = {}; render(); };
  $('#setup-flip').onclick = () => { E.orient = E.orient === 'w' ? 'b' : 'w'; renderBoard(); };
  $('#setup-fen').onchange = (e) => {
    const parts = e.target.value.trim().split(/\s+/);
    try {
      setPosition(parts[0], parts[1] === 'b' ? 'b' : 'w', parts[2] || '-');
      render();
    } catch (err) {
      $('#setup-msg').textContent = 'FEN illisible : ' + err.message;
      $('#setup-msg').className = 'msg err';
    }
  };
  $('#setup-ok').onclick = () => {
    if (problem()) return;
    stashFree({ fen: fen(), orient: E.orient });
    location.hash = '#/free/new';
  };
  render();
}

window.addEventListener('pointermove', moveDrag);
window.addEventListener('pointerup', endDrag);
