# Prompt : moteur stratégique par motifs

*À donner tel quel à un assistant de développement (Claude Code ou autre) pour démarrer le projet. Contexte : voir `docs/AUDIT-MOTEURS-EXPLICATIFS.md`.*

---

```text
Tu es un développeur expert en programmation d'échecs et en apprentissage automatique. Tu travailles sur « Chess Journey », une application web PWA en français, sans serveur, en JavaScript natif (modules ES). Elle utilise déjà Stockfish 19 en WebAssembly, chess.js, Maia3 en ONNX dans un Worker et la base de puzzles Lichess étiquetés par thème. Elle a aussi un module de commentaires à base de règles (explain.js).

## Objectif

Construire un « moteur stratégique par motifs ». Pour une position donnée, il doit :
1. reconnaître les motifs stratégiques et tactiques présents ;
2. déterminer lesquels comptent vraiment et lequel domine ;
3. en déduire un plan pour gagner (ou tenir) ;
4. faire valider ce plan par Stockfish ;
5. l'expliquer en français au joueur, à son niveau.

Ce moteur ne joue pas à la place de Stockfish. Il propose et explique un plan, Stockfish calcule et vérifie.

## Principes non négociables

- La tactique passe en premier. Si Stockfish trouve une tactique forcée (écart d'évaluation ≥ 1,5 pion entre le meilleur coup et le deuxième, ou un thème de puzzle détecté), on l'affiche avant tout plan stratégique.
- Les règles détectent, le réseau juge, Stockfish valide. Un motif simple (pion passé, colonne ouverte) se détecte par du code, pas par un réseau. Le réseau sert à juger : ce motif compte-t-il ? Lequel domine ? Quel plan suivre ?
- Aucune affirmation n'est montrée sans vérification. Chaque motif cité existe sur l'échiquier (vérifié par code), chaque coup cité est légal, chaque plan affiché a passé la validation Stockfish. Si un plan est réfuté, on montre la réfutation.
- Un plan est un objectif, pas une suite de coups. Il décrit des buts (cases cibles, poussées de pions, échanges souhaités) et des conditions de réussite. Les coups concrets viennent de Stockfish, filtrés par le plan.

## Architecture en 4 couches

1. Détecteurs (règles, JS pur, sans dépendance au réseau)
   Entrée : FEN. Sortie : liste de motifs { id, camp, cases concernées, attributs }.
   Exemples d'attributs : pion passé → rang, protégé ou non, bloqué ou non, distance du roi adverse.

2. Juge (réseau de neurones, version 2 seulement)
   Entrée : la position et les motifs détectés. Sortie : un score d'importance par motif et une probabilité par plan.
   En version 1, ce rôle est tenu par des heuristiques pondérées.

3. Validateur (Stockfish 19)
   a. Compatibilité : les 1 ou 2 premiers coups conformes au plan sont à moins de 0,3 pion du meilleur coup (MultiPV).
   b. Recherche contrainte : on joue 6 à 10 demi-coups où notre camp ne choisit que des coups conformes au plan (le meilleur selon Stockfish parmi eux) et l'adversaire répond librement. Le plan est validé si l'évaluation finale reste à moins de 0,5 pion de la ligne principale libre. Sinon, on garde la réfutation.
   c. Seuils configurables, résultats mis en cache par FEN.

4. Rédaction
   Gabarits en français alimentés uniquement par des faits vérifiés : motifs, plan, ligne de démonstration, réfutation éventuelle.
   Option ultérieure : un LLM reformule, avec un garde-fou qui vérifie la légalité et l'existence de chaque coup et de chaque pièce citée.
   Le niveau du joueur (Elo) adapte le vocabulaire et, en version 3, le choix du plan via Maia (« plan plus simple à exécuter à votre niveau »).

## Catalogue de la version 1

Motifs (environ 15) :
pion passé, pion isolé, pions doublés, pion arriéré, majorité de pions sur une aile, chaîne de pions et sa base, colonne ouverte, colonne semi-ouverte, case forte ou avant-poste, paire de fous, fou bon ou mauvais, faiblesse de cases d'une couleur, roi exposé ou bouclier de pions affaibli, contrôle de la 7e rangée, déséquilibre matériel (qualité, pièces contre pions).

Plans (environ 10), chacun avec ses motifs déclencheurs, ses objectifs et ses conditions de réussite :
- Pousser le pion passé (tour derrière le pion, règle de Tarrasch ; échanger les bloqueurs).
- Occuper la colonne ouverte (doubler les tours, pénétrer en 7e rangée).
- Attaque de minorité (contre une majorité ou une structure de type Carlsbad).
- Exploiter une majorité (créer un pion passé).
- Bloquer puis attaquer le pion isolé.
- Installer une pièce sur l'avant-poste (cavalier de préférence).
- Ouvrir le jeu pour la paire de fous.
- Attaquer le roi exposé (amener des pièces, ouvrir des lignes).
- Simplifier vers une finale gagnante (avantage matériel ou structurel).
- Jouer sur les cases faibles d'une couleur.

Exemple attendu : pion passé + colonne ouverte → plan combiné « tours sur la colonne, puis derrière le pion, puis poussée soutenue ». Stockfish vérifie, puis l'explication montre les étapes et la ligne de démonstration.

## Données pour la version 2 : étiquetage après coup

Dans les parties de maîtres (base Lichess, CC0), pour chaque position on regarde les 10 à 20 coups suivants pour savoir quel objectif de plan a réellement été atteint (tours doublées, pion poussé de 2 rangs, avant-poste occupé…) et ce que ça a donné (évolution de l'évaluation, résultat). Cela produit automatiquement des triplets (position + motifs, plan suivi, réussite).

Le réseau, petit encodeur exportable en ONNX et utilisable dans le navigateur comme Maia3, apprend à prédire l'importance des motifs et le plan gagnant. On peut repartir d'un encodeur pré-entraîné de type Maia ou Leela, en respectant leurs licences (GPL-3).

Le réseau doit battre les heuristiques de la version 1 sur un banc de test, sinon on ne l'adopte pas.

## Feuille de route

V1 : détecteurs, heuristiques de priorité, catalogue de plans, validateur Stockfish, gabarits français, intégration dans la vue d'une partie et dans l'analyse libre.
V2 : pipeline d'étiquetage après coup, entraînement du réseau juge, comparaison avec la V1.
V3 : adaptation au niveau du joueur via Maia, bilan des plans réussis ou manqués sur l'ensemble des parties du joueur.

## Évaluation

- Banc de 100 à 200 positions annotées à la main (motif dominant, plan attendu), avec mesure de la précision.
- Tests unitaires de chaque détecteur sur des FEN de référence, cas limites compris.
- Taux de plans validés par Stockfish, et taux d'affirmations fausses (objectif : 0).

## Contraintes

Tout en français. Fonctionne hors ligne dans le navigateur (Stockfish dans un Worker, calculs non bloquants). Pas de nouveau framework. Licences compatibles GPL-3. Code modulaire : core/patterns/ (détecteurs), core/plans/ (catalogue et validateur), modules/ pour l'interface.

## Première tâche

1. Propose la spécification détaillée des 15 motifs (définition opérationnelle, attributs, 3 FEN de test chacun) et des 10 plans (déclencheurs, objectifs, prédicat de conformité d'un coup, critères de validation).
2. Attends ma validation.
3. Implémente ensuite les détecteurs et leurs tests, puis le validateur Stockfish, puis les gabarits.
```
