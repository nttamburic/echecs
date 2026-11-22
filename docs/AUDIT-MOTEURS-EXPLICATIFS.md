# Audit : moteurs d'échecs qui expliquent la stratégie et la tactique

*Novembre 2026. Objet : recenser les projets existants (produits, open source, recherche) qui associent un moteur (Stockfish, réseau de neurones) à une explication en langage naturel des plans et des motifs, pour situer le projet « moteur de reconnaissance de patterns stratégiques et tactiques assisté par Stockfish ».*

> Méthode : recherche web (sites des produits, dépôts GitHub, arXiv, ACL/NeurIPS). Les fiches des articles récents (2025-2026) reposent surtout sur leurs résumés ; à confirmer en lisant les papiers avant de s'appuyer sur un chiffre.

---

## 1. Synthèse

Trois familles d'approches coexistent :

| Famille | Principe | Points forts | Limites |
|---|---|---|---|
| **A. Règles + moteur** (DecodeChess, Chess.com Coach, `chess-detect`, lichess-puzzler, notre `explain.js`) | Stockfish évalue, des détecteurs écrits à la main nomment les motifs (fourchette, clouage, pion isolé…) | Fiable sur la tactique, explicable, peu coûteux | Plafonne vite sur la stratégie (plans, structures, déséquilibres) ; chaque concept = du code |
| **B. Stockfish + LLM** (ChessBeast, ChessGpt, chess-coach, thinkfish…) | Stockfish calcule, un LLM rédige à partir des lignes calculées | Texte fluide, conversationnel | Hallucinations (pièces inventées, clouages inexistants) ; le LLM ne « voit » pas l'échiquier ; dépendance à une API |
| **C. Réseau de neurones + concepts** (ChessCoach, CCC, QUEEN, sondage d'AlphaZero/Leela) | Un réseau d'échecs encode la position ; on lit ses représentations internes (sondes, vecteurs de concepts) ou on y branche un décodeur de texte | Capte des notions stratégiques que les règles ratent ; c'est **exactement la direction du projet** | Surtout du code de recherche ; données annotées rares ; évaluation de la qualité d'une explication encore ouverte |

**Constat principal** : personne n'a encore de produit grand public qui fasse bien la famille C. Les produits commerciaux sont en A ou A+B ; les résultats les plus intéressants (concepts appris par le réseau → texte) sont dans des articles 2024-2026. Il y a donc une place réelle pour un projet qui combine : réseau de neurones pour **reconnaître** les concepts, Stockfish pour **vérifier** (ancrage), et une couche de génération contrainte pour **expliquer**.

---

## 2. Produits commerciaux

### DecodeChess
- **Ce que c'est** : analyseur payant qui « décode » une position : menaces, plans, rôle de chaque pièce, idée stratégique d'un coup.
- **Technique** : Stockfish NNUE + couche d'IA propriétaire qui traduit l'analyse en phrases (XAI appliquée au moteur).
- **Limites relevées** : explications parfois fausses (un test publié sur Chess.com cite une dame « en c7 » alors qu'elle est en d8) ; pas de dialogue.
- **Intérêt pour nous** : le plus proche du projet en termes de promesse ; montre que l'**ancrage** (vérifier chaque affirmation sur l'échiquier) est le point critique.

### Chess.com – Game Review / Coach
- Classification des coups (brillant… gaffe), moments clés, « Coach explanations » en texte, option « Explain » sur les lignes.
- Explications centrées sur **le coup** (pourquoi il est classé ainsi), très peu sur les plans stratégiques nommés.
- Notre application reproduit déjà ce niveau (classification à 10 classes, bulle Coach en français).

### Aimchess, Chessiro
- **Aimchess** : statistiques sur l'historique d'un joueur (fourchettes manquées, conversion de finales, précision sous pression du temps) → exercices personnalisés.
- **Chessiro** : nomme après la partie les thèmes tactiques et de finale manqués ou bien gérés, avec lien vers l'entraînement.
- **Intérêt** : approche « profil du joueur » à l'échelle de plusieurs parties, complémentaire de l'explication d'une position.

### ChessBase / Fritz
- Non couverts par la recherche ; historiquement, Fritz propose des commentaires automatiques à base de règles. À vérifier si nécessaire.

---

## 3. Projets open source

### Famille B : Stockfish + LLM

| Projet | Description | Remarque utile |
|---|---|---|
| [ChessBeast](https://github.com/rlefko/chessbeast) | Annotateur de PGN : Stockfish + Maia2 (probabilité qu'un humain joue le coup) + commentaires LLM (OpenAI), en ligne de commande | Combinaison Stockfish + Maia proche de notre pile |
| [vikarag/chess-engine](https://github.com/vikarag/chess-engine) | Adversaire Stockfish bridé + Stockfish complet pour noter + LLM commentateur | Le LLM ne doit décrire que les lignes calculées |
| [ChessGpt](https://github.com/andrewnakas/ChessGpt) | Coach Stockfish 19 exposé en MCP (Claude, ChatGPT), GPL-3.0 | Explication « à votre niveau » |
| [proveo-ca/chess-coach](https://github.com/proveo-ca/chess-coach) | Maia + Stockfish + modèle Gemma affiné via Ollama, 100 % local | Montre qu'un petit modèle local suffit pour la rédaction |
| [Logic911e/chess-coach](https://github.com/Logic911e/chess-coach) | Stockfish = vérité, python-chess vérifie la légalité des coups cités et les affirmations sur la position | **Garde-fou anti-hallucination** à reprendre |
| [shashank-v-98/chess-annotator](https://github.com/shashank-v-98/chess-annotator) | Qwen2.5-1.5B affiné par distillation : un grand modèle rédige à partir de faits vérifiés, le petit apprend à l'imiter | Recette réaliste pour un modèle embarqué |
| [Iamsdt/chess](https://github.com/Iamsdt/chess) | Entraîneur navigateur, Stockfish 18 WASM + Gemini/GPT-4o, MIT | Architecture navigateur proche de la nôtre |
| [thinkfish](https://github.com/ronaldsuwandi/thinkfish) | Expérience : donner les FEN avant/après réduit les hallucinations sans les supprimer | Retour d'expérience honnête |

**Leçon commune** : le LLM seul invente. Tous les projets sérieux le cantonnent à la **rédaction** de faits calculés ailleurs.

### Famille A : détecteurs de motifs

| Projet | Description |
|---|---|
| [lichess-puzzler](https://github.com/ornicar/lichess-puzzler) / [chess-puzzler](https://pypi.org/project/chess-puzzler/) (AGPL-3.0) | Génère et étiquette les puzzles Lichess : ~60 thèmes (fourchette, clouage, déviation, attraction, mat du couloir…). Référence pour les **définitions opérationnelles** des motifs tactiques. Notre base de 149 530 puzzles porte déjà ces étiquettes. |
| [chess-detect](https://pypi.org/project/chess-detect/) | Python-chess : fourchettes, clouages, enfilades, pions doublés/isolés, annotations PGN. Règles, pas d'apprentissage. |
| [Stockfish Evaluation Guide](https://hxim.github.io/Stockfish-Evaluation-Guide/) | Décomposition interactive de l'ancienne évaluation classique (mobilité, sécurité du roi, pions passés, menaces…). **Important** : Stockfish 16 (2023) a supprimé l'évaluation classique ; le moteur actuel est 100 % NNUE, donc une « boîte noire » qui ne donne plus ses termes. Ces termes restent une excellente liste de concepts. |

### Famille C : réseau de neurones explicatif

| Projet | Description |
|---|---|
| [ChessCoach](https://github.com/chrisbutner/ChessCoach) (Chris Butner) | Moteur type AlphaZero entraîné en self-play + **décodeur de commentaires** séparé branché sur le réseau, entraîné sur des commentaires humains. Le projet open source le plus proche de l'idée « un réseau qui joue et qui explique ». Documentation technique très détaillée. |
| [dechantoine/explainable-chess-engine](https://github.com/dechantoine/explainable-chess-engine) | Moteur conçu pour être explicable (à évaluer). |
| [Maia / Maia-2](https://arxiv.org/abs/2409.20553) (NeurIPS 2024) | Pas explicatif en soi, mais prédit le coup **humain** selon l'Elo. Indispensable pour adapter l'explication au niveau (« à 1500, le piège classique est… »). Déjà intégré chez nous (Maia3 ONNX). |

---

## 4. Recherche académique

### Les réseaux apprennent des concepts humains
- **[Acquisition of Chess Knowledge in AlphaZero](https://arxiv.org/abs/2111.09259)** (McGrath et al., DeepMind, PNAS 2022) : des sondes linéaires retrouvent dans les couches d'AlphaZero des concepts humains (pion passé, mobilité, sécurité du roi, évaluation), alors qu'il n'a jamais vu de partie humaine. **Fondement théorique du projet** : on peut lire des concepts stratégiques dans un réseau.
- **[Bridging the Human-AI Knowledge Gap](https://arxiv.org/abs/2310.16410)** (Schut et al., 2023) : extraction de concepts *nouveaux* d'AlphaZero, enseignés ensuite à des grands maîtres.
- **[Evidence of Learned Look-Ahead](https://arxiv.org/abs/2406.00877)** (Jenner et al., NeurIPS 2024) : le réseau de Leela représente en interne les coups futurs de la meilleure ligne ; une sonde prédit le coup à 2 demi-coups avec 92 % de précision. Suivi : [2505.21552](https://arxiv.org/abs/2505.21552).
- **[Contrastive Sparse Autoencoders](https://arxiv.org/abs/2406.04028)** (2024) : autoencodeurs parcimonieux sur Leela pour extraire des concepts liés aux **plans**.

### Du concept au texte
- **[Concept-guided Chess Commentary (CCC)](https://arxiv.org/abs/2410.20811)** (Kim et al., NAACL 2025) — **le plus proche de l'architecture visée** :
  - vecteurs de concepts extraits de Leela (T78, couche 40) par SVM linéaire ;
  - étiquettes de concepts fournies par les termes de **Stockfish 8** (évaluation classique) sur 200 000 positions Lichess ;
  - ~21 concepts (sécurité du roi, pions passés, déséquilibre matériel…) ;
  - on compare les concepts avant/après le coup, on donne les plus modifiés au LLM ;
  - métrique d'évaluation GCC-Eval.
- **[Communicating Chess Strategies in Natural Language](https://arxiv.org/abs/2607.11486)** (2026) : arbre de stratégie partiel construit par le moteur, verbalisé par un LLM ; évalué selon la capacité d'un joueur à **suivre** la stratégie, y compris face à des réponses hors ligne principale. Conclusions : les descriptions purement conceptuelles ont leurs limites ; l'évaluation par LLM diverge du jugement humain. **Très pertinent pour « la stratégie à mettre en place pour gagner »**.
- **[Explaining Chess and Go in Natural Language / BinProp](https://arxiv.org/abs/2610.23166)** (2026) : métrique ancrée dans le moteur pour noter une explication ; montre que les LLM s'appuient sur des traits de surface plutôt que sur des concepts transférables ; propose une méthode sans entraînement pour découvrir des concepts réutilisables.
- **[QUEEN – Language Models that Play Chess and Explain Their Moves](https://arxiv.org/abs/2610.03695)** (2026) : encodeur d'échecs « muet » + décodeur LLM pré-entraîné → meilleur coup, variante principale prévue et texte explicatif.
- **[Automated Chess Commentator Powered by Neural Chess Engine](https://arxiv.org/abs/1909.10413)** (2019) : premier couplage moteur neuronal / génération de commentaires.

### Jeux de données
- **[Gameknot commentary](https://aclanthology.org/P18-1154)** (Jhamtani et al., ACL 2018) : ~298 000 paires coup/commentaire sur ~11 000 parties, classées en 6 types (description, qualité, comparaison, **justification**, contexte, général). Bruité mais unique. Code : [Rseiji/ChessCommentaryGeneration](https://github.com/Rseiji/ChessCommentaryGeneration).
- **[ChessGPT](https://arxiv.org/abs/2306.09200)** (2023) : grand corpus parties + textes d'échecs (analyses, discussions).
- **Base de puzzles Lichess** (CC0) : millions de positions étiquetées par thème tactique → supervision gratuite pour la reconnaissance de motifs tactiques.
- **Manque identifié** : aucun jeu de données public de **structures de pions / plans stratégiques** étiquetés (Carlsbad, Maroczy, pion isolé dame, Hérisson, chaînes de pions…). À construire soi-même (règles sur les structures + parties de maîtres).
- Survey : [AI-Generated Game Commentary](https://arxiv.org/abs/2506.17294) (2025).

---

## 5. Ce que ça implique pour le projet

### Positionnement
Le projet se place en **famille C ancrée par Stockfish** : un réseau reconnaît les concepts, Stockfish vérifie et chiffre, une couche de génération contrainte rédige. C'est la direction de CCC et de QUEEN, mais avec deux différences qui peuvent faire la valeur du projet :
1. **Plans, pas seulement coups** : la plupart des systèmes expliquent *pourquoi ce coup*. Peu expliquent *quel plan suivre* (cf. 2607.11486, seule référence sérieuse).
2. **Vérification systématique** : chaque concept affirmé doit être confirmé par Stockfish (ex. « la colonne c est l'atout » → l'évaluation chute si on la cède) — c'est ce qui manque à DecodeChess et aux projets LLM.

### Architecture qui ressort de l'audit (proposition à discuter)
1. **Détecteurs à règles** (tactique + structures) → étiquettes fiables et données d'entraînement. On a déjà une base (`explain.js`, thèmes des puzzles Lichess).
2. **Réseau de concepts** : têtes multi-étiquettes sur un encodeur d'échecs (partir d'un réseau Leela/Maia pré-entraîné plutôt que de zéro), supervisées par (1), par les thèmes des puzzles et par des termes d'évaluation classique (Stockfish 15 a encore l'évaluation classique, comme CCC avec Stockfish 8).
3. **Stockfish 19** : évaluation, lignes, et tests contrefactuels pour valider chaque concept (« que vaut la position si ce plan est empêché ? »).
4. **Maia** : adapter le plan au niveau du joueur.
5. **Rédaction** : gabarits en français d'abord (fiables, hors ligne), LLM optionnel ensuite, toujours nourri de faits vérifiés + garde-fou de légalité (comme Logic911e/chess-coach).

### Risques identifiés
- **Données stratégiques** : il faudra les fabriquer (le plus gros chantier).
- **Évaluation** : mesurer qu'une explication est « bonne » est un problème ouvert ; prévoir tôt un petit banc de positions annotées à la main.
- **Licences** : Stockfish GPL-3, lichess-puzzler AGPL-3, réseaux Leela GPL-3 ; données Lichess CC0. Compatible avec un projet GPL.
- **Navigateur** : l'appli actuelle tourne sans serveur ; un réseau de concepts doit rester assez petit pour ONNX/WASM (comme Maia3), sinon prévoir un mode « Boost PC ».

---

## Sources
- DecodeChess : https://decodechess.com/?p=2626 · test critique : https://www.chess.com/blog/sbernst8/state-of-chess-ai-for-move-interpretation
- Chess.com Game Review : https://support.chess.com/en/articles/8584089 · https://www.chess.com/announcements/view/update-game-reviews-coach-now-with-more-in-depth-line-explanation
- Aimchess : https://www.chess.com/blog/SheldonOfOsaka/aimchess-a-review · Chessiro : https://chessiro.com/blog/inside-chessiro-game-review
- Stockfish 16.1 (fin de l'évaluation classique) : https://stockfishchess.org/blog/2024/stockfish-16-1/
- ChessCoach : https://chrisbutner.github.io/ChessCoach/technical-explanation.html
- Maia-2 : https://arxiv.org/abs/2409.20553
- Lichess, thèmes de puzzles : https://lichess.org/training/themes
- Discussion sur un jeu de données de structures de pions : https://lichess.org/forum/game-analysis/list-of-pawn-structures-for-deep-learning
- Articles et dépôts : voir les liens dans chaque section.
