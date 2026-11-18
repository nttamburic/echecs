import { miniBoard } from './setup.js';
import { Chess } from '../vendor/chess.js';
import * as store from '../core/store.js';
import { classifyGame } from '../analysis.js';
import { BOOK, getUser } from './analyse.js';

// Modules pas encore livrés : page de présentation avec une action utile en attendant.
const TEXT = {
  puzzles: {
    title: 'Puzzles',
    icon: '<path d="M10 4h4v3a2 2 0 1 0 0 4v3h-4v-3a2 2 0 1 1 0-4z"/>',
    items: [
      'Puzzles de la base Lichess classés par thème, avec votre classement.',
      'Puzzles tirés de vos propres erreurs.',
    ],
    lead: 'Entraînez votre tactique sur des positions choisies pour vous — à commencer par celles que vous avez ratées en partie.',
    feats: [
      ['Par thème', 'Fourchettes, clouages, attaques à la découverte, mats en 2… choisissez le motif à travailler.', 'M4 6h16M4 12h10M4 18h6'],
      ['Classement puzzle', 'Un Elo dédié qui monte et descend selon vos réussites, avec l’historique de progression.', 'M4 19h16M7 15V9M12 15V5M17 15v-4'],
      ['Tirés de vos erreurs', 'Chaque gaffe ou occasion manquée détectée par Stockfish devient un puzzle, revu en répétition espacée.', 'M3.5 12a8.5 8.5 0 1 0 2.5-6M3 4v4h4M12 8v4l3 2'],
    ],
    action: ['Revoir mes erreurs en attendant', '#/games'],
  },
  strategy: {
    title: 'Étude stratégique',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    items: [
      '« Trouve le plan » : comprendre les idées du milieu de jeu avec Leela Chess Zero.',
    ],
    lead: 'Comprenez les idées du milieu de jeu, position après position.',
    feats: [['Trouve le plan', '« Trouve le plan » : comprendre les idées du milieu de jeu avec Leela Chess Zero.', 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM15.5 8.5l-2 5-5 2 2-5z']],
    action: ['Analyser une partie en attendant', '#/free'],
  },
  endgames: {
    title: 'Finales',
    icon: '<path d="M6 21V4h11l-2 4 2 4H6"/>',
    items: [
      'Cours des finales théoriques (opposition, Lucena, Philidor, mat Fou + Cavalier…).',
      'Entraînement contre la défense parfaite des tables de finales.',
      'Vos propres finales ratées transformées en exercices.',
    ],
    lead: 'Apprenez les finales qui font gagner des demi-points.',
    feats: [
      ['Cours théoriques', 'Opposition, Lucena, Philidor, mat Fou + Cavalier…', 'M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z'],
      ['Défense parfaite', 'Entraînement contre la défense parfaite des tables de finales.', 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM10 8.5v7l6-3.5z'],
      ['Vos finales ratées', 'Vos propres finales ratées transformées en exercices.', 'M3.5 12a8.5 8.5 0 1 0 2.5-6M3 4v4h4M12 8v4l3 2'],
    ],
    action: ['Placer une position de finale', '#/free/setup'],
  },
};

const MOBILE = {
  puzzles: { pitch: 'Votre tactique, à commencer par les positions que vous avez ratées en partie.', fen: 'r3k2r/ppp2ppp/2n5/3q4/3P4/2N5/PP3PPP/R2QK2R', arrows: 'c3d5:#81b64c', feats: [['Par thème', 'Fourchettes, clouages, mats en 2…'], ['Classement puzzle', 'Un Elo dédié et sa courbe.'], ['Tirés de vos erreurs', 'Vos gaffes devenues puzzles.']], cta: ['Revoir mes erreurs en attendant', '#/games'] },
  strategy: { pitch: '« Trouve le plan » : proposez une idée, Leela Chess Zero compare et explique.', fen: 'r2q1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R', arrows: 'c4c5:#81b64c,a2a4:#8fc3ff', feats: [['Positions calmes', 'Tirées de vos parties.'], ['Votre plan', 'Flèches ou phrase libre.'], ['Comparaison', 'Les plans de Leela, commentés.']], cta: ['Analyser une position', '#/free'] },
  endgames: { pitch: 'Les finales à connaître, puis l’entraînement contre les tables de finales.', fen: '8/8/8/4k3/8/3K4/4P3/8', arrows: 'd3e3:#81b64c', feats: [['Cours théoriques', 'Opposition, Lucena, Philidor…'], ['Contre les tables', 'Jusqu’à 7 pièces.'], ['Vos finales ratées', 'À rejouer depuis vos parties.']], cta: ['Jouer contre Maia', '#/play'] },
};

// Flèches « e2e4:#couleur » superposées au mini-échiquier (240 px, sans coordonnées).
function arrowsSvg(spec, size) {
  const u = size / 8, c = (sq) => [(sq.charCodeAt(0) - 97 + .5) * u, (7 - (+sq[1] - 1) + .5) * u];
  return `<svg class="soon-arrows" viewBox="0 0 ${size} ${size}" aria-hidden="true">${spec.split(',').filter(Boolean).map((a) => {
    const [mv, col] = a.split(':'), [x1, y1] = c(mv.slice(0, 2)), [x2, y2] = c(mv.slice(2, 4));
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, hl = u * .42, hw = u * .26;
    const bx = x2 - ux * hl, by = y2 - uy * hl;
    return `<g fill="${col}" stroke="${col}" opacity=".85"><line x1="${x1}" y1="${y1}" x2="${bx}" y2="${by}" stroke-width="${u * .2}" stroke-linecap="round"/><polygon points="${x2},${y2} ${bx - uy * hw},${by + ux * hw} ${bx + uy * hw},${by - ux * hw}" stroke="none"/></g>`;
  }).join('')}</svg>`;
}

// Échiquier 360 px du bureau (maquette) : dernier coup surligné, flèche verte et pastille « !! ».
function deskBoard() {
  const size = 360, u = size / 8, sq = (n) => [(n.charCodeAt(0) - 97) * u, (7 - (+n[1] - 1)) * u];
  const hl = ['d8', 'd5'].map((n) => { const [x, y] = sq(n); return `<rect x="${x}" y="${y}" width="${u}" height="${u}" fill="#f6f669" opacity=".4"/>`; }).join('');
  const [bx, by] = sq('d5'), cx = bx + u - 4, cy = by + 4;
  const badge = `<g><circle cx="${cx}" cy="${cy}" r="11" fill="#1baaa6" stroke="#fff" stroke-width="1.5"/><text x="${cx}" y="${cy + 4.5}" text-anchor="middle" font-size="13" font-weight="800" fill="#fff">!!</text></g>`;
  return `<div class="soon-d-board">${miniBoard('r3k2r/ppp2ppp/2n5/3q4/3P4/2N5/PP3PPP/R2QK2R', size)}<svg class="soon-arrows" viewBox="0 0 ${size} ${size}" aria-hidden="true">${hl}</svg>${arrowsSvg('c3d5:#81b64c', size)}<svg class="soon-arrows" viewBox="0 0 ${size} ${size}" aria-hidden="true">${badge}</svg></div>`;
}

// Positions tactiques déjà repérées : gaffes, erreurs et occasions manquées de l'utilisateur dans ses parties analysées.
async function countTactics() {
  const user = (getUser() || '').toLowerCase();
  if (!user) return null;
  let n = 0;
  for (const r of await store.all('analysis')) {
    const a = r.data;
    if (!a || !a.game || !a.positions || !a.game.pgn) continue;
    const color = (a.game.white && a.game.white.name || '').toLowerCase() === user ? 'w' : (a.game.black && a.game.black.name || '').toLowerCase() === user ? 'b' : null;
    if (!color) continue;
    try {
      const c = new Chess();
      c.loadPgn(a.game.pgn);
      const mv = c.history({ verbose: true });
      const res = classifyGame(mv, a.positions.slice(0, mv.length), { w: a.game.white.rating, b: a.game.black.rating }, BOOK);
      res.forEach((x, i) => { if (x && mv[i].color === color && ['blunder', 'mistake', 'miss'].includes(x.cls)) n++; });
    } catch { /* partie illisible : ignorée */ }
  }
  return n;
}

export function soon(el, key) {
  const t = TEXT[key], m = MOBILE[key];
  const desk = key === 'puzzles';
  el.innerHTML = `<div class="soon2">
    <section class="soon-hero${desk ? ' with-board' : ''}">
      <div class="soon-hero-text">
      <span class="soon-badge">Bientôt</span>
      <h1>${t.title}</h1>
      <p class="soon-lead">${t.lead}</p>
      ${desk ? '<div class="soon-count" id="soon-count" hidden></div>' : ''}
      <div class="soon-cta"><a class="btn primary" href="${t.action[1]}">${t.action[0]}</a></div>
      </div>
      ${desk ? deskBoard() : ''}
    </section>
    <section class="soon-feats" aria-label="Au programme">${t.feats.map(([h, p, d]) => `<article>
      <span class="soon-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${d}"/></svg></span>
      <h2>${h}</h2><p class="muted">${p}</p></article>`).join('')}</section>
  </div>
  <div class="soon-m">
    <h1 class="sr-only">${t.title}</h1>
    <div class="soon-m-body">
      <span class="soon-badge">Bientôt</span>
      <h2>${t.title}</h2>
      <p class="soon-lead">${m.pitch}</p>
      <div class="soon-m-board">${miniBoard(m.fen.split(' ')[0], 240)}${arrowsSvg(m.arrows, 240)}</div>
      <ul class="soon-m-feats">${m.feats.map(([h, d], i) => `<li><span class="n" aria-hidden="true">${i + 1}</span><span><strong>${h}</strong><span class="muted">${d}</span></span></li>`).join('')}</ul>
    </div>
    <footer class="soon-m-foot"><a class="btn" href="${m.cta[1]}">${m.cta[0]}</a></footer>
  </div>`;
  if (desk) countTactics().then((n) => {
    const box = el.querySelector('#soon-count');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = n === null
      ? '<span class="soon-count-txt">Indiquez votre pseudo chess.com (Paramètres → Profil) : vos erreurs deviendront vos premiers puzzles.</span>'
      : n > 0
        ? `<span class="soon-count-n">${n}</span><span class="soon-count-txt">position${n > 1 ? 's' : ''} tactique${n > 1 ? 's' : ''} déjà repérée${n > 1 ? 's' : ''} dans vos parties analysées. Elles seront vos premiers puzzles.</span>`
        : '<span class="soon-count-txt">Analysez vos parties (Historique) : vos gaffes et occasions manquées deviendront vos premiers puzzles.</span>';
  }).catch(() => {});
  const tt = document.getElementById('topbar-soon'); if (tt) tt.textContent = t.title;
}
