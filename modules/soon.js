import { miniBoard } from './setup.js';

// Modules pas encore livrés : page de présentation avec une action utile en attendant.
const TEXT = {
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

export function soon(el, key) {
  const t = TEXT[key], m = MOBILE[key];
  el.innerHTML = `<div class="soon2">
    <section class="soon-hero">
      <div class="soon-hero-text">
      <span class="soon-badge">Bientôt</span>
      <h1>${t.title}</h1>
      <p class="soon-lead">${t.lead}</p>
      <div class="soon-cta"><a class="btn primary" href="${t.action[1]}">${t.action[0]}</a></div>
      </div>
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
  const tt = document.getElementById('topbar-soon'); if (tt) tt.textContent = t.title;
}
