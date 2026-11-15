// Échiquier : affichage, déplacement à la souris (clic ou glisser), promotion, flèches.
import { Chess } from './vendor/chess.js';

const FILES = 'abcdefgh';

export class Board {
  constructor(el, { onMove } = {}) {
    this.el = el;
    this.onMove = onMove;
    this.orientation = 'w';
    this.fen = new Chess().fen();
    this.lastMove = null;
    this.arrows = [];
    this.selected = null;
    this.interactive = true;
    el.classList.add('board');
    el.innerHTML = '<div class="squares"></div><div class="pieces"></div><svg class="arrows" viewBox="0 0 8 8"></svg><div class="promo hidden"></div>';
    this.sqLayer = el.querySelector('.squares');
    this.pcLayer = el.querySelector('.pieces');
    this.svg = el.querySelector('.arrows');
    this.promoEl = el.querySelector('.promo');
    el.addEventListener('pointerdown', (e) => this.pointerDown(e));
    window.addEventListener('pointermove', (e) => this.pointerMove(e));
    window.addEventListener('pointerup', (e) => this.pointerUp(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.render();
  }

  setPosition(fen, { lastMove = null, arrows = [] } = {}) {
    this.fen = fen;
    this.lastMove = lastMove;
    this.arrows = arrows;
    this.selected = null;
    this.render();
  }
  setArrows(arrows) { this.arrows = arrows; this.renderArrows(); }
  setOrientation(c) { this.orientation = c; this.render(); }
  flip() { this.setOrientation(this.orientation === 'w' ? 'b' : 'w'); }

  coords(sq) {
    const f = FILES.indexOf(sq[0]);
    const r = +sq[1] - 1;
    return this.orientation === 'w' ? { x: f, y: 7 - r } : { x: 7 - f, y: r };
  }
  squareAt(clientX, clientY) {
    const rect = this.el.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * 8);
    const y = Math.floor(((clientY - rect.top) / rect.height) * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    return this.orientation === 'w' ? FILES[x] + (8 - y) : FILES[7 - x] + (y + 1);
  }

  render() {
    const chess = new Chess(this.fen);
    const check = chess.inCheck() ? chess.findPiece({ type: 'k', color: chess.turn() })[0] : null;
    let sq = '';
    const legalTargets = new Set();
    if (this.selected) {
      for (const m of chess.moves({ square: this.selected, verbose: true })) legalTargets.add(m.to + (m.captured ? 'x' : ''));
    }
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const name = this.orientation === 'w' ? FILES[x] + (8 - y) : FILES[7 - x] + (y + 1);
        const dark = (x + y) % 2 === 1;
        const cls = ['sq', dark ? 'dark' : 'light'];
        if (this.lastMove && (this.lastMove[0] === name || this.lastMove[1] === name)) cls.push('last');
        if (this.selected === name) cls.push('sel');
        if (check === name) cls.push('check');
        let inner = '';
        if (legalTargets.has(name)) inner += '<span class="dot"></span>';
        if (legalTargets.has(name + 'x')) inner += '<span class="ring"></span>';
        if (x === 0) inner += `<span class="coord rank">${name[1]}</span>`;
        if (y === 7) inner += `<span class="coord file">${name[0]}</span>`;
        sq += `<div class="${cls.join(' ')}" style="left:${x * 12.5}%;top:${y * 12.5}%">${inner}</div>`;
      }
    }
    this.sqLayer.innerHTML = sq;
    let pc = '';
    for (const row of chess.board()) {
      for (const p of row) {
        if (!p) continue;
        const { x, y } = this.coords(p.square);
        pc += `<img class="piece" data-sq="${p.square}" draggable="false" src="pieces/${p.color}${p.type.toUpperCase()}.svg" style="left:${x * 12.5}%;top:${y * 12.5}%">`;
      }
    }
    this.pcLayer.innerHTML = pc;
    this.renderArrows();
  }

  renderArrows() {
    let s = '<defs>';
    const colors = [...new Set(this.arrows.map((a) => a.color))];
    colors.forEach((c, i) => { s += `<marker id="ah${i}" markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="${c}"/></marker>`; });
    s += '</defs>';
    for (const a of this.arrows) {
      const f = this.coords(a.from);
      const t = this.coords(a.to);
      const x1 = f.x + 0.5, y1 = f.y + 0.5, x2 = t.x + 0.5, y2 = t.y + 0.5;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const k = (len - 0.45) / len;
      const i = colors.indexOf(a.color);
      s += `<line x1="${x1}" y1="${y1}" x2="${x1 + (x2 - x1) * k}" y2="${y1 + (y2 - y1) * k}" stroke="${a.color}" stroke-width="0.17" stroke-linecap="round" opacity="${a.opacity || 0.85}" marker-end="url(#ah${i})"/>`;
    }
    this.svg.innerHTML = s;
  }

  canMoveFrom(sq) {
    if (!this.interactive) return false;
    const chess = new Chess(this.fen);
    const p = chess.get(sq);
    return p && p.color === chess.turn() && !chess.isGameOver();
  }

  pointerDown(e) {
    if (e.button !== 0 || !this.promoEl.classList.contains('hidden')) return;
    const sq = this.squareAt(e.clientX, e.clientY);
    if (!sq) return;
    if (this.selected && sq !== this.selected && this.tryMove(this.selected, sq)) return;
    if (this.canMoveFrom(sq)) {
      this.selected = sq;
      this.render();
      const img = this.pcLayer.querySelector(`[data-sq="${sq}"]`);
      if (img) {
        this.drag = { from: sq, img, startX: e.clientX, startY: e.clientY, moved: false };
        img.classList.add('dragging');
      }
      e.preventDefault();
    } else if (this.selected) {
      this.selected = null;
      this.render();
    }
  }
  pointerMove(e) {
    if (!this.drag) return;
    const d = this.drag;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    d.img.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  pointerUp(e) {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    d.img.style.transform = '';
    d.img.classList.remove('dragging');
    const sq = this.squareAt(e.clientX, e.clientY);
    if (d.moved && sq && sq !== d.from) {
      if (!this.tryMove(d.from, sq)) { this.selected = null; this.render(); }
    }
  }

  tryMove(from, to) {
    const chess = new Chess(this.fen);
    const moves = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!moves.length) return false;
    if (moves.some((m) => m.promotion)) {
      this.askPromotion(chess.turn(), to, (promo) => this.onMove && this.onMove(from, to, promo));
      return true;
    }
    this.selected = null;
    if (this.onMove) this.onMove(from, to, undefined);
    return true;
  }

  askPromotion(color, to, cb) {
    const { x } = this.coords(to);
    this.promoEl.innerHTML = ['q', 'r', 'b', 'n'].map((p) => `<img data-p="${p}" src="pieces/${color}${p.toUpperCase()}.svg">`).join('');
    this.promoEl.style.left = x * 12.5 + '%';
    this.promoEl.classList.remove('hidden');
    const handler = (e) => {
      e.stopPropagation();
      const p = e.target.dataset && e.target.dataset.p;
      this.promoEl.classList.add('hidden');
      this.promoEl.removeEventListener('pointerdown', handler);
      this.selected = null;
      if (p) cb(p); else this.render();
    };
    this.promoEl.addEventListener('pointerdown', handler);
  }
}
