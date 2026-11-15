// Commentaires en français des coups et des variantes.
import { Chess } from './vendor/chess.js';
import { VALUES, materialGain, fmtScore, winPct } from './analysis.js';

const FR_LETTERS = { K: 'R', Q: 'D', R: 'T', B: 'F', N: 'C' };
export const frSan = (san) => san.replace(/[KQRBN]/g, (l) => FR_LETTERS[l]);

const NAMES = { p: 'pion', n: 'cavalier', b: 'fou', r: 'tour', q: 'dame', k: 'roi' };
const FEM = { r: true, q: true };
export const pieceName = (t) => NAMES[t];
const the = (t) => (FEM[t] ? 'la ' : 'le ') + NAMES[t];
const your = (t) => 'votre ' + NAMES[t];
const undefendedWord = (t) => (FEM[t] ? 'non défendue' : 'non défendu');

function playUci(c, u) {
  try { return c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { return null; }
}

// Pièces adverses attaquées par la pièce posée en `square` (dans la position fenAfter, camp `color`).
function attackedBy(fenAfter, square, color) {
  const parts = fenAfter.split(' ');
  parts[1] = color; parts[3] = '-';
  let c;
  try { c = new Chess(parts.join(' '), { skipValidation: true }); } catch { return []; }
  let moves = [];
  try { moves = c.moves({ square, verbose: true }); } catch { return []; }
  const seen = new Set();
  return moves.filter((m) => m.captured && !seen.has(m.to) && seen.add(m.to)).map((m) => ({ square: m.to, type: m.captured }));
}

function isDefended(chess, square, ownerColor) {
  try { return chess.attackers(square, ownerColor).length > 0; } catch { return true; }
}

function listNames(types) {
  const names = types.map(the);
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' et ' + names[names.length - 1];
}

// Décrit un coup (objet verbose chess.js) joué dans `before` (instance Chess AVANT le coup) et `after`.
export function describeMove(before, m, after, prev = null) {
  const bits = [];
  const opp = m.color === 'w' ? 'b' : 'w';
  if (m.san.includes('O-O-O')) bits.push('grand roque');
  else if (m.san.includes('O-O')) bits.push('petit roque');
  if (m.captured) {
    const recapture = prev && prev.captured && prev.to === m.to;
    let txt = (recapture ? 'reprend ' : 'prend ') + the(m.captured);
    if (!recapture && m.captured !== 'p' && !m.flags.includes('e') && !isDefended(before, m.to, opp)) txt += ' ' + undefendedWord(m.captured);
    if (m.flags.includes('e')) txt += ' en passant';
    bits.push(txt);
  }
  if (m.promotion) bits.push('promotion en ' + NAMES[m.promotion]);
  if (after.isCheckmate()) { bits.push('échec et mat !'); return bits.join(', '); }
  if (after.isStalemate()) { bits.push('pat (nulle)'); return bits.join(', '); }

  // Attaques créées par la pièce jouée : fourchette / attaque.
  const targets = attackedBy(after.fen(), m.to, m.color).filter((t) => {
    if (t.type === 'k') return true;
    if (VALUES[t.type] > VALUES[m.promotion || m.piece]) return true;
    return VALUES[t.type] >= 3 && !isDefended(after, t.square, opp);
  });
  targets.sort((a, b) => (b.type === 'k') - (a.type === 'k') || VALUES[b.type] - VALUES[a.type]);
  if (targets.length >= 2) {
    bits.push('fourchette sur ' + listNames(targets.map((t) => t.type)));
  } else {
    if (after.inCheck()) bits.push('échec');
    if (targets.length === 1 && targets[0].type !== 'k') bits.push('attaque ' + the(targets[0].type));
  }
  if (targets.length >= 2 && after.inCheck() && !bits.includes('échec')) bits.unshift('échec');

  // Pièce laissée en prise après le coup ? (pas lors d'un simple échange)
  const moved = m.promotion || m.piece;
  if (moved !== 'k' && !m.san.includes('#') && VALUES[moved] >= 3) {
    let atk = [];
    try { atk = after.attackers(m.to, opp); } catch {}
    if (atk.length) {
      const cheapest = Math.min(...atk.map((s) => VALUES[after.get(s).type] || 99));
      const risk = isDefended(after, m.to, m.color) ? VALUES[moved] - cheapest : VALUES[moved];
      const won = m.captured ? VALUES[m.captured] : 0;
      if (risk - won >= 2) bits.push(the(moved) + ' reste en prise');
    }
  }
  return bits.join(', ');
}

// Commente une variante (liste de coups UCI) depuis `fen`.
export function commentLine(fen, pv, maxPlies = 6) {
  const c = new Chess(fen);
  const out = [];
  let prev = null;
  for (const u of pv.slice(0, maxPlies)) {
    const before = new Chess(c.fen());
    const moveNo = c.moveNumber();
    const m = playUci(c, u);
    if (!m) break;
    out.push({ uci: u, san: frSan(m.san), color: m.color, moveNo, note: describeMove(before, m, c, prev), fenAfter: c.fen() });
    prev = m;
  }
  return out;
}

export function lineToText(items, withNotes = true) {
  return items.map((it, i) => {
    const num = it.color === 'w' ? `${it.moveNo}. ` : i === 0 ? `${it.moveNo}... ` : '';
    return num + it.san + (withNotes && it.note ? ` (${it.note})` : '');
  }).join(' ');
}

const TITLES = {
  brilliant: 'est un coup brillant !', great: 'est un très bon coup !', best: 'est le meilleur coup',
  excellent: 'est excellent', good: 'est un bon coup', book: 'est un coup de théorie',
  inaccuracy: 'est une imprécision', mistake: 'est une erreur', miss: 'est une occasion manquée', blunder: 'est une gaffe',
};

const pct = (x) => Math.round(x) + ' %';

// Construit l'explication d'un coup classé.
// r = résultat de classifyMove ; pos = analyse de la position avant ; color = camp qui a joué.
export function explainMove({ fenBefore, san, uci, color, r, pos, openingName, playerColor }) {
  const mine = playerColor ? playerColor === color : true;
  const side = color === 'w' ? 'des Blancs' : 'des Noirs';
  const oppSide = color === 'w' ? 'Les Noirs' : 'Les Blancs';
  const out = { title: `${frSan(san)} ${TITLES[r.cls] || ''}`, paras: [], best: null, refutation: null };
  const best = pos.lines[0];
  const bestItems = commentLine(fenBefore, best.pv, 8);
  const bestSan = bestItems[0] ? bestItems[0].san : best.pv[0];
  const playedItems = pos.played ? commentLine(fenBefore, pos.played.pv, 8) : [];
  const bad = ['inaccuracy', 'mistake', 'miss', 'blunder'].includes(r.cls);

  if (r.cls === 'book') {
    out.paras.push(openingName ? `Coup connu de la théorie : ${openingName}.` : 'Coup connu de la théorie des ouvertures.');
  } else if (r.cls === 'brilliant') {
    out.paras.push('Sacrifice correct : vous donnez du matériel, mais la suite le justifie.');
  } else if (r.cls === 'great') {
    out.paras.push(`C'était le seul bon coup : le 2e meilleur coup faisait perdre environ ${pct(r.gap)} de chances de gain.`);
  } else if (r.forced) {
    out.paras.push('Coup forcé : c\'était le seul coup légal.');
  }

  if (bad) {
    out.paras.push(`${mine ? 'Vos chances de gain' : 'Les chances de gain ' + side} passent de ${pct(r.winBefore)} à ${pct(r.winAfter)} (perte de ${r.loss.toFixed(1).replace('.', ',')} %).`);
    // Pourquoi le coup est mauvais : la réponse de l'adversaire.
    const ps = pos.played && pos.played.score;
    const oppMates = ps && ps.mate !== undefined && (color === 'w' ? ps.mate < 0 : ps.mate > 0);
    if (oppMates) {
      out.paras.push(`Ce coup permet ${color === 'w' ? 'aux Noirs' : 'aux Blancs'} de mater en ${Math.abs(ps.mate)}.`);
    } else if (playedItems[1]) {
      const reply = playedItems[1];
      const afterPlayed = playedItems[0].fenAfter;
      const oppGain = materialGain(afterPlayed, pos.played.pv.slice(1), 8);
      if (playedItems[0].note.includes('reste en prise')) {
        out.paras.push(`Après ${playedItems[0].san}, ${playedItems[0].note.split(', ').find((t) => t.includes('reste en prise'))}.`);
      }
      if (reply.note) out.paras.push(`${oppSide} répondent ${reply.san} : ${reply.note}.`);
      else out.paras.push(`${oppSide} répondent ${reply.san}.`);
      if (oppGain >= 2) out.paras.push(`${oppSide} gagnent ainsi environ ${oppGain} points de matériel.`);
    }
    out.refutation = { text: lineToText(playedItems.slice(0, 6)), items: playedItems.slice(0, 6) };
  }

  if (!r.isBest && r.cls !== 'book' && best.pv[0] !== uci && (bad || r.loss >= 0.3)) {
    const bm = best.score.mate !== undefined && (color === 'w' ? best.score.mate > 0 : best.score.mate < 0);
    let sentence = bad ? `Le meilleur coup était ${bestSan} (${fmtScore(best.score)}).` : `Le moteur préférait ${bestSan} (${fmtScore(best.score)}).`;
    if (bm) sentence += ` Il menait à un mat en ${Math.abs(best.score.mate)}.`;
    else {
      const g = materialGain(fenBefore, best.pv, 8);
      if (g >= 2) sentence += ` La suite gagne environ ${g} points de matériel.`;
      else if (bad) sentence += ` Il gardait ${pct(winPct(best.score, color))} de chances de gain.`;
    }
    out.paras.push(sentence);
    out.best = { san: bestSan, uci: best.pv[0], text: lineToText(bestItems), items: bestItems };
  } else if (!bad && r.cls !== 'book') {
    if (pos.lines[1]) {
      const alt = commentLine(fenBefore, pos.lines[1].pv, 1)[0];
      const altLoss = winPct(best.score, color) - winPct(pos.lines[1].score, color);
      if (alt && alt.uci !== uci && altLoss < 6) out.paras.push(`Autre bon coup possible : ${alt.san} (${fmtScore(pos.lines[1].score)}).`);
    }
    const line = commentLine(fenBefore, pos.played.pv, 8);
    if (line.length > 1) out.best = { san: line[0].san, uci, text: lineToText(line), items: line, isPlayed: true };
  }
  return out;
}
