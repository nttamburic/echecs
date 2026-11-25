// Catalogue des cours de finales. Chaque position (7 pièces au maximum) et chaque coup des lignes
// montrées sont contrôlés avec la table de finales (tests/finales-cours.test.js).
// objectif : 1 = « Gagnez », 0 = « Annulez » ; limite : coups à tenir pour réussir une nulle.
// fleches : [départ, arrivée, 'best' | 'alt' | 'threat'] ; cases : cases mises en évidence.

export const NIVEAUX = Object.freeze({ 1: 'Les bases', 2: 'L’essentiel des tours', 3: 'À connaître ensuite', 4: 'Avancé' });
export const FAMILLES = Object.freeze({ mats: 'Mats', pions: 'Pions', tours: 'Tours', mineures: 'Pièces mineures', dame: 'Dame' });

const L = (id, niveau, famille, titre, fen, camp, objectif, lecon) =>
  Object.freeze({ id, niveau, famille, titre, fen: `${fen} - - 0 1`, camp, objectif, limite: 15, fleches: [], cases: [], ...lecon });

export const LECONS = Object.freeze([
  // ---------------------------------------------------------------- niveau 1
  L('mat-dame', 1, 'mats', 'Mat avec la Dame', '8/8/8/4k3/8/8/8/3QK3 w', 'w', 1, {
    idee: [
      'La Dame seule ne peut pas mater : votre Roi doit venir l’aider.',
      'Réduisez peu à peu l’espace du Roi adverse jusqu’à le pousser au bord, puis approchez votre Roi.',
      'Attention au pat : quand le Roi adverse est au bord, laissez-lui toujours une case tant que vous ne matez pas.',
    ],
    ligne: 'Qd7 Ke4 Ke2 Kf4 Qd5 Kg4 Ke3 Kg3 Qg5+ Kh2 Kf2 Kh1 Qg1#',
  }),
  L('mat-tour', 1, 'mats', 'Mat avec la Tour', '8/8/8/4k3/8/8/8/R3K3 w', 'w', 1, {
    idee: [
      'La Tour coupe le Roi adverse : il ne peut plus franchir la rangée ou la colonne qu’elle contrôle.',
      'Votre Roi s’approche pour reprendre une case après l’autre, et la Tour resserre l’espace.',
      'Le mat se donne au bord de l’échiquier, souvent quand les deux Rois se font face. Quand il le faut, un coup d’attente de la Tour oblige le Roi adverse à reculer.',
    ],
    ligne: 'Ra5+ Ke4 Kd1 Ke3 Ra4 Kd3 Rh4 Ke3 Ke1 Kd3 Kf2 Kc2 Rh3 Kb1 Ke1 Kc2 Re3 Kb1 Kd1 Kb2 Kd2 Ka1 Rb3 Ka2 Kc2 Ka1 Ra3#',
  }),
  L('carre', 1, 'pions', 'La règle du carré', '8/8/8/P3k3/8/8/8/7K w', 'w', 1, {
    idee: [
      'Imaginez un carré dont un côté va du pion à sa case de promotion. Ici, il va de a5 à d8.',
      'Si le Roi adverse ne peut pas entrer dans ce carré, le pion passe sans l’aide de votre Roi.',
      'Le carré rétrécit à chaque avance du pion. Ici, il faut pousser tout de suite.',
    ],
    fleches: [['a5', 'a8', 'best']],
    cases: ['a5', 'd5', 'a8', 'd8'],
    ligne: 'a6 Kd6 a7 Kc7 a8=Q',
  }),
  L('carre-defense', 1, 'pions', 'La règle du carré en défense', '8/8/8/P7/4k3/8/8/7K b', 'b', 0, {
    idee: [
      'C’est à vous de jouer avec les Noirs. Votre Roi est juste à côté du carré a5-d8.',
      'S’il peut y entrer à son tour de jouer, il rattrape le pion. Un seul coup le permet ici.',
    ],
    fleches: [['e4', 'd5', 'best']],
    cases: ['a5', 'd5', 'a8', 'd8'],
    ligne: 'Kd5 a6 Kc6 a7 Kb7 a8=Q+ Kxa8',
  }),
  L('opposition', 1, 'pions', 'L’opposition', '8/8/4k3/8/4K3/8/4P3/8 b', 'w', 1, {
    idee: [
      'Les Rois sont sur la même colonne, séparés d’une case. Celui qui doit jouer est obligé de céder le passage : l’autre « a l’opposition ».',
      'Ici, les Noirs doivent jouer : vous avez l’opposition.',
      'Avancez d’abord votre Roi, du côté que le Roi adverse abandonne. Gardez des coups de pion en réserve pour reprendre l’opposition.',
    ],
    cases: ['e4', 'e6'],
    ligne: 'Kd6 Kf5 Ke7 e3 Kd6 e4 Ke7 Ke5 Kd7 Kf6',
  }),
  L('opposition-defense', 1, 'pions', 'L’opposition en défense', '8/4k3/8/4K3/4P3/8/8/8 w', 'b', 0, {
    idee: [
      'Le Roi blanc est devant son pion, mais les Blancs doivent jouer : vous pouvez leur répondre en reprenant l’opposition.',
      'Quand le pion avance, reculez droit devant lui. Ensuite, placez votre Roi face au Roi blanc dès qu’il avance.',
      'La partie finit souvent par un pat.',
    ],
    limite: 12,
    ligne: 'Kd5 Kd7 e5 Ke7 e6 Ke8 Kd6 Kd8 e7+ Ke8 Ke6',
  }),
  L('cases-cles', 1, 'pions', 'Les cases clés', '6k1/8/8/8/8/8/3P4/3K4 w', 'w', 1, {
    idee: [
      'Pour un pion en d2, les cases clés sont c4, d4 et e4.',
      'Si votre Roi atteint l’une d’elles, vous gagnez, quel que soit le camp au trait.',
      'Le Roi passe donc devant : ne vous pressez pas de pousser le pion.',
    ],
    fleches: [['d1', 'c2', 'best'], ['c2', 'c3', 'best']],
    cases: ['c4', 'd4', 'e4'],
    ligne: 'Kc2 Kf7 Kc3 Ke6 Kd4 Kd6 d3 Kc6 Ke5 Kd7 Kd5',
  }),
  L('pion-tour', 1, 'pions', 'Le pion de la tour', '5k2/8/8/7K/7P/8/8/8 b', 'b', 0, {
    idee: [
      'Un pion de la colonne a ou h est le plus facile à arrêter : il n’y a qu’un côté pour le contourner.',
      'Amenez votre Roi dans le coin de promotion, ici h8, et restez-y.',
      'Les Blancs ne peuvent pas vous en chasser : ils finissent par vous mettre pat.',
    ],
    fleches: [['f8', 'g7', 'best'], ['g7', 'h8', 'best']],
    cases: ['h8'],
    ligne: 'Kg7 Kg5 Kh7 h5 Kg7 h6+ Kh7 Kh5 Kh8 Kg6 Kg8 h7+ Kh8 Kh6',
  }),

  // ---------------------------------------------------------------- niveau 2
  L('lucena', 2, 'tours', 'Lucena : construire le pont', '1K6/1P1k4/8/8/8/8/r7/2R5 w', 'w', 1, {
    idee: [
      'Votre pion est en 7e rangée et votre Roi est devant lui. Il doit sortir, mais la Tour noire le harcèle d’échecs.',
      'Éloignez d’abord le Roi noir d’une colonne, puis placez votre Tour en 4e rangée.',
      'Sortez ensuite votre Roi. Au bon moment, votre Tour s’interpose : c’est le « pont ».',
    ],
    fleches: [['c1', 'd1', 'best'], ['d1', 'd4', 'alt']],
    cases: ['d4'],
    ligne: 'Rd1+ Ke7 Rd4 Ra1 Kc7 Rc1+ Kb6 Rb1+ Kc6 Rc1+ Kb5 Rb1+ Rb4',
  }),
  L('lucena-noirs', 2, 'tours', 'Lucena avec les Noirs', '2r5/R7/8/8/8/8/1p1K4/1k6 b', 'b', 1, {
    idee: [
      'La même méthode, vue de l’autre côté de l’échiquier.',
      'Chassez le Roi blanc d’une colonne par un échec, puis placez votre Tour sur la 5e rangée, la 4e de votre point de vue.',
      'Sortez votre Roi et bloquez le dernier échec avec la Tour.',
    ],
    fleches: [['c8', 'd8', 'best'], ['d8', 'd5', 'alt']],
    cases: ['d5'],
    ligne: 'Rd8+ Ke2 Rd5 Ra8 Kc2 Rc8+ Kb3 Rb8+ Kc3 Rc8+ Kb4 Rb8+ Rb5',
  }),
  L('philidor', 2, 'tours', 'La défense de Philidor', '4k3/7R/r7/3KP3/8/8/8/8 b', 'b', 0, {
    idee: [
      'Votre Roi est devant le pion. Gardez d’abord votre Tour sur la 6e rangée : le Roi blanc ne peut pas la franchir.',
      'Dès que le pion avance en e6, le Roi blanc perd son abri.',
      'Envoyez alors la Tour sur la 1re rangée et donnez des échecs par derrière.',
    ],
    limite: 20,
    fleches: [['a6', 'b6', 'best'], ['b6', 'b1', 'alt']],
    cases: ['a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6'],
    ligne: 'Rb6 e6 Rb1 Kd6 Rd1+ Ke5 Re1+ Kf6 Rf1+',
  }),
  L('tour-derriere', 2, 'tours', 'La Tour derrière le pion passé', 'r7/6k1/P7/8/8/8/6PK/R7 w', 'w', 1, {
    idee: [
      'Placez votre Tour derrière votre pion passé : chaque avance du pion lui laisse plus de place.',
      'La Tour noire, placée devant le pion, est au contraire de plus en plus enfermée.',
      'Une fois le pion avancé, le Roi noir ne peut guère s’éloigner. Profitez-en avec votre Roi et votre second pion.',
    ],
    fleches: [['a1', 'a6', 'alt'], ['a6', 'a7', 'best']],
    ligne: 'a7 Rh8+ Kg3 Ra8 Ra6 Kf7 Kf4 Ke7 g4 Kd7 g5 Rf8+ Kg4 Ra8 g6 Kc7',
  }),
  L('cote-court', 2, 'tours', 'La défense par le côté court', '8/4K1k1/4P3/8/8/8/r7/3R4 b', 'b', 0, {
    idee: [
      'Face à un pion e, les colonnes f à h forment le côté court ; les colonnes a à d, le côté long.',
      'Votre Roi se tient du côté court. Votre Tour utilise le côté long pour donner des échecs de loin.',
      'La distance est essentielle : de près, le Roi blanc peut attaquer votre Tour et se mettre à l’abri.',
    ],
    fleches: [['a2', 'a7', 'best']],
    ligne: 'Ra7+ Rd7 Ra8 Rd1 Ra7+ Kd6 Ra6+ Kc5 Rxe6',
  }),

  // ---------------------------------------------------------------- niveau 3
  L('mat-deux-fous', 3, 'mats', 'Mat avec les deux Fous', '4k3/8/8/8/8/8/8/2B1KB2 w', 'w', 1, {
    idee: [
      'Côte à côte, les deux Fous contrôlent deux diagonales voisines et forment une barrière.',
      'Avancez cette barrière avec l’aide de votre Roi pour pousser le Roi adverse dans un coin.',
      'Surveillez le pat quand le Roi adverse n’a presque plus de cases.',
    ],
    ligne: 'Bh3 Ke7 Bf4 Kf6 Kd2 Kg6 Kd3 Kf6 Kd4 Kg6 Ke5 Kf7 Bf5 Ke7 Be6 Kd8 Kf6 Ke8 Bc7 Kf8 Bd7 Kg8 Kg6 Kf8 Bd6+ Kg8 Be6+ Kh8 Be5#',
  }),
  L('mauvais-fou', 3, 'mineures', 'Mauvais Fou et pion de la tour', '6k1/8/6K1/7P/8/3B4/8/8 b', 'b', 0, {
    idee: [
      'La case de promotion h8 est noire, mais le Fou blanc ne se déplace que sur les cases blanches.',
      'Votre Roi dans le coin ne peut donc pas en être chassé par le Fou.',
      'Restez près de h8 : les Blancs ne peuvent que vous mettre pat.',
    ],
    cases: ['h8'],
    fleches: [['g8', 'h8', 'best']],
    ligne: 'Kh8 Bf5 Kg8 Be6+ Kh8 h6',
  }),
  L('bon-fou', 3, 'mineures', 'Le bon Fou avec le pion de la tour', '6k1/8/6K1/7P/8/4B3/8/8 w', 'w', 1, {
    idee: [
      'Cette fois, votre Fou contrôle la case de promotion h8.',
      'Le Roi noir peut être chassé du coin : le pion passe, ou le mat arrive avant.',
    ],
    cases: ['h8'],
    fleches: [['e3', 'd4', 'alt']],
    ligne: 'Bc5 Kh8 h6 Kg8 h7+ Kh8 Bd4#',
  }),
  L('fous-opposes', 3, 'mineures', 'Fous de couleurs opposées', '8/3k4/6b1/3PP3/4K3/8/1B6/8 w', 'b', 0, {
    idee: [
      'Votre Fou va sur les cases blanches, le Fou adverse sur les cases noires : ils ne peuvent jamais s’affronter.',
      'Même avec deux pions de moins, vous pouvez tenir en bloquant leur avance avec votre Roi et votre Fou.',
      'Gardez le contrôle des cases d’avance des pions et ne laissez pas le Roi blanc passer.',
    ],
    cases: ['d6', 'e6'],
    ligne: 'Kd4 Bf7 d6 Ba2 e6+ Kxd6 e7 Kxe7',
  }),
  L('cavalier-pion', 3, 'mineures', 'Cavalier contre pion', '7K/8/8/8/1p6/1k6/8/1N6 w', 'w', 0, {
    idee: [
      'Votre Roi est trop loin : le Cavalier doit arrêter le pion tout seul.',
      'Un échec lui fait gagner du temps pour revenir surveiller les cases devant le pion.',
      'S’il parvient à se donner contre le pion promu, la partie est nulle : un Roi seul ne peut pas mater.',
    ],
    fleches: [['b1', 'd2', 'best']],
    ligne: 'Nd2+ Ka2 Nf1 b3 Nd2 b2 Kg7 b1=Q Nxb1',
  }),
  L('dame-pion', 3, 'dame', 'Dame contre pion en 7e rangée', '6K1/8/8/8/8/8/3pk3/7Q w', 'w', 1, {
    idee: [
      'Donnez des échecs, ou clouez le pion, jusqu’à obliger le Roi adverse à se placer devant son pion.',
      'Chaque fois qu’il y est forcé, il ne menace plus de promouvoir : approchez votre Roi d’un pas.',
      'Répétez la manœuvre. Cette méthode fonctionne contre un pion central ou un pion du cavalier, mais pas toujours contre un pion du fou ou de la tour.',
    ],
    fleches: [['h1', 'e4', 'best']],
    cases: ['d1'],
    ligne: 'Qe4+ Kf1 Qd3+ Ke1 Qe3+ Kd1 Kf7 Kc2 Qe2 Kc1 Qc4+ Kb1 Qb3+ Kc1 Qc3+ Kd1 Ke6 Ke2 Qc2 Ke1 Qe4+ Kf1 Qd3+ Ke1 Qe3+ Kd1 Kd5 Kc2 Qe2 Kc1 Qc4+ Kb1 Qb3+ Kc1 Qc3+ Kd1 Ke4 Ke2 Qe3+ Kd1 Kd3 Kc1 Qxd2+ Kb1 Kc3 Ka1 Qb2#',
  }),
  L('dame-pion-fou', 3, 'dame', 'Contre la Dame : la ruse du pat', '6K1/8/8/8/8/1Q6/2p5/1k6 b', 'b', 0, {
    idee: [
      'Votre pion de la colonne c est en 2e rangée et la Dame vous fait échec.',
      'N’allez pas devant votre pion par réflexe : le coin vous offre une ressource.',
      'Si la Dame capture alors le pion, vous êtes pat.',
    ],
    limite: 10,
    fleches: [['b1', 'a1', 'best']],
    cases: ['a1'],
    ligne: 'Ka1 Qxc2',
  }),
  L('percee', 3, 'pions', 'La percée', '8/1p2k3/8/PP6/8/8/8/6K1 w', 'w', 1, {
    idee: [
      'Deux pions avancés peuvent venir à bout d’un seul sans l’aide du Roi.',
      'Un sacrifice dévie le pion adverse et ouvre la route à l’autre pion.',
      'L’ordre des coups est essentiel : un seul premier coup gagne.',
    ],
    fleches: [['a5', 'a6', 'best']],
    ligne: 'a6 bxa6 bxa6 Kd6 a7 Kc5 a8=Q',
  }),

  // ---------------------------------------------------------------- niveau 4
  L('mat-fou-cavalier', 4, 'mats', 'Mat avec le Fou et le Cavalier', '8/8/8/4k3/8/8/8/2B1K1N1 w', 'w', 1, {
    idee: [
      'Le mat ne se force que dans un coin de la couleur de votre Fou : ici a1 ou h8.',
      'Poussez d’abord le Roi adverse au bord. S’il se réfugie dans le mauvais coin, faites-le glisser le long du bord vers le bon.',
      'La règle des 50 coups laisse peu de place à l’hésitation : coordonnez les trois pièces.',
    ],
    cases: ['a1', 'h8'],
    ligne: 'Ne2 Ke4 Kd2 Kd5 Kd3 Kc5 Nc3 Kb6 Be3+ Ka6 Kc4 Kb7 Nb5 Kc6 Bg1 Kb7 Kc5 Kb8 Kb6 Ka8 Nc7+ Kb8 Kc6 Kc8 Ba7 Kd8 Nd5 Ke8 Bd4 Kf7 Nf4 Ke7 Kc7 Ke8 Bf2 Ke7 Bh4+ Ke8 Bg5 Kf7 Kd6 Ke8 Be7 Kf7 Kd7 Kg8 Ke8 Kg7 Bg5 Kg8 Ne6 Kh7 Kf7 Kh8 Bc1 Kh7 Nf8+ Kh8 Bb2#',
  }),
  L('vancura', 4, 'tours', 'La défense de Vancura', 'R7/6k1/P4r2/8/1K6/8/8/8 b', 'b', 0, {
    idee: [
      'La Tour blanche, devant son pion, ne peut pas bouger sans l’abandonner.',
      'Attaquez le pion de côté avec votre Tour, pendant que votre Roi reste en g7 ou h7.',
      'Quand le Roi blanc vient défendre le pion, donnez-lui des échecs de côté, puis revenez attaquer le pion.',
    ],
    limite: 20,
    fleches: [['f6', 'a6', 'threat'], ['f6', 'f4', 'best']],
    cases: ['g7', 'h7'],
    ligne: 'Rf4+ Kb5 Rf5+ Kb6 Rf6+',
  }),
  L('reti', 4, 'pions', 'L’étude de Réti', '7K/8/k1P5/7p/8/8/8/8 w', 'w', 0, {
    idee: [
      'Tout semble perdu : le pion noir paraît inarrêtable et votre pion paraît pris.',
      'En avançant en diagonale, votre Roi poursuit deux buts à la fois : rattraper le pion noir et soutenir le vôtre.',
      'Sur l’échiquier, un trajet en diagonale n’est pas plus long qu’un trajet en ligne droite.',
    ],
    fleches: [['h8', 'g7', 'best'], ['g7', 'f6', 'best'], ['f6', 'e5', 'best']],
    ligne: 'Kg7 h4 Kf6 Kb6 Ke5 h3 Kd6 h2 c7 h1=Q c8=Q',
  }),
  L('dame-tour', 4, 'dame', 'Dame contre Tour', '1k6/1r6/2K5/Q7/8/8/8/8 w', 'w', 1, {
    idee: [
      'La défense reste solide tant que la Tour reste près de son Roi.',
      'Avec des échecs et des coups tranquilles, la Dame cherche à obliger la Tour à s’éloigner.',
      'Une fois la Tour isolée, une fourchette la gagne. Il reste alors à mater avec la Dame.',
    ],
    ligne: 'Qd5 Ka8 Qa2+ Kb8 Qa5 Rb1 Qe5+ Ka7 Qd4+ Ka8 Qh8+ Ka7 Qh7+ Kb8 Qxb1+ Kc8 Qb4 Kd8 Qf8#',
  }),
]);

export const leconParId = (id) => LECONS.find((l) => l.id === id) ?? null;
// Ordre de présentation : par niveau, dans l'ordre du catalogue.
export const leconSuivante = (id) => {
  const i = LECONS.findIndex((l) => l.id === id);
  return i < 0 ? null : LECONS[i + 1] ?? null;
};
