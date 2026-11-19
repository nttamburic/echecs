# Chess Journey : bilan des fonctionnalités avec interface

Application web personnelle (PWA, sans serveur), en français, thème sombre inspiré de chess.com.
Pile technique : JavaScript natif (modules ES), HTML/CSS sans framework, Stockfish 19 en WebAssembly, bot Maia3 (ONNX) dans un Worker, chess.js, stockage local IndexedDB synchronisé avec un dépôt GitHub privé, API publiques chess.com et Lichess.
Navigation par hash (`#/games`, `#/game/<id>`, `#/play`, `#/free`, `#/openings`, `#/settings`…).

Légende : ✅ livré · 🚧 page « bientôt » (présentation seulement)

---

## 0. Éléments transverses

| Élément | Utilité | Implémentation actuelle |
|---|---|---|
| Barre latérale ✅ | Navigation principale | Colonne fixe de 220 px, fond #1f1e1c, logo (cavalier) + « Chess Journey ». 7 entrées avec icône SVG au trait : Jouer, Analyse libre, Ouvertures, Puzzles, Étude stratégique, Finales, Historique des parties. « Paramètres » épinglé en bas. Entrée active : fond plus clair, barre verte à gauche, icône verte. |
| Menu téléphone ✅ | Même navigation sur mobile | ≤ 760 px : barre du haut (bouton hamburger + logo), la barre latérale devient un tiroir avec voile sombre ; fermeture par voile, Échap ou choix d'une entrée. |
| Pastille d'alerte ✅ | Signaler une synchro en échec | Point rouge sur « Paramètres » (et sur le hamburger) si la synchronisation GitHub échoue. |
| Toasts ✅ | Retours courts (sync terminée, coup désactivé, import réussi…) | Bandeau en bas, disparaît seul (3,5 à 6 s), annoncé aux lecteurs d'écran (`aria-live`). |
| Fenêtres modales ✅ | Réglages et formulaires | Éléments `<dialog>` natifs, boutons Annuler / action principale en bas à droite, onglets internes pour les réglages. |
| Confirmations ✅ | Actions destructrices | `confirm()` natif (effacer l'historique, supprimer un répertoire, abandonner, oublier un jeton…). |
| Installation PWA ✅ | Utiliser comme une appli, hors ligne | Manifest + service worker (code : réseau d'abord ; moteur, pièces, ouvertures : cache d'abord). Bouton « Installer l'application » dans Paramètres. |
| Échiquier ✅ | Composant central, réutilisé partout | Cases claires/foncées (#ebecd0 / #779556), pièces SVG cburnett, coordonnées, clic-clic ou glisser-déposer, choix de promotion (D/T/F/C), flèches colorées, surbrillance du dernier coup, pastille de classification du coup sur la case, retournement (touche F). |
| Barre d'évaluation ✅ | Qui est mieux | Barre verticale blanc/noir à gauche de l'échiquier, valeur (+1,3 / M4 / 1-0) placée côté du camp qui gagne, s'inverse quand l'échiquier est retourné. |
| Raccourcis clavier ✅ | Naviguer sans souris | ← → coup précédent/suivant, ↑/Début et ↓/Fin, Espace lecture auto, Échap quitter une variante, F retourner. Éléments cliquables atteignables au clavier (role=button, tabindex, Entrée/Espace). |
| Notation en figurines ✅ | Lisibilité façon chess.com | Les coups s'affichent avec l'icône de la pièce (♞f3), commentaires en français (R, D, T, F, C). |
| Classification des coups ✅ | Vocabulaire visuel commun | 10 classes avec couleur et symbole : Brillant `!!` #1baaa6, Très bon `!` #5c8bb0, Meilleur ★ #81b64c, Excellent 👍 #96bc4b, Bon ✓ #95b776, Théorie 📖 #a88865, Imprécision `?!` #f7c631, Erreur `?` #ffa459, Occasion manquée ✗ #ff7769, Gaffe `??` #fa412d. |
| Palette | Identité visuelle | Fond #262421, panneaux #302e2b / #3a3835, texte #e8e6e1, texte atténué #9b9893, accent vert #81b64c, lien/focus bleu clair #8fc3ff, danger #fa412d, avertissement #f7c045. Police système (Segoe UI). Rayons 3 / 6 / 8 px. |

---

## 1. Historique des parties (écran d'accueil, `#/games`) ✅

**Utilité** : retrouver ses parties chess.com terminées, les filtrer, ouvrir celle à analyser, lancer l'analyse en lot.

**Implémentation**
- **En-tête** : titre avec le pseudo chess.com, boutons « Actualiser » (récupère les parties) et « Effacer l'historique » (rouge, confirmation détaillée, supprime aussi les analyses sur GitHub). Message d'aide avec lien vers Paramètres → Profil si aucun pseudo. Ligne d'état de chargement (« seules les parties terminées sont récupérées »).
- **Filtres** : recherche par adversaire, cadence (Toutes, Bullet, Blitz, Rapide, Par jour), ouverture jouée (liste déroulante groupée par famille puis variantes, alimentée par les parties analysées), compteur de parties.
- **Tableau** : Date, Cadence (masquée sur mobile), Moi (pastille de couleur blanc/noir + Elo), Adversaire (+ Elo), Résultat (Victoire verte / Nulle / Défaite rouge), Précision (% si analysée, « en partie » si analyse incomplète, vide sinon). Clic sur une ligne = ouvre la partie. « Afficher plus » (pagination 100 puis +200).
- **Analyse multiple** : bouton (désactivé s'il n'y a rien à analyser) → fenêtre : période (toutes les parties ou les N derniers jours, avec le nombre de parties restantes ; options grisées si 0), réglages moteur (voir §2), « Lancer l'analyse ». Ensuite barre de progression texte sous les filtres ; l'analyse se met en pause quand on ouvre une partie et reprend au retour.

---

## 2. Vue d'une partie : analyse et bilan (`#/game/<id>`) ✅

**Utilité** : comprendre ses erreurs coup par coup, façon « Game Review » chess.com.

**Implémentation** (échiquier à gauche, panneau à droite ; sur mobile, empilés)
- **Joueurs** au-dessus et au-dessous de l'échiquier : nom, Elo, pièces capturées + avantage matériel (+3).
- **Échiquier** avec flèche verte du meilleur coup (avant de jouer), dernier coup surligné, pastille de classification sur la case d'arrivée, bouton « ⇅ Retourner ».
- **En-tête du panneau** : retour à l'historique, titre « Analyse » puis « ★ Bilan » une fois la partie entièrement analysée, lien vers la partie sur chess.com.
- **Ligne moteur** : interrupteur « Analyse » (lignes du moteur en direct), description du moteur actif (« Boost PC » ou « Stockfish 19 lite · navigateur », profondeur), roue dentée.
- **Lignes en direct** : 1 à 5 variantes avec score et suite de coups ; clic = joue la ligne sur l'échiquier comme variante.
- **Coach** (bulle) : en mode Bilan ou dans une variante. Titre du coup avec pastille de classe et score, 1 à 3 paragraphes d'explication en français (pièce prise, menace, matériel perdu, ouverture connue…), bloc rouge « Après ce coup ▶ Voir » (réfutation), bloc vert « Meilleure suite ▶ Voir », source de l'évaluation (cloud Lichess, tables de finales ou moteur local). Gros bouton « → Suivant » pour avancer coup par coup.
- **Nom de l'ouverture** de la position courante.
- **Liste des coups** : deux colonnes (blancs/noirs), figurines, icône de classification pour les coups notables, coup courant surligné.
- **Graphique d'avantage** : courbe SVG blanc/noir, points colorés sur les gaffes, erreurs, coups brillants ; clic = saute à ce moment ; curseur vert.
- **Pied de panneau** : bouton « Analyser » (ou « Reprendre »), pendant l'analyse barre de progression + « Arrêter ».
- **Statistiques de la partie** (section repliable) : tableau précision des deux joueurs + nombre de coups par classe ; un clic sur un nombre saute cycliquement à ces coups ; « Relancer l'analyse avec les réglages actuels ».
- **Barre de navigation** : début, précédent, lecture automatique (▶/⏸), suivant, fin.
- **Variantes** : on peut jouer ses propres coups ; bandeau « Variante » avec ses coups notés, bouton « ↩ Revenir à la partie ».
- **Fenêtre de paramètres (roue dentée)**, 2 onglets :
  - *Moteur* : Stockfish 19 Boost PC (serveur local, multi-cœurs) ou Stockfish 19 Lite (navigateur, 1,8 Mo) ; profondeur ; temps maximum (sans limite, 1 à 30 s) ; nombre de variantes (1 à 5) ; threads. Messages d'aide contextuels.
  - *Interface* : afficher les flèches, marquer les coups clés, afficher la classification sur l'échiquier.

---

## 3. Analyse libre (`#/free`) ✅

**Utilité** : analyser une position ou une idée qui ne vient pas d'une partie chess.com (sans sauvegarde).

**Implémentation**
- **Accueil** : deux grandes cartes cliquables avec icône pièce : « Nouvelle analyse » (position de départ, on joue les deux camps, Stockfish note chaque coup) et « Définir la position ».
- **Nouvelle analyse** : réutilise toute la vue partie (§2) : coach, lignes, variantes, roue dentée, retour vers `#/free`.
- **Éditeur de position** (`#/free/setup`) : échiquier avec palette de pièces noires au-dessus et blanches en dessous, outils Main (déplacer) et Gomme ; poser en cliquant, déplacer en glissant, retirer en sortant de l'échiquier ou clic droit. Panneau latéral : trait aux Blancs/Noirs, 4 cases de roques (grisées si roi/tour mal placés), « Position de départ », « Vider l'échiquier », « Retourner », champ FEN éditable, message de validation en direct (« Position valide » vert ou erreur rouge : un seul roi, pas de pion en 1re/8e rangée, roi adverse en échec…), « Valider la position » (désactivé si invalide).

---

## 4. Jouer contre Maia (`#/play`) ✅

**Utilité** : s'entraîner contre un bot qui joue comme un humain d'un niveau donné ; parties non enregistrées.

**Implémentation**
- **Écran de départ** : carte du bot (avatar, « Maia · bot au jeu humain », Elo en grand), curseur de niveau 600 à 2 800 par pas de 100 (repères 600 / 1700 / 2800), choix de la couleur (Blancs / Aléatoire / Noirs, trois grosses cases avec icône), texte d'information (téléchargement du modèle la 1re fois, avec progression en Mo), bouton « Jouer ».
- **En partie** : joueurs haut/bas (« Vous » / « Maia (1500) — réfléchit… », captures), barre d'évaluation Stockfish (optionnelle), échiquier ; panneau : 4 actions (↶ Rejouer le coup, 💡 Aide, ⚑ Abandonner, ⟳ Rejouer la partie), zone d'état (« À vous de jouer », « Maia réfléchit… », conseil de Stockfish en vert avec flèche verte), nom de l'ouverture, liste des coups (cliquable pour revoir), navigation 4 boutons.
- **Fin de partie** : encart de résultat (mat, pat, répétition, matériel insuffisant, règle des 50 coups, abandon) avec score 1-0 / 0-1 / ½-½, boutons « Rejouer la partie » et « Analyser la partie » (envoie vers l'analyse libre).
- **Roue dentée** : barre d'évaluation oui/non, flèche bleue du meilleur coup oui/non, choix du modèle Maia (5M léger / 23M plus humain).
- **Entrée depuis un répertoire** : le bouton « Jouer contre Maia d'ici » démarre la partie à la position choisie, avec la couleur du répertoire.

---

## 5. Ouvertures (`#/openings`) ✅ : le module le plus riche

**Utilité** : construire un répertoire d'ouvertures, le travailler en répétition espacée, mesurer sa maîtrise et repérer ses trous.

### 5.1 Accueil des répertoires
- Boutons « + Nouveau répertoire » et « Importer un PGN ».
- **Cartes de répertoire** (cliquables) : avatar roi blanc/noir, nom, couleur, nombre de coups, « N à revoir » en gras, score de mes parties sur 90 jours (+V =N −D), mini-barre de couverture avec % et nombre de trous, résumé de maîtrise par pastilles colorées, bouton « Supprimer ».
- Statut Lichess (jeton enregistré ou non).
- **Fenêtre « Nouveau répertoire »** : nom, choix Blancs/Noirs.
- **Fenêtre « Importer un PGN »** : fichier, lien d'étude Lichess ou texte collé ; destination (nouveau répertoire ou existant, avec nom et couleur si nouveau) ; toutes les variantes importées ; commentaires `{…}` convertis en notes ; message d'erreur ; toast de bilan (« 42 coups importés depuis 3 parties »).
- **Bloc « Suggestions »** : positions où l'on refait la même faute (≥ n fois) juste après avoir quitté le répertoire, avec la ligne, le décompte des fautes par type (colorées), le coup joué, le meilleur coup du moteur, bouton « Ajouter au répertoire ». Messages si pseudo manquant, parties non chargées ou non analysées.
- **Bloc « S'entraîner »** : 4 modes en cartes :
  1. *À revoir* (répétition espacée : nombre dû + nouveaux du jour) avec choix « Coups isolés / Lignes complètes » ;
  2. *Tout le répertoire* (lignes aléatoires) ;
  3. *Une ouverture* (liste + Commencer) ;
  4. *Ciblé* (coups non maîtrisés puis jamais revus).
  Boutons désactivés s'il n'y a rien à travailler.

### 5.2 Éditeur d'un répertoire (`#/openings/<id>`)
- **Colonne échiquier** : échiquier jouable (jouer un coup l'ajoute au répertoire), barre d'évaluation optionnelle, « ⇅ Retourner », « ▶ S'entraîner », « ♟ Jouer contre Maia d'ici », rappel de l'interaction clic droit / appui long.
- **Panneau** : retour + nom avec avatar ; nom de l'ouverture ; ma performance sur la position ; bandeau de suggestion (💡 position à enrichir / 🕳️ trou du répertoire) ; **barre de maîtrise** (pastilles : maîtrisé vert, en cours jaune, non maîtrisé rouge, jamais revu gris, non compté bleu, détail du coup courant) ; **couverture** (barre de progression, % couvert, bouton « Aller au plus gros trou », liste dépliable des trous les plus fréquents, chaque ligne cliquable) ; **arbre des coups** (ligne principale + variantes indentées, numéros, souligné de maîtrise, ✎ pour les notes, « ↪ transposition ») ; **menu contextuel** sur un coup (clic droit ou appui long 2 s) : Désactiver / Réactiver / Supprimer… ; **note** sur le coup affiché (zone de texte 600 car., avec « idée automatique » générée en dessous) ; **explorateur** à trois onglets :
  - *Masters* et *Lichess* : tableau des coups (figurine, % de fréquence, nombre de parties, barre blanc/nulle/noir), clic = ajoute au répertoire, point ● si déjà présent, ligne Σ ; messages (jeton manquant, chargement, erreur, aucune partie) ;
  - *Stockfish* : lignes du moteur avec score, clic = joue le coup.
- **Navigation** : début, précédent, suivant, fin de ligne.
- **Fenêtre de paramètres** (3 onglets) : *Filtres Lichess* (Elo moyen des joueurs par tranches, cadences), *Interface* (flèche du meilleur coup, barre d'évaluation, seuil de couverture « 1 partie sur N »), *Moteur* (mêmes champs que §2).

### 5.3 Entraînement (`#/openings/train/<mode>`)
- Échiquier à gauche ; panneau : retour/arrêt, titre du mode, répertoire courant, cible (« 3/20 : position non maîtrisée »), message de retour (bon coup, mauvais coup, adversaire joue…), boutons « 💡 Indice » (en deux temps : idée du coup, puis le coup — compte comme une erreur) et « Ligne suivante → », ligne en cours, statistiques (bonnes réponses, erreurs, %, lignes terminées).
- Adversaire : répond selon la fréquence réelle de Lichess au niveau de l'utilisateur. Un mauvais coup laisse la position et on réessaie ; seule la première tentative compte.
- Modèle de répétition espacée (type SM-2) avec limite de nouvelles cartes par jour.

---

## 6. Paramètres (`#/settings`) ✅

**Utilité** : configurer le compte et les connexions ; les réglages moteur sont dans les roues dentées contextuelles.

**Implémentation** : titre de page, menu secondaire à gauche (Profil chess.com / Connexion), contenu en cartes.
- **Profil chess.com** : champ pseudo + « Enregistrer », message de confirmation avec lien vers l'historique ; synchronisé entre appareils.
- **Connexion au cloud GitHub** : compte, dépôt privé (défaut `echecs-data`), jeton fine-grained (champ masqué) ; boutons « Enregistrer et tester », « Synchroniser maintenant », « Oublier le jeton » ; message d'état (test, synchro en cours, date de dernière synchro, erreur) ; guide repliable pas-à-pas pour créer dépôt et jeton.
- **Connexion à Lichess** : jeton `lip_…` (nécessaire pour l'explorateur), « Enregistrer et tester », « Oublier le jeton », statut ; guide repliable.
- **Installer l'appli sur le téléphone** : section repliable, bouton d'installation quand disponible.

---

## 7. Modules annoncés 🚧 (Puzzles est livré : rush, thèmes, recommandés)

Carte avec titre, « Ce module arrive bientôt. Au programme : » et liste.
- **Étude stratégique** : « Trouve le plan », idées de milieu de jeu avec Leela Chess Zero.
- **Finales** : cours des finales théoriques (opposition, Lucena, Philidor, mat Fou + Cavalier…) ; entraînement contre la défense parfaite des tables ; finales ratées transformées en exercices.

---

## Constat pour un redesign

- Un seul gabarit domine : **échiquier à gauche + panneau fonctionnel à droite** (partie, jouer, éditeur de répertoire, entraînement). Les pages « liste » (historique, ouvertures, paramètres) sont des colonnes de cartes de 1000 px.
- Le panneau de la vue partie est très dense (10 zones empilées) ; l'éditeur de répertoire l'est encore plus.
- Les réglages sont dispersés dans des roues dentées par module, avec des champs moteur répétés.
- Les confirmations utilisent les boîtes natives du navigateur ; les états vides et d'erreur sont de simples lignes de texte.
- Deux sections du menu (Étude stratégique, Finales) n'ont pas encore de contenu.
