// Géométrie de l'échiquier pour Manu AI : attaques, clouages, échange statique. Interne à core/manu.
// Une position est lue une fois en carte { case: { type, color } } ; aucun appel à chess.js ensuite.

export const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

const FILES = 'abcdefgh';
export const sq = (f, r) => FILES[f] + (r + 1);
const fr = (s) => [FILES.indexOf(s[0]), Number(s[1]) - 1];
const inside = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;

const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const SLIDES = { b: BISHOP, r: ROOK, q: [...ROOK, ...BISHOP] };

export function boardMap(c) {
  const map = {};
  for (const row of c.board()) for (const p of row) if (p) map[p.square] = { type: p.type, color: p.color };
  return map;
}

export function kingOf(map, color) {
  for (const s in map) if (map[s].type === 'k' && map[s].color === color) return s;
  return null;
}

// Cases attaquées géométriquement par la pièce en `s` (sans tenir compte des clouages).
export function rawAttacks(map, s) {
  const p = map[s];
  if (!p) return [];
  const [f, r] = fr(s);
  const out = [];
  if (p.type === 'p') {
    const d = p.color === 'w' ? 1 : -1;
    for (const df of [-1, 1]) if (inside(f + df, r + d)) out.push(sq(f + df, r + d));
  } else if (p.type === 'n' || p.type === 'k') {
    const steps = p.type === 'n' ? KNIGHT : [...ROOK, ...BISHOP];
    for (const [df, dr] of steps) if (inside(f + df, r + dr)) out.push(sq(f + df, r + dr));
  } else {
    for (const [df, dr] of SLIDES[p.type]) {
      for (let x = f + df, y = r + dr; inside(x, y); x += df, y += dr) {
        out.push(sq(x, y));
        if (map[sq(x, y)]) break;
      }
    }
  }
  return out;
}

// Pièces de `color` qui attaquent `target`.
export function attackersOf(map, target, color) {
  return Object.keys(map).filter((s) => map[s].color === color && rawAttacks(map, s).includes(target));
}

// Ligne du clouage absolu de la pièce en `s` (cases entre son roi et le cloueur, cloueur compris), ou null.
export function pinLine(map, s) {
  const p = map[s];
  if (!p || p.type === 'k') return null;
  const king = kingOf(map, p.color);
  if (!king) return null;
  const [kf, kr] = fr(king), [f, r] = fr(s);
  const df = Math.sign(f - kf), dr = Math.sign(r - kr);
  if (!(df === 0 || dr === 0 || Math.abs(f - kf) === Math.abs(r - kr))) return null;
  const slider = df === 0 || dr === 0 ? 'r' : 'b';
  const line = [];
  let passed = false; // `s` est-elle déjà franchie depuis le roi ?
  for (let x = kf + df, y = kr + dr; inside(x, y); x += df, y += dr) {
    const z = sq(x, y);
    line.push(z);
    if (z === s) { passed = true; continue; }
    const q = map[z];
    if (!q) continue;
    if (!passed) return null; // une autre pièce s'interpose entre le roi et `s`
    return q.color !== p.color && (q.type === slider || q.type === 'q') ? line : null;
  }
  return null;
}

// Attaques effectives : un pièce clouée n'attaque que le long de son clouage.
export function attacks(map, s) {
  const raw = rawAttacks(map, s);
  const pin = pinLine(map, s);
  return pin ? raw.filter((z) => pin.includes(z)) : raw;
}

// Échange statique de la prise src×dst, en pions, du point de vue de la pièce en src.
// Chaque camp reprend avec sa pièce la moins chère et peut s'arrêter. Clouages ignorés ; le roi ne
// reprend que si la case n'est plus défendue. Portage de Manu_AI/motifs/base.py `echange`.
export function exchange(map, src, dst) {
  const piece = map[src], victim = map[dst];
  if (!piece || !victim || victim.color === piece.color) return 0;
  const pos = { ...map };
  const gains = [VAL[victim.type]];
  let value = VAL[piece.type];
  delete pos[src];
  pos[dst] = piece;
  let side = piece.color === 'w' ? 'b' : 'w';
  for (;;) {
    const att = attackersOf(pos, dst, side).sort((a, b) => VAL[pos[a].type] - VAL[pos[b].type] || (a < b ? -1 : 1));
    if (!att.length) break;
    const z = att[0];
    const other = side === 'w' ? 'b' : 'w';
    if (pos[z].type === 'k' && attackersOf(pos, dst, other).length) break;
    gains.push(value - gains[gains.length - 1]);
    value = VAL[pos[z].type];
    pos[dst] = pos[z];
    delete pos[z];
    side = other;
  }
  for (let i = gains.length - 1; i > 0; i--) gains[i - 1] = -Math.max(-gains[i - 1], gains[i]);
  return gains[0];
}
