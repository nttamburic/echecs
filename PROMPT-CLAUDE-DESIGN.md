Tu es un·e designer produit senior. Conçois le design complet (système de design + écrans haute fidélité, version bureau et mobile) de « Chess Journey », une application web personnelle d'entraînement aux échecs, en français.

## Produit
Chess Journey est une PWA pour un joueur de club unique (pas de comptes ni de réseau social) qui veut progresser : il importe ses parties chess.com, les fait analyser par Stockfish, comprend ses erreurs avec des explications en français, travaille son répertoire d'ouvertures en répétition espacée, joue contre un bot qui imite un humain (Maia, 600 à 2 800 Elo) et analyse librement des positions. Ses données sont locales et synchronisées avec un dépôt GitHub privé. Ton : sérieux, concentré, motivant, jamais ludique à outrance. Référence d'ambiance : chess.com / Lichess en thème sombre, en plus aéré et plus cohérent.

## Direction visuelle
- Thème sombre par défaut (fond ≈ #262421, panneaux #302e2b et #3a3835, texte #e8e6e1, texte atténué #9b9893), accent vert #81b64c, liens et focus bleu clair #8fc3ff, danger #fa412d, avertissement #f7c045. Propose un thème clair optionnel.
- Échiquier : cases #ebecd0 / #779556, pièces SVG de style cburnett, coordonnées discrètes, flèches colorées, dernier coup surligné.
- Système de couleurs sémantique pour la classification des coups, à garder : Brillant #1baaa6 (!!), Très bon #5c8bb0 (!), Meilleur #81b64c (★), Excellent #96bc4b, Bon #95b776, Théorie #a88865, Imprécision #f7c631 (?!), Erreur #ffa459 (?), Occasion manquée #ff7769 (✗), Gaffe #fa412d (??). Pour la maîtrise des ouvertures : maîtrisé vert, en cours jaune, non maîtrisé rouge, jamais revu gris, non compté bleu.
- Icônes au trait de 24 px (épaisseur 1,8), police système sans serif, rayons 3/6/8 px. Notation des coups en figurines.
- Livre d'abord : tokens (couleurs, typographie, espacements, rayons, ombres, mouvements), composants (boutons primaire/secondaire/danger/icône, champs, sélecteurs, interrupteurs, onglets, cartes, tableaux, barres de progression, pastilles/badges, toasts, modales, menus contextuels, états vide/chargement/erreur), puis les écrans.

## Architecture et navigation
Barre latérale fixe (220 px) : logo cavalier + « Chess Journey » ; entrées Jouer, Analyse libre, Ouvertures, Puzzles, Étude stratégique, Finales, Historique des parties ; « Paramètres » en bas avec pastille rouge si la synchronisation échoue. Entrée active : fond plus clair, repère vert, icône verte. Sur mobile (≤ 760 px) : barre du haut avec hamburger, tiroir latéral avec voile. Deux gabarits :
1. Pages « liste » en colonne de cartes (max 1 000 px).
2. Gabarit « table de jeu » : échiquier à gauche (avec noms des joueurs, matériel capturé et barre d'évaluation verticale), panneau fonctionnel à droite, empilé sur mobile avec le panneau en feuille coulissante.

## Écrans à concevoir

1. **Historique des parties (accueil)** : titre avec pseudo chess.com ; actions Actualiser et Effacer l'historique (danger, confirmation) ; état d'import ; filtres (recherche adversaire, cadence Bullet/Blitz/Rapide/Par jour, ouverture groupée par famille, compteur) ; tableau Date / Cadence / Moi (pastille couleur + Elo) / Adversaire (Elo) / Résultat (victoire, nulle, défaite) / Précision (%, « en cours », vide) ; « Afficher plus » ; bouton « Analyse multiple » → modale (période avec nombre de parties restantes, réglages moteur, lancer) puis bandeau de progression qui se met en pause à l'ouverture d'une partie. États : aucun pseudo, aucune partie, aucun résultat, import en cours.

2. **Vue d'une partie : analyse puis bilan** : en-tête (retour, titre Analyse/Bilan, lien chess.com), ligne moteur (interrupteur « Analyse en direct », moteur et profondeur, roue dentée), lignes du moteur en direct (1 à 5, score + coups, cliquables), **bulle de coach** (pastille de classe + coup + score, paragraphes d'explication, bloc rouge « Après ce coup ▶ Voir », bloc vert « Meilleure suite ▶ Voir », source de l'évaluation), gros bouton « Suivant », nom de l'ouverture, liste des coups en deux colonnes avec icônes de classe, graphique d'avantage cliquable avec points sur les erreurs, bouton Analyser / progression + Arrêter / Reprendre, **tableau de statistiques** (précision des deux joueurs, compte par classe cliquable qui saute aux coups), relancer l'analyse, barre de navigation (début, précédent, lecture auto, suivant, fin), mode variante (bandeau et retour à la partie). Modale de paramètres à onglets Moteur (Stockfish Boost PC ou Lite navigateur, profondeur, temps max, nombre de variantes, threads) et Interface (flèches, coups clés, classification sur l'échiquier). Prévois les états avant analyse, analyse en cours, bilan, variante.

3. **Analyse libre** : accueil à deux grandes cartes (Nouvelle analyse, Définir la position) ; **éditeur de position** (échiquier avec palette de pièces noires et blanches, outils main et gomme, glisser-déposer, trait, 4 roques, boutons Position de départ / Vider / Retourner, champ FEN, message de validation en direct vert ou rouge, bouton Valider) ; l'analyse réutilise l'écran 2.

4. **Jouer contre Maia** : écran de départ (carte du bot avec Elo, curseur 600–2 800, choix Blancs / Aléatoire / Noirs, texte de téléchargement du modèle avec progression, bouton Jouer) ; partie (joueurs « Vous » et « Maia (Elo) réfléchit… », barre d'évaluation optionnelle, actions Rejouer le coup / Aide / Abandonner / Nouvelle partie, zone d'état, conseil Stockfish avec flèche verte, ouverture, liste des coups, navigation) ; encart de fin de partie (résultat, score, Rejouer, Analyser) ; modale de réglages (barre d'évaluation, flèches, modèle Maia 5M/23M).

5. **Ouvertures : accueil** : liste de cartes de répertoires (avatar roi, nom, couleur, nombre de coups, « N à revoir », performance 90 jours +V =N −D, mini-barre de couverture + trous, résumé de maîtrise, supprimer) ; boutons Nouveau répertoire (modale nom + couleur) et Importer un PGN (modale : fichier, lien d'étude Lichess ou texte, destination, nom, couleur) ; bloc **Suggestions** (erreurs répétées hors répertoire, ligne, fautes par type, meilleur coup, « Ajouter au répertoire ») ; bloc **S'entraîner** à quatre modes : À revoir (répétition espacée, coups isolés ou lignes complètes), Tout le répertoire, Une ouverture, Ciblé.

6. **Ouvertures : éditeur de répertoire** : échiquier jouable (chaque coup est ajouté), actions S'entraîner et Jouer contre Maia d'ici ; panneau : nom de l'ouverture, performance, bandeaux « position à enrichir » et « trou du répertoire », **barre de maîtrise** colorée, **couverture** (barre, %, bouton « Aller au plus gros trou », liste des trous), **arbre des coups** avec variantes indentées, notes ✎, transpositions, menu contextuel (désactiver, réactiver, supprimer), zone de note avec idée automatique, **explorateur à trois onglets** Masters / Lichess / Stockfish (tableau des coups avec fréquence, nombre de parties et barre blanc/nulle/noir ; point ● si déjà dans le répertoire), navigation ; modale de réglages à 3 onglets (filtres Lichess par Elo et cadence, interface, moteur). Cet écran est le plus dense : trouve une hiérarchie claire (onglets ou sections repliables, panneau redimensionnable).

7. **Ouvertures : entraînement** : échiquier, répertoire et cible en cours, message de retour (bon coup, erreur, l'adversaire joue), Indice en deux temps (idée puis coup), Ligne suivante, statistiques de séance (bonnes réponses, erreurs, %, lignes terminées), écran de fin de séance.

8. **Paramètres** : menu secondaire Profil / Connexion ; pseudo chess.com ; connexion GitHub (compte, dépôt privé, jeton masqué, tester, synchroniser, oublier, statut et date de dernière synchro, guide pas-à-pas repliable) ; connexion Lichess (jeton, guide) ; installation de l'appli sur le téléphone. Propose de regrouper aussi ici les réglages moteur aujourd'hui dispersés dans des roues dentées.

9. **Pages « bientôt »** : Puzzles (par thème, classement, puzzles tirés de ses erreurs), Étude stratégique (« Trouve le plan » avec Leela Chess Zero), Finales (cours théoriques, entraînement contre les tables, finales ratées). Conçois des pages de présentation attrayantes, plus des maquettes de l'écran final probable pour Puzzles.

## Composants et comportements transverses à illustrer
Toasts, modales natives avec onglets, confirmations (à remplacer par des modales de confirmation propres), menu contextuel par clic droit ou appui long, états vide / chargement / erreur pour chaque liste, raccourcis clavier (← → ↑ ↓, Espace, F, Échap) affichés dans une aide, retournement de l'échiquier, promotion de pion, flèches, pastille de classification sur la case.

## Contraintes
- Mobile d'abord pour l'échiquier : cibles tactiles ≥ 44 px, panneau en feuille coulissante sous l'échiquier, navigation des coups toujours accessible au pouce.
- Accessibilité : contraste AA, focus visible, tout est faisable au clavier, les couleurs de classification ne sont jamais le seul signal (symbole ou texte associé), respect de prefers-reduced-motion.
- Langue : français uniquement ; prévois la place pour des textes plus longs.
- Technique : HTML/CSS/JS sans framework, composants légers, pas de dépendance lourde.

## Livrables
1. Système de design (tokens, composants, états).
2. Maquettes haute fidélité de chaque écran ci-dessus en version bureau (1440 px) et mobile (390 px).
3. Parcours clés : importer ses parties → analyser → revoir ses erreurs ; créer un répertoire → l'enrichir depuis l'explorateur → s'entraîner → voir sa maîtrise progresser ; jouer contre Maia → analyser la partie.
4. Courte note de rationale sur les choix qui simplifient les écrans les plus denses (vue partie et éditeur de répertoire).
