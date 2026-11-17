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

export function soon(el, key) {
  const t = TEXT[key];
  el.innerHTML = `<div class="soon2">
    <section class="soon-hero">
      <span class="soon-badge">Bientôt</span>
      <h1>${t.title}</h1>
      <p class="soon-lead">${t.lead}</p>
      <div class="soon-cta"><a class="btn primary" href="${t.action[1]}">${t.action[0]}</a></div>
    </section>
    <section class="soon-feats" aria-label="Au programme">${t.feats.map(([h, p, d]) => `<article>
      <span class="soon-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${d}"/></svg></span>
      <h2>${h}</h2><p class="muted">${p}</p></article>`).join('')}</section>
  </div>`;
}
