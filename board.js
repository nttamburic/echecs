// Échiquier : affichage, déplacement à la souris (clic ou glisser), promotion, flèches,
// et annotation du coup joué façon chess.com (cases coloriées + pastille Brillant, Gaffe…).
import { Chess } from './vendor/chess.js';

const FILES = 'abcdefgh';
const PIECE_FR = { p: 'pion', n: 'cavalier', b: 'fou', r: 'tour', q: 'dame', k: 'roi' };
const PIECE_NOM = { p: 'Pion', n: 'Cavalier', b: 'Fou', r: 'Tour', q: 'Dame', k: 'Roi' };
const PROMO_KEYS = { q: 'q', d: 'q', r: 'r', t: 'r', b: 'b', f: 'b', n: 'n', c: 'n' };
let boardUid = 0;

// Annonce pour les lecteurs d'écran (région aria-live="polite" de index.html).
export function announce(text) {
  const live = document.getElementById('sr-live');
  if (!live) return;
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 30);
}

// Préférences d'apparence (par appareil) : modèle d'échiquier et coordonnées.
export function applyBoardPrefs() {
  let theme = '', coords = '1';
  try { theme = localStorage.getItem('cj-board') || ''; coords = localStorage.getItem('cj-coords') || '1'; } catch { /* stockage indisponible */ }
  const h = document.documentElement;
  if (theme && theme !== 'tournoi') h.dataset.board = theme; else delete h.dataset.board;
  h.classList.toggle('no-coords', coords === '0');
}

