// Modules pas encore livrés : page de présentation avec une action utile en attendant.
const TEXT = {
  puzzles: {
    title: 'Puzzles',
    icon: '<path d="M10 4h4v3a2 2 0 1 0 0 4v3h-4v-3a2 2 0 1 1 0-4z"/>',
    items: [
      'Puzzles de la base Lichess classés par thème, avec votre classement.',
      'Puzzles tirés de vos propres erreurs.',
    ],
    action: ['Revoir mes erreurs en attendant', '#/games'],
  },
  strategy: {
    title: 'Étude stratégique',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    items: [
      '« Trouve le plan » : comprendre les idées du milieu de jeu avec Leela Chess Zero.',
    ],
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
    action: ['Placer une position de finale', '#/free/setup'],
  },
};

export function soon(el, key) {
  const t = TEXT[key];
  el.innerHTML = `<section class="card soon">
    <span class="soon-ico" aria-hidden="true"><svg viewBox="0 0 24 24">${t.icon}</svg></span>
    <h1>${t.title} <span class="soon-badge">Bientôt</span></h1>
    <p class="muted">Ce module arrive bientôt. Au programme :</p>
    <ul>${t.items.map((i) => `<li>${i}</li>`).join('')}</ul>
    <a class="btn primary" href="${t.action[1]}">${t.action[0]}</a>
  </section>`;
}
