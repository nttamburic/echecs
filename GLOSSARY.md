# Chess Journey

Application d'entraînement aux échecs à partir des parties de l'utilisateur. Manu AI y nomme les motifs des erreurs pour les trier et les commenter.

## Analyse d'une partie

**Classe** :
Jugement porté sur un coup d'après la perte de probabilité de gain : brillant, très bon, meilleur, excellent, bon, théorie, inexactitude, erreur, gaffe, occasion manquée.
_Avoid_ : catégorie, note

**Erreur** :
Coup de classe inexactitude, erreur, gaffe ou occasion manquée.
_Avoid_ : faute

**Coup de théorie** :
Coup qui mène à une position du livre d'ouvertures. Il garde la classe théorie, même s'il perd.
_Avoid_ : coup de livre

**Suite** :
Série de coups jouée depuis une position. La meilleure suite est celle du moteur. La suite jouée commence par le coup de l'utilisateur.
_Avoid_ : variante (réservé aux lignes multiples du moteur), ligne

**Demi-coup** :
Coup d'un seul camp. Trois coups font six demi-coups.
_Avoid_ : ply

## Motifs

**Motif** :
Idée nommée qui apparaît dans une suite : fourchette, clouage, mat, etc. Il a un camp, un acteur et des cibles.
_Avoid_ : thème, pattern

**Motif tactique** :
Motif qui gagne du matériel ou mate en peu de coups, et qui se vérifie sur l'échiquier.
_Avoid_ : combinaison (réservé au motif « Combinaison décisive »)

**Camp** :
Couleur qui exécute le motif, celle qui en profite.
_Avoid_ : joueur, côté

**Acteur** :
Pièce qui exécute le motif, désignée par sa case.

**Cible** :
Pièce ou case visée par le motif. Un motif peut avoir plusieurs cibles.

## Nature d'une erreur

**Nature** :
Tactique ou stratégique. Toute erreur a une nature.
_Avoid_ : type, kind

**Erreur tactique** :
Erreur où un motif tactique apparaît dans les six premiers demi-coups de la meilleure suite ou de la suite jouée.

**Erreur stratégique** :
Erreur qui n'est pas tactique.
_Avoid_ : erreur positionnelle

**Moment** :
Position d'une partie juste avant une erreur de l'utilisateur, avec le coup joué et la meilleure suite.
_Avoid_ : moment clé (sauf dans l'interface)
