# Échecs : analyse et entraînement

Application web personnelle (PWA) : analyse des parties chess.com avec Stockfish 19, entraînement aux ouvertures, au milieu de jeu et aux finales.

- Aucune donnée personnelle dans ce dépôt : les analyses sont stockées dans le navigateur et synchronisées dans un dépôt privé séparé.
- Moteur : Stockfish 19 « lite » en WebAssembly ([stockfish.js](https://github.com/nmrugg/stockfish.js), GPL v3, voir `vendor/stockfish/Copying.txt`).
- Règles : [chess.js](https://github.com/jhlywa/chess.js) (BSD-2). Pièces : cburnett (CC BY-SA 3.0). Ouvertures : [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0).
- Analyse cloud et tables de finales : API publiques de Lichess.
