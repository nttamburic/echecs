# Chess Journey — refonte du design : dossier de passation

Ce dossier sert à Claude Code pour implémenter la refonte dans le dépôt `echecs` (HTML/CSS/JS sans framework).

**Référence visuelle.** Le canevas Claude Design « Chess Journey » contient les maquettes. Chaque écran y est une planche :

- bureau à 1440 px ;
- mobile à 390 px ;
- tailles intermédiaires 1280, 1024, 768 et 844 × 390.

**Fichiers fournis avec ce document :**

| Fichier | Rôle |
|---|---|
| `tokens.css` | Toutes les variables du thème. C'est la seule source des couleurs. |
| `format.js` | Fonctions de format (nombres, dates, durées), à placer dans `core/format.js`. |
| `HANDOFF.md` | Ce document. |

---

## 1. Décisions figées

| # | Décision | Conséquence pour le code |
|---|---|---|
| D1 | **Thème sombre unique.** Le mode clair a été essayé puis abandonné. | Pas de `prefers-color-scheme`, pas de bascule de thème. `color-scheme: dark` dans `tokens.css`. |
| D2 | **Pièces cburnett par défaut.** Ce sont celles déjà présentes dans `pieces/`, sous licence CC BY-SA 3.0. | Garder le crédit dans le README et dans Paramètres › Interface. Les jeux « doux » et « géo » ne sont pas à implémenter. Le style « Épuré » est abandonné. |
| D3 | **Échiquier « Vert tournoi » par défaut.** Quatre autres modèles sont proposés : Ardoise, Sable, Graphite, Sauge. | Attribut `data-board` sur `<html>`, mémorisé par appareil (`localStorage`). Les couleurs sont dans `tokens.css`. |
| D4 | **Paramètres › Interface est le seul réglage d'apparence.** Il contient le modèle d'échiquier, les coordonnées (afficher ou masquer, à l'intérieur des cases) et le rappel du jeu de pièces. | Nouvel onglet dans `modules/settings.js`. |
| D5 | **Les réglages moteur quittent la roue dentée.** Ils passent dans Paramètres › Moteur. La vue partie ne garde qu'un panneau « Réglages de l'analyse », qui contient : analyse en direct, nombre de lignes, flèches, et un lien « Tous les réglages moteur ». | `#eng-dlg` est réduit. `engineFields()` est réutilisé dans `settings.js`. |
| D6 | **Points de rupture : 760 / 1280 / 1600, plus le mobile paysage (hauteur ≤ 500).** Les anciens points 1100 et 1150 disparaissent. | Voir § 4. Rail d'icônes de 72 px entre 761 et 1279 px en paysage. |
| D7 | **Cibles tactiles ≥ 44 px** sous 1280 px. | Utiliser `--tap`. La liste des coups passe en lignes de 44 px sur mobile. |
| D8 | **Synchronisation : parties et analyses en ajout seul.** Elles n'entrent jamais en conflit. Seuls les répertoires et les notes peuvent entrer en conflit. | La fenêtre de conflit ne liste que ceux-là. Action recommandée : « Tout fusionner ». |
| D9 | **Une seule bulle de coach**, qui remplace les blocs classification, explication et suites. « Suivant » saute au coup clé suivant. | Voir § 3, composant Coach. |
| D10 | **Glossaire et formats imposés.** Ils sont décrits dans les planches « Glossaire » et « Formats ». | Tout nombre ou date affiché passe par `core/format.js`. |

---

## 2. Écrans → fichiers du dépôt

| Écran (page du canevas) | Planches de référence | Fichiers à modifier | Changements principaux |
|---|---|---|---|
| Coque : barre latérale, rail, barre du haut | Sidebar, Responsive, GameTablet | `index.html`, `main.js`, `style.css` | Rail de 72 px (761–1279 px paysage) avec infobulles. Point rouge de synchro sur l'icône. Barre du haut de 52 px et tiroir avec voile sur mobile et en portrait. Lien « Aller au contenu ». |
| Historique (2) | History, HistoryStates, HistoryMobile | `modules/analyse.js` (`renderList`, `renderBatch`, `openMultiDialog`, `clearHistory`) | Tableau en grille accessible (`role=table`). Filtres en puces. Dates via `fmtGameDate`, ce qui remplace `toLocaleDateString` jj/mm/aa. Cartes sur mobile. États vide, chargement et erreur. Feuille « Analyser plusieurs parties ». |
| Vue partie (3) | GameReview, GameStates, GameMobile, GameLaptop, GameTablet, GameTabletPortrait, GameLandscape | `modules/analyse.js` (`renderGame`, `renderCoach`, `renderMoves`, `renderSummary`, `renderGraph`, `renderNav`), `explain.js`, `analysis.js` | Bulle de coach. Onglets Coups, Bilan et Moteur. Feuille coulissante à 3 crans sur mobile. `fmtScore` passe à 1 décimale, virgule et signe moins (§ 5). |
| Analyse libre (4) | FreeHome, PositionEditor, LibreMobile | `modules/setup.js`, `modules/analyse.js` (`openFree`) | Cartes d'accueil. Éditeur avec palettes cburnett. Erreurs FEN en ligne. |
| Jouer contre Maia (4) | PlayStart, PlayGame, PlayStates, PlayMobile, MobileSheetsC | `modules/play.js` | Curseur Elo 600–2800 avec préréglages. Choix de couleur. Barres joueurs avec pendule. Fin de partie avec « Analyser la partie » en action principale. Flèches `--arrow-best` et `--arrow-alt`, qui remplacent `#4caf50` et `#3b82f6`. |
| Ouvertures : accueil (5) | OpeningsHome, OpeningsModals, OpeningsMobile, MobileSheetsB | `modules/openings-ui.js`, `modules/openings.js` | Cartes de répertoire avec barre de maîtrise et légende. « À revoir ». Nouveau répertoire, import PGN. |
| Éditeur de répertoire (5) | RepertoireEditor, MobileSheetsB | `modules/openings-ui.js`, `modules/openings-coverage.js` | Trois zones : en-tête, arbre, onglets Explorateur, Couverture et Note. Alerte « trou » en une ligne. Panneau redimensionnable de 420 à 720 px. |
| Entraînement (5) | Training, MobileSheetsC | `modules/openings-train.js` | Retour immédiat. Indice en deux temps. Fin de séance avec maîtrise avant → après. Flèches via les variables. |
| Paramètres (6) | Settings, SettingsMobile, MobileSettings | `modules/settings.js`, `index.html` | Onglets Profil, Connexions, Moteur, Interface et Application. Liste puis détail sur mobile. |
| Bientôt (6) | PuzzlesSoon, SoonOthers, MobileSoon | `modules/soon.js` | Page de présentation avec action utile (« Revoir mes erreurs en attendant »). |
| Échiquier (tous) | Board, BoardInteractions, ChessKit | `board.js` | Thèmes via variables. Points de coups légaux et anneau de prise. Pastille à double anneau. Surlignage clic droit. Clavier. Annonces `aria-live`. |
| Synchro (tous) | SyncStates | `core/sync.js`, `main.js` | Statut dans la navigation. Bandeau hors ligne. Conflit sur deux appareils. Toasts. |

La planche **PuzzlesFinal** est une projection et n'est pas à implémenter maintenant.

---

## 3. Inventaire des composants

Chaque composant a sa planche sur la page « 1 · Système de design ». Les états listés doivent tous exister.

| Composant | Variantes | États à implémenter | Notes |
|---|---|---|---|
| Bouton | primaire, secondaire, danger, icône, lien | repos, survol (`hover: hover` seulement), focus clavier, désactivé, chargement (« Analyse… ») | Libellé à l'infinitif. Un bouton destructif répète l'action. |
| Champ texte | texte, jeton (avec « Afficher »), FEN | vide, rempli, erreur en ligne, désactivé | L'erreur est placée sous le champ, avec un symbole et un texte, jamais la couleur seule. |
| Sélecteur / contrôle segmenté | menu, segments (cadence), pas à pas − / + | actif, focus | Les pas à pas remplacent les curseurs sur mobile. |
| Bascule | — | marche, arrêt, focus | `role="switch"`. |
| Onglets | soulignés (panneau), latéraux (Paramètres) | actif, survol, focus | Flèches du clavier dans la liste d'onglets. |
| Puces / pastilles | filtre, résultat (+ = −), cadence, compteur | active, inactive | 44 px de haut sur mobile. |
| Carte | répertoire, accueil analyse libre | repos, survol, focus | — |
| Tableau → grille | Historique | survol de ligne, ligne focus, tri | Devient une liste de cartes sous 760 px et à 200 % de zoom. |
| Toast | succès, erreur avec action, info avec « Annuler » | entrée et sortie (`--dur-base`) | En bas à droite sur bureau, en bas au-dessus de la barre des coups sur mobile. 5 s, deux lignes au plus. |
| Modale | confirmation, à onglets | ouverte, focus piégé | Sur mobile, devient une feuille pleine hauteur ou une feuille d'actions. |
| Feuille (mobile) | coulissante à 3 crans, feuille du bas, feuille d'actions | crans replié, mi-hauteur, plein | Poignée de 44 px de zone tactile. Glisser ou toucher. `--dur-slow`. |
| Menu contextuel | arbre de répertoire | ouvert | Clic droit, appui long de 400 ms (vibration), touche Menu. Sur mobile, ouvre une feuille d'actions. |
| États de liste | vide, chargement, erreur | — | Chaque liste a les trois. |
| **Board** (`board.js`) | 5 thèmes, coordonnées oui/non, retourné | sélection, coups légaux, prise, dernier coup, échec, glisser, flèches, surlignage, pastille, promotion | Pièces en `<img>` cburnett. Pastille avec `--badge-ring`. |
| **PlayerBar** | Blancs, Noirs | actif (pendule claire), « réfléchit… », pendule < 10 s | Le pseudo se coupe en « … ». L'Elo et la pendule ne se coupent jamais. |
| **EvalBar** | verticale (28 / 20 px), horizontale (8 px, mobile) | — | `role="meter"`. Le chiffre est du côté qui a l'avantage. |
| **NavBar** | revue, partie en cours | lecture automatique | Retourner, début, précédent, lecture, suivant, fin. Inclut l'inset bas de la zone sûre. |
| **Coach** | gaffe, brillant, imprécision, théorie, meilleur | replié, déplié, « Lire la suite » | Trois paragraphes au plus, puis le troisième est coupé. Les boutons « Voir » font 44 px. |
| **MoveList** | partie analysée, partie Maia | coup courant, pastilles, lignes tactiles de 44 px | Chiffres tabulaires. |
| **AdvGraph** | — | coup courant, points des coups clés | Clic ou toucher → aller au coup. |
| Explorateur | Masters, Lichess, Stockfish | chargement, vide, jeton manquant | Barre Blancs / nulle / Noirs avec `--explorer-*`. |
| Barre de maîtrise | — | — | Toujours accompagnée de la légende textuelle (✓ ◐ ✗ ○ –). |

---

## 4. Responsive

| Forme | Condition | Navigation | Table de jeu |
|---|---|---|---|
| Mobile | `max-width: 760px` | Barre du haut de 52 px + tiroir | Empilée : échiquier pleine largeur, feuille à 3 crans, barre des coups fixe en bas. |
| Mobile paysage | `max-height: 500px` et paysage | Aucune barre ; retour et menu dans le panneau | Échiquier à gauche sur toute la hauteur, panneau à droite. |
| Tablette portrait | 761–1279 px, portrait | Barre du haut + tiroir | Échiquier centré (≤ 560 px), panneau à onglets en dessous. |
| Tablette / petit portable | 761–1279 px, paysage | Rail de 72 px | Côte à côte, panneau de 340 à 380 px. |
| Ordinateur | ≥ 1280 px | Barre latérale de 220 px | Côte à côte, panneau redimensionnable de 380 à 480 px. |
| Grand écran | ≥ 1600 px | Barre latérale | Échiquier plafonné à 840 px, contenu centré. |

Taille de l'échiquier : `--board` dans `tokens.css`, c'est-à-dire `clamp(288px, min(100dvh − chrome vertical, 100vw − chrome horizontal), 840px)`.

Autres règles :

- `viewport-fit=cover` et `env(safe-area-inset-*)` sur la barre des coups et les feuilles.
- Les survols sont toujours sous `@media (hover: hover)`, comme c'est déjà le cas dans `style.css`.

---

## 5. Contenu et formats

- **Glossaire.** La planche « Glossaire et règles d'écriture » fait foi. Les points essentiels :
  - Analyse (le calcul) et Bilan (le résultat).
  - Répertoire, Ouverture, Ligne et Variante.
  - Trou ; Révision et séance.
  - Paramètres (la page) et Réglages (le panneau local).
  - Maia est au féminin.
  - On vouvoie l'utilisateur.
- **Classes de coups.** L'ordre et les couleurs sont ceux de `CLASSES` dans `analysis.js` : Brillant !!, Très bon !, Meilleur ★, Excellent ✦, Bon ✓, Théorie T, Imprécision ?!, Erreur ?, Occasion manquée ✗, Gaffe ??.
  - Seul changement : remplacer les emojis 👍 (excellent) par ✦ et 📖 (book) par T. Les emojis s'affichent différemment selon le système et ne tiennent pas dans la pastille.
  - Les couleurs passent par `--cls-*`. La correspondance avec les clés de code est en commentaire dans `tokens.css`.
- **Formats.** Utiliser `format.js` (testé) partout :
  - `fmtScore` (`analysis.js`) doit renvoyer `fmtEval(cp, mate)`. Aujourd'hui il renvoie `toFixed(2)` avec un point (« +0.40 ») ; il faut « +0,4 ».
  - `analyse.js:132` et `analyse.js:777` : passer à `fmtGameDate`.
  - `settings.js:140` (« Dernière synchronisation ») : passer à `fmtAgo`.
  - `fmtN` dans `openings-ui.js` peut rester (k / M avec virgule), car il respecte déjà la règle.
- **Typographie.** Apostrophe ’, guillemets « » avec espace insécable (U+00A0), espace fine insécable (U+202F) avant ; ! ? %, points de suspension en un seul caractère (…).
- **Notation des coups.** `16. ♗b3`, `6… a6`, annotation collée au coup : `16. ♘h4??`.
- **Textes longs.** Les règles sont sur la planche « Formats et textes longs » :
  - pseudos, noms d'ouverture et noms de répertoire se coupent en « … », avec le texte complet dans `title` et dans `aria-label` ;
  - les boutons, l'Elo, les évaluations et les pendules ne se coupent jamais ;
  - toasts : deux lignes au plus ; bulle de coach : trois paragraphes au plus.

---

## 6. Accessibilité (critères d'acceptation)

- Contraste AA sur tous les textes. Les seules exceptions sont les coordonnées de l'échiquier et les boutons désactivés. Les valeurs de `tokens.css` sont déjà vérifiées : ne pas introduire de nouvelle couleur de texte.
- Cibles de 44 px au moins sous 1280 px. Focus visible de 2 px `--focus`. Ordre de tabulation logique. Lien « Aller au contenu ».
- Échiquier :
  - `role="grid"` ;
  - flèches pour déplacer la case active, Entrée pour prendre ou poser une pièce, Échap pour annuler ;
  - chaque coup est annoncé en toutes lettres (« Cavalier en h4. Gaffe. ») dans une région `aria-live="polite"`.
- Modales et feuilles : focus piégé, Échap pour fermer, retour du focus à l'élément d'origine. Utiliser `<dialog>`, déjà employé dans le dépôt.
- `prefers-reduced-motion` : les durées passent à 0 (déjà prévu dans `tokens.css`). Le flash de coup illégal devient un liseré fixe.
- Zoom à 200 % sans perte de contenu.

---

## 7. Ordre d'implémentation recommandé

Chaque étape est livrable seule et ne casse pas les suivantes.

1. **Tokens.**
   - Ajouter `tokens.css` avant `style.css`. Supprimer le bloc `:root` de `style.css`.
   - Remplacer les couleurs écrites en dur (une soixantaine dans `style.css` ; `#4caf50`, `#3b82f6` et les couleurs de classes dans les JS) par les variables.
   - Ajouter `core/format.js` et brancher `fmtScore` dessus.
   - *Critère :* l'appli est visuellement identique, à l'exception des gris de texte et des rouges corrigés ; « +0,4 » s'affiche partout.
2. **Échiquier et table de jeu responsive.**
   - Dans `board.js` : thèmes, coups légaux, pastille, clavier, annonces.
   - Coque : rail et barre du haut.
   - Points de rupture 760, 1280 et 1600, plus le mobile paysage, appliqués à la table de jeu.
   - *Critère :* les planches GameLaptop, GameTablet, GameTabletPortrait, GameLandscape et GameMobile sont reproduites.
3. **Vue partie.** Bulle de coach, onglets Coups, Bilan et Moteur, feuille à 3 crans sur mobile, réglages de l'analyse allégés (D5).
4. **Historique.** Grille accessible, filtres, cartes sur mobile, états, analyse multiple en feuille.
5. **Ouvertures.** Accueil, éditeur à trois zones, entraînement, feuilles sur mobile.
6. **Jouer contre Maia.** Écran de départ, partie, fin de partie.
7. **Paramètres.** Onglets dont Interface et Moteur, détail sur mobile ; pages « bientôt ».
8. **Synchro et finitions.** États de navigation, bandeau hors ligne, conflits, toasts. Passe d'accessibilité finale (§ 6).

## 8. Hors périmètre

- Mode clair (abandonné, D1).
- Jeux de pièces alternatifs (D2).
- Écran Puzzles final (projection seulement).
- Sons : spécifiés sur la planche BoardInteractions (désactivables dans Paramètres › Interface), à faire en fin de projet.
