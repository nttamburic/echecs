// Modules pas encore livrés : simple page de présentation.
const TEXT = {
  play: {
    title: 'Jouer',
    items: [
      'Parties contre des bots « humains » comme Maia, qui jouent comme un joueur de votre niveau.',
      'Chaque partie jouée pourra ensuite être analysée.',
    ],
  },
  openings: {
    title: 'Ouvertures',
    items: [
      'Bilan de toutes vos parties : les erreurs que vous répétez dans l\'ouverture, et les réponses adverses qui vous posent problème.',
      'Votre répertoire (Blancs et Noirs) : construit avec l\'aide de l\'appli, tiré de vos parties ou importé d\'un PGN.',
      'Entraînement par répétition espacée.',
    ],
  },
  puzzles: {
    title: 'Puzzles',
    items: [
      'Puzzles de la base Lichess classés par thème, avec votre classement.',
      'Puzzles tirés de vos propres erreurs.',
    ],
  },
  strategy: {
    title: 'Étude stratégique',
    items: [
      '« Trouve le plan » : comprendre les idées du milieu de jeu avec Leela Chess Zero.',
    ],
  },
  endgames: {
    title: 'Finales',
    items: [
      'Cours des finales théoriques (opposition, Lucena, Philidor, mat Fou + Cavalier…).',
      'Entraînement contre la défense parfaite des tables de finales.',
      'Vos propres finales ratées transformées en exercices.',
    ],
  },
};

export function soon(el, key) {
  const t = TEXT[key];
  el.innerHTML = `<section class="card"><h1>${t.title}</h1><p class="muted">Ce module arrive bientôt. Au programme :</p><ul>${t.items.map((i) => `<li>${i}</li>`).join('')}</ul></section>`;
}
