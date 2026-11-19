// Libellés français et familles des thèmes de puzzles Lichess.
// Un thème absent de cette table (nouveau thème Lichess) reste utilisable : il apparaît sous son nom
// brut dans la famille « Autres ».

export const THEME_FAMILIES = [
  { id: 'tactics', label: 'Tactiques' },
  { id: 'mates', label: 'Mats' },
  { id: 'endgames', label: 'Finales' },
  { id: 'other', label: 'Phase, longueur, source' },
];

const T = (family, label) => ({ family, label });

export const THEMES = {
  // tactiques
  fork: T('tactics', 'Fourchette'),
  pin: T('tactics', 'Clouage'),
  skewer: T('tactics', 'Enfilade'),
  discoveredAttack: T('tactics', 'Attaque à la découverte'),
  discoveredCheck: T('tactics', 'Échec à la découverte'),
  doubleCheck: T('tactics', 'Double échec'),
  deflection: T('tactics', 'Déviation'),
  attraction: T('tactics', 'Attraction'),
  clearance: T('tactics', 'Dégagement'),
  interference: T('tactics', 'Interférence'),
  intermezzo: T('tactics', 'Coup intermédiaire'),
  xRayAttack: T('tactics', 'Rayons X'),
  hangingPiece: T('tactics', 'Pièce en prise'),
  trappedPiece: T('tactics', 'Pièce piégée'),
  capturingDefender: T('tactics', 'Capture du défenseur'),
  sacrifice: T('tactics', 'Sacrifice'),
  quietMove: T('tactics', 'Coup tranquille'),
  zugzwang: T('tactics', 'Zugzwang'),
  defensiveMove: T('tactics', 'Coup défensif'),
  collinearMove: T('tactics', 'Coup sur la même ligne'),
  attackingF2F7: T('tactics', 'Attaque sur f2 / f7'),
  exposedKing: T('tactics', 'Roi exposé'),
  kingsideAttack: T('tactics', 'Attaque côté roi'),
  queensideAttack: T('tactics', 'Attaque côté dame'),
  advancedPawn: T('tactics', 'Pion avancé'),
  promotion: T('tactics', 'Promotion'),
  underPromotion: T('tactics', 'Sous-promotion'),
  enPassant: T('tactics', 'Prise en passant'),
  castling: T('tactics', 'Roque'),
  // mats
  mate: T('mates', 'Mat'),
  mateIn1: T('mates', 'Mat en 1'),
  mateIn2: T('mates', 'Mat en 2'),
  mateIn3: T('mates', 'Mat en 3'),
  mateIn4: T('mates', 'Mat en 4'),
  mateIn5: T('mates', 'Mat en 5 ou plus'),
  backRankMate: T('mates', 'Mat du couloir'),
  smotheredMate: T('mates', 'Mat à l’étouffée'),
  anastasiaMate: T('mates', 'Mat d’Anastasie'),
  arabianMate: T('mates', 'Mat arabe'),
  bodenMate: T('mates', 'Mat de Boden'),
  doubleBishopMate: T('mates', 'Mat des deux fous'),
  dovetailMate: T('mates', 'Mat en queue d’aronde'),
  swallowstailMate: T('mates', 'Mat de la queue d’hirondelle'),
  cornerMate: T('mates', 'Mat du coin'),
  hookMate: T('mates', 'Mat du crochet'),
  killBoxMate: T('mates', 'Mat de la boîte'),
  morphysMate: T('mates', 'Mat de Morphy'),
  operaMate: T('mates', 'Mat de l’Opéra'),
  pillsburysMate: T('mates', 'Mat de Pillsbury'),
  triangleMate: T('mates', 'Mat du triangle'),
  vukovicMate: T('mates', 'Mat de Vuković'),
  balestraMate: T('mates', 'Mat de Balestra'),
  blindSwineMate: T('mates', 'Mat des deux tours'),
  epauletteMate: T('mates', 'Mat des épaulettes'),
  // finales
  endgame: T('endgames', 'Finale'),
  pawnEndgame: T('endgames', 'Finale de pions'),
  rookEndgame: T('endgames', 'Finale de tours'),
  bishopEndgame: T('endgames', 'Finale de fous'),
  knightEndgame: T('endgames', 'Finale de cavaliers'),
  queenEndgame: T('endgames', 'Finale de dames'),
  queenRookEndgame: T('endgames', 'Finale dame et tour'),
  // autres
  opening: T('other', 'Ouverture'),
  middlegame: T('other', 'Milieu de partie'),
  advantage: T('other', 'Prendre l’avantage'),
  equality: T('other', 'Égaliser'),
  crushing: T('other', 'Gain écrasant'),
  oneMove: T('other', 'Un seul coup'),
  short: T('other', 'Court'),
  long: T('other', 'Long'),
  veryLong: T('other', 'Très long'),
  master: T('other', 'Parties de maîtres'),
  masterVsMaster: T('other', 'Maître contre maître'),
  superGM: T('other', 'Parties de super-GM'),
};

export const themeLabel = (name) => (THEMES[name] ? THEMES[name].label : name);

// Thèmes disponibles (noms du manifeste), groupés par famille et triés par libellé.
export function groupThemes(names) {
  const out = THEME_FAMILIES.map((f) => ({ ...f, themes: [] }));
  for (const n of names) {
    const fam = THEMES[n] ? THEMES[n].family : 'other';
    out.find((g) => g.id === fam).themes.push({ name: n, label: themeLabel(n) });
  }
  for (const g of out) g.themes.sort((a, b) => a.label.localeCompare(b.label, 'fr', { numeric: true }));
  return out.filter((g) => g.themes.length);
}