export class Board {
  constructor(el, { onMove } = {}) {
    this.el = el;
    this.onMove = onMove;
    this.orientation = 'w';
    this.fen = new Chess().fen();
    this.lastMove = null;
    this.arrows = [];
    this.highlights = [];
    this.mark = null;
    this.selected = null;
    this.interactive = true;
    this.hl = new Set();
    this.kbSq = null;
    this.uid = 'bd' + (++boardUid);
    el.classList.add('board');
    el.setAttribute('role', 'grid');
    el.setAttribute('aria-label', 'Échiquier');
    el.tabIndex = 0;
    el.innerHTML = '<div class="squares" role="presentation"></div><div class="pieces" aria-hidden="true"></div><svg class="arrows" viewBox="0 0 8 8" aria-hidden="true"></svg><div class="promo hidden"></div>';
    this.sqLayer = el.querySelector('.squares');
    this.pcLayer = el.querySelector('.pieces');
    this.svg = el.querySelector('.arrows');
    this.promoEl = el.querySelector('.promo');
    el.addEventListener('pointerdown', (e) => this.pointerDown(e));
    window.addEventListener('pointermove', (e) => this.pointerMove(e));
    window.addEventListener('pointerup', (e) => this.pointerUp(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('keydown', (e) => this.keyDown(e));
    el.addEventListener('blur', () => { this.kbSq = null; this.render(); });
    this.render();
  }

  // mark : { sq, color, sym, label } — classification du dernier coup, affichée sur sa case d'arrivée.
  setPosition(fen, { lastMove = null, arrows = [], mark = null, highlights = [] } = {}) {
    this.fen = fen;
    this.lastMove = lastMove;
    this.arrows = arrows;
    this.highlights = highlights;
    this.mark = mark;
    this.selected = null;
    this.hl.clear();
    this.render();
    if (lastMove) this.announceMove(lastMove[1], mark);
  }
  announceMove(sq, mark) {
    const chess = new Chess(this.fen);
    const p = chess.get(sq);
    if (!p) return;
    let t = `${PIECE_NOM[p.type]} en ${sq}.`;
    if (mark && mark.label) t += ` ${mark.label}.`;
    if (chess.isCheckmate()) t += ' Échec et mat.'; else if (chess.inCheck()) t += ' Échec.';
    announce(t);
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
    const kbName = this.kbSq;
    const legalTargets = new Set();
    if (this.selected) {
      for (const m of chess.moves({ square: this.selected, verbose: true })) legalTargets.add(m.to + (m.captured ? 'x' : ''));
    }
    for (let y = 0; y < 8; y++) {
      sq += '<div role="row" class="rowc">';
      for (let x = 0; x < 8; x++) {
        const name = this.orientation === 'w' ? FILES[x] + (8 - y) : FILES[7 - x] + (y + 1);
        const dark = (x + y) % 2 === 1;
        const cls = ['sq', dark ? 'dark' : 'light'];
        const onLast = this.lastMove && (this.lastMove[0] === name || this.lastMove[1] === name);
        if (onLast && !this.mark) cls.push('last');
        if (this.selected === name) cls.push('sel');
        if (check === name) cls.push('check');
        if (this.hl.has(name)) cls.push('hl');
        if (kbName === name) cls.push('kb');
        const pc0 = chess.get(name);
        const label = pc0 ? `${name}, ${PIECE_FR[pc0.type]} ${pc0.color === 'w' ? 'blanc' : 'noir'}` : `${name}, vide`;
        let inner = '';
        if (onLast && this.mark) inner += `<span class="tint" style="background:${this.mark.color}"></span>`;
        if (legalTargets.has(name)) inner += '<span class="dot"></span>';
        if (legalTargets.has(name + 'x')) inner += '<span class="ring"></span>';
        if (x === 0) inner += `<span class="coord rank" aria-hidden="true" data-t="${name[1]}"></span>`;
        if (y === 7) inner += `<span class="coord file" aria-hidden="true" data-t="${name[0]}"></span>`;
        sq += `<div role="gridcell" id="${this.uid}-${name}" aria-label="${label}" aria-selected="${this.selected === name}" class="${cls.join(' ')}" style="left:${x * 12.5}%;top:${y * 12.5}%">${inner}</div>`;
      }
      sq += '</div>';
    }
    this.sqLayer.innerHTML = sq;
    if (kbName) this.el.setAttribute('aria-activedescendant', `${this.uid}-${kbName}`); else this.el.removeAttribute('aria-activedescendant');
    let pc = '';
    for (const row of chess.board()) {
      for (const p of row) {
        if (!p) continue;
        const { x, y } = this.coords(p.square);
        pc += `<img class="piece" alt="" data-sq="${p.square}" draggable="false" src="pieces/${p.color}${p.type.toUpperCase()}.svg" style="left:${x * 12.5}%;top:${y * 12.5}%">`;
      }
    }
    if (this.mark) {
      const m = this.mark;
      const { x, y } = this.coords(m.sq);
      const left = Math.min((x + 1) * 12.5 - 3.9, 94.2), top = Math.max(y * 12.5 - 1.9, 0.3);
      pc += `<span class="mark" title="${m.label}" aria-hidden="true" style="left:${left}%;top:${top}%;background:${m.color}">${m.sym}</span>`;
    }
    this.pcLayer.innerHTML = pc;
    this.renderArrows();
  }

  renderArrows() {
    let s = '<defs>';
    const colors = [...new Set(this.arrows.map((a) => a.color))];
    colors.forEach((c, i) => { s += `<marker id="${this.uid}-ah${i}" markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" style="fill:${c}"/></marker>`; });
    s += '</defs>';
    for (const { sq, color } of this.highlights) {
      const { x, y } = this.coords(sq);
      s += `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}" opacity=".29"/>`;
    }
    for (const a of this.arrows) {
      const f = this.coords(a.from);
      const t = this.coords(a.to);
      const x1 = f.x + 0.5, y1 = f.y + 0.5, x2 = t.x + 0.5, y2 = t.y + 0.5;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const k = (len - 0.45) / len;
      const i = colors.indexOf(a.color);
      s += `<line x1="${x1}" y1="${y1}" x2="${x1 + (x2 - x1) * k}" y2="${y1 + (y2 - y1) * k}" style="stroke:${a.color}" stroke-width="0.17" stroke-linecap="round" opacity="${a.opacity || 0.85}" marker-end="url(#${this.uid}-ah${i})"/>`;
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
    if (!this.promoEl.classList.contains('hidden')) return;
    if (e.button === 2) { // clic droit : surligne la case
      const s2 = this.squareAt(e.clientX, e.clientY);
      if (s2) { if (this.hl.has(s2)) this.hl.delete(s2); else this.hl.add(s2); this.render(); }
      return;
    }
    if (e.button !== 0) return;
    this.kbSq = null;
    if (this.hl.size) { this.hl.clear(); }
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
    this.promoEl.innerHTML = ['q', 'r', 'b', 'n'].map((p) => `<img data-p="${p}" alt="${PIECE_NOM[p]}" src="pieces/${color}${p.toUpperCase()}.svg">`).join('');
    this.promoEl.style.left = x * 12.5 + '%';
    this.promoEl.classList.remove('hidden');
    announce('Promotion : choisissez dame (D), tour (T), fou (F) ou cavalier (C). Échap pour annuler.');
    this.promoDone = (p) => {
      this.promoEl.classList.add('hidden');
      this.promoEl.removeEventListener('pointerdown', handler);
      this.promoDone = null;
      this.selected = null;
      if (p) cb(p); else this.render();
    };
    const handler = (e) => {
      e.stopPropagation();
      this.promoDone && this.promoDone(e.target.dataset && e.target.dataset.p);
    };
    this.promoEl.addEventListener('pointerdown', handler);
  }

  // Clavier : flèches = case active, Entrée = prendre / poser, Échap = annuler.
  keyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.promoDone) {
      if (e.key === 'Escape') { this.promoDone(null); e.preventDefault(); e.stopPropagation(); return; }
      const p = PROMO_KEYS[e.key.toLowerCase()];
      if (p) { this.promoDone(p); e.preventDefault(); }
      return;
    }
    // Après un clic souris, les flèches gardent leur rôle global (naviguer dans les coups).
    let kbMode = false;
    try { kbMode = this.el.matches(':focus-visible'); } catch { kbMode = true; }
    if (!kbMode && !this.kbSq) return;
    const d = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d) {
      e.preventDefault(); e.stopPropagation();
      const cur = this.kbSq || this.selected || (this.orientation === 'w' ? 'e2' : 'e7');
      if (!this.kbSq) { this.kbSq = cur; this.render(); return; }
      const c = this.coords(cur);
      const nx = Math.min(7, Math.max(0, c.x + d[0])), ny = Math.min(7, Math.max(0, c.y + d[1]));
      this.kbSq = this.orientation === 'w' ? FILES[nx] + (8 - ny) : FILES[7 - nx] + (ny + 1);
      this.render();
      return;
    }
    if (e.key === 'Escape') {
      if (this.selected || this.kbSq) { this.selected = null; this.render(); announce('Sélection annulée.'); e.stopPropagation(); }
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && this.kbSq) {
      e.preventDefault(); e.stopPropagation();
      const sq = this.kbSq;
      if (this.selected === sq) { this.selected = null; this.render(); announce('Pièce reposée.'); return; }
      if (this.selected && this.tryMove(this.selected, sq)) return;
      if (this.canMoveFrom(sq)) {
        this.selected = sq; this.render();
        const n = new Chess(this.fen).moves({ square: sq }).length;
        announce(`${PIECE_NOM[new Chess(this.fen).get(sq).type]} en ${sq} sélectionné. ${n} coup${n > 1 ? 's' : ''} possible${n > 1 ? 's' : ''}.`);
      } else { announce(this.selected ? 'Coup illégal.' : 'Aucune pièce jouable sur cette case.'); }
    }
  }
}
