// Noms d'ouvertures en français. Le livre (openings.json) et l'index d'analyse restent en anglais :
// c'est la clé de regroupement (familyOf, filtres…). Cette traduction ne sert qu'à l'AFFICHAGE.
// « Sicilian Defense: Najdorf Variation, English Attack » → « Défense sicilienne : variante Najdorf, attaque anglaise ».

// Familles (nom avant « : » ou « , »). Les noms propres non listés sont gérés par les règles génériques.
const FAMILY = {
  'Sicilian Defense': 'Défense sicilienne', 'Ruy Lopez': 'Partie espagnole (Ruy Lopez)',
  'French Defense': 'Défense française', "Queen's Gambit Declined": 'Gambit dame refusé',
  'Italian Game': 'Partie italienne', 'English Opening': 'Ouverture anglaise',
  "King's Gambit Accepted": 'Gambit roi accepté', "King's Gambit Declined": 'Gambit roi refusé', "King's Gambit": 'Gambit roi',
  "King's Indian Defense": 'Défense est-indienne', "King's Indian Attack": 'Attaque est-indienne',
  'Caro-Kann Defense': 'Défense Caro-Kann', 'Nimzo-Indian Defense': 'Défense nimzo-indienne',
  "Queen's Pawn Game": 'Partie du pion dame', "Queen's Pawn": 'Partie du pion dame',
  "Queen's Indian Defense": 'Défense ouest-indienne', 'Pseudo Queen\'s Indian Defense': 'Pseudo-défense ouest-indienne',
  "Queen's Indian Accelerated": 'Ouest-indienne accélérée',
  'Semi-Slav Defense': 'Défense semi-slave', 'Semi-Slav Defense Accepted': 'Défense semi-slave acceptée',
  'Dutch Defense': 'Défense hollandaise', 'Benoni Defense': 'Défense Benoni',
  "Queen's Gambit Accepted": 'Gambit dame accepté', "Queen's Gambit": 'Gambit dame',
  'Grünfeld Defense': 'Défense Grünfeld', 'Neo-Grünfeld Defense': 'Défense néo-Grünfeld',
  'Alekhine Defense': 'Défense Alekhine', 'Indian Defense': 'Défense indienne', 'Old Indian Defense': 'Défense vieille-indienne',
  'East Indian Defense': 'Défense est-indienne', 'Scotch Game': 'Partie écossaise', 'Slav Defense': 'Défense slave',
  "Petrov's Defense": 'Défense russe (Petrov)', 'Four Knights Game': 'Partie des quatre cavaliers',
  'Three Knights Opening': 'Ouverture des trois cavaliers', 'Scandinavian Defense': 'Défense scandinave',
  'Philidor Defense': 'Défense Philidor', 'Modern Defense': 'Défense moderne', "King's Pawn Game": 'Partie du pion roi',
  "King's Pawn Opening": 'Ouverture du pion roi', "King's Knight Opening": 'Ouverture du cavalier roi',
  "Bishop's Opening": 'Ouverture du fou', 'Vienna Game': 'Partie viennoise', 'Vienna Gambit': 'Gambit viennois',
  'Catalan Opening': 'Ouverture catalane', 'Polish Opening': 'Ouverture polonaise', 'Polish Defense': 'Défense polonaise',
  'Hungarian Opening': 'Ouverture hongroise', 'Center Game': 'Partie du centre', 'Center Game Accepted': 'Partie du centre acceptée',
  'Latvian Gambit': 'Gambit letton', 'Latvian Gambit Accepted': 'Gambit letton accepté',
  'Blackmar-Diemer Gambit': 'Gambit Blackmar-Diemer', 'Blackmar-Diemer Gambit Accepted': 'Gambit Blackmar-Diemer accepté',
  'Blackmar-Diemer Gambit Declined': 'Gambit Blackmar-Diemer refusé', 'Bogo-Indian Defense': 'Défense bogo-indienne',
  'Benko Gambit': 'Gambit Benko', 'Benko Gambit Accepted': 'Gambit Benko accepté', 'Benko Gambit Declined': 'Gambit Benko refusé',
  'Englund Gambit': 'Gambit Englund', 'Englund Gambit Declined': 'Gambit Englund refusé',
  'Danish Gambit': 'Gambit danois', 'Danish Gambit Accepted': 'Gambit danois accepté', 'Danish Gambit Declined': 'Gambit danois refusé',
  'London System': 'Système de Londres', 'Colle System': 'Système Colle', 'Torre Attack': 'Attaque Torre',
  'Trompowsky Attack': 'Attaque Trompowsky', 'Richter-Veresov Attack': 'Attaque Richter-Veresov',
  'Nimzo-Larsen Attack': 'Attaque Nimzo-Larsen', 'English Defense': 'Défense anglaise', 'Rat Defense': 'Défense du rat',
  'Lion Defense': 'Défense du lion', 'Pterodactyl Defense': 'Défense Ptérodactyle', 'Elephant Gambit': "Gambit de l'éléphant",
  'St. George Defense': 'Défense Saint-Georges', 'Blumenfeld Countergambit': 'Contre-gambit Blumenfeld',
  'Blumenfeld Countergambit Accepted': 'Contre-gambit Blumenfeld accepté', 'Portuguese Opening': 'Ouverture portugaise',
  'Czech Defense': 'Défense tchèque', 'Australian Defense': 'Défense australienne', 'Mexican Defense': 'Défense mexicaine',
  'Hippopotamus Defense': "Défense de l'hippopotame", 'Bongcloud Attack': 'Attaque Bongcloud', 'Irish Gambit': 'Gambit irlandais',
  'Formation': 'Formation', 'Creepy Crawly Formation': 'Formation Creepy Crawly', 'Zukertort Defense': 'Défense Zukertort',
  'Kangaroo Defense': 'Défense du kangourou', 'Vulture Defense': 'Défense du vautour', 'Lemming Defense': 'Défense du lemming',
  'Fried Fox Defense': 'Défense du renard frit', 'Marienbad System': 'Système Marienbad', 'Slav Indian': 'Slave-indienne',
  'Amazon Attack': 'Attaque amazone', 'Dresden Opening': 'Ouverture de Dresde', 'Basque Opening': 'Ouverture basque',
  'Montevideo Defense': 'Défense Montevideo', 'Anderssen\'s Opening': 'Ouverture Anderssen', 'English Orangutan': 'Orang-outan anglais',
};

// Noms communs (genre = f/m) : « X Variation » → « Variante X ».
const NOUN = {
  Variation: ['Variante', 'f'], Line: ['Ligne', 'f'], Defense: ['Défense', 'f'], Attack: ['Attaque', 'f'], Gambit: ['Gambit', 'm'],
  Countergambit: ['Contre-gambit', 'm'], System: ['Système', 'm'], Opening: ['Ouverture', 'f'], Game: ['Partie', 'f'],
  Formation: ['Formation', 'f'], Trap: ['Piège', 'm'], Bind: ['Étau', 'm'], Counterattack: ['Contre-attaque', 'f'],
  Structure: ['Structure', 'f'], Setup: ['Système', 'm'],
};

// Adjectifs et mots courants : [féminin, masculin] (une seule forme si identique).
const ADJ = {
  Classical: ['classique'], Modern: ['moderne'], Closed: ['fermée', 'fermé'], Open: ['ouverte', 'ouvert'], Normal: ['normale', 'normal'],
  Orthodox: ['orthodoxe'], Symmetrical: ['symétrique'], Accepted: ['acceptée', 'accepté'], Declined: ['refusée', 'refusé'],
  Accelerated: ['accélérée', 'accéléré'], Reversed: ['inversée', 'inversé'], Deferred: ['différée', 'différé'],
  Delayed: ['retardée', 'retardé'], Quiet: ['tranquille'], Traditional: ['traditionnelle', 'traditionnel'],
  Positional: ['positionnelle', 'positionnel'], Central: ['centrale', 'central'], Old: ['ancienne', 'ancien'],
  Main: ['principale', 'principal'], Double: ['double'], Advance: ["d'avance"], Exchange: ["d'échange"],
  Fianchetto: ['fianchetto'], English: ['anglaise', 'anglais'], Spanish: ['espagnole', 'espagnol'], Russian: ['russe'],
  Austrian: ['autrichienne', 'autrichien'], Scotch: ['écossaise', 'écossais'], Indian: ['indienne', 'indien'],
  Sicilian: ['sicilienne', 'sicilien'], Italian: ['italienne', 'italien'], Dutch: ['hollandaise', 'hollandais'],
  French: ['française', 'français'], Czech: ['tchèque'], Hungarian: ['hongroise', 'hongrois'], Polish: ['polonaise', 'polonais'],
  Slav: ['slave'], 'Anglo-Slav': ['anglo-slave', 'anglo-slave'], 'Anglo-Indian': ['anglo-indienne', 'anglo-indien'],
  Vienna: ['viennoise', 'viennois'], London: ['de Londres'], Center: ['du centre'], Wing: ["de l'aile"], Retreat: ['de retraite'],
  Poisoned: ['empoisonné'], Pianissimo: ['pianissimo'], Pawn: ['pion'], Pawns: ['pions'], Knight: ['cavalier'], Knights: ['cavaliers'],
  Bishop: ['fou'], Queen: ['dame'], King: ['roi'], Rook: ['tour'], Two: ['deux'], Three: ['trois'], Four: ['quatre'],
  with: ['avec'], and: ['et'], without: ['sans'], the: ['le'], of: ['de'],
  Standard: ['standard'], Improved: ['améliorée', 'amélioré'], Fast: ['rapide'], Slow: ['lente', 'lent'],
  Anti: ['anti'], Reti: ['Réti'], Giuoco: ['Giuoco'],
  "Bishop's": ['du fou'], Scandinavian: ['scandinave'], Yugoslav: ['yougoslave'], Pterodactyl: ['Ptérodactyle'],
  Eastern: ['orientale', 'oriental'], Western: ['occidentale', 'occidental'], Rare: ['rares'], Defenses: ['défenses'],
  Neo: ['néo'], Semi: ['semi'], Invitation: ['invitation'], Simple: ['simple'], Hybrid: ['hybride'], Unusual: ['inhabituelle', 'inhabituel'],
  Gambits: ['gambits'], Variations: ['variantes'], Lines: ['lignes'],
};

// Expressions à remplacer avant le mot à mot.
const PHRASES = [
  ["King's Indian", 'est-indienne'], ["Queen's Indian", 'ouest-indienne'],
  ["King's Knight", 'du cavalier roi'], ["Queen's Knight", 'du cavalier dame'],
  ["King's Bishop", 'du fou roi'], ["Queen's Bishop", 'du fou dame'],
  ["King's Pawn", 'du pion roi'], ["Queen's Pawn", 'du pion dame'],
  ["King's Gambit", 'du gambit roi'], ["Queen's Gambit", 'du gambit dame'],
  ["King's", 'du roi'], ["Queen's", 'de la dame'],
  ['Two Knights', 'des deux cavaliers'], ['Three Knights', 'des trois cavaliers'], ['Four Knights', 'des quatre cavaliers'],
  ['Poisoned Pawn', 'du pion empoisonné'], ['Main Line', 'principale'],
  ['Fianchetto', 'fianchetto'], ['Accepted', 'accepté'], ['Declined', 'refusé'],
].sort((a, b) => b[0].length - a[0].length);

const wordsOf = (s) => s.split(/\s+/).filter(Boolean);

// Un segment (« Najdorf Variation », « Classical Defense », « with 5.Bd3 »…).
function segment(seg) {
  let s = seg.trim();
  if (!s) return s;
  if (s === 'Exchange') return 'Échange';
  if (s === 'Advance') return 'Avance';
  // « Smith-Morra Gambit Accepted » → « Gambit Smith-Morra accepté »
  const st = s.match(/^(.*\S)\s+(Accepted|Declined)$/);
  if (st && NOUN[wordsOf(st[1]).slice(-1)[0]]) {
    const n = NOUN[wordsOf(st[1]).slice(-1)[0]];
    return `${segment(st[1])} ${ADJ[st[2]][n[1] === 'f' ? 0 : 1]}`;
  }
  const nounW = wordsOf(s).slice(-1)[0];
  const noun = NOUN[nounW];
  let rest = noun ? wordsOf(s).slice(0, -1).join(' ') : s;
  const fem = noun ? noun[1] === 'f' : false;
  for (const [en, fr] of PHRASES) rest = rest.replace(new RegExp(`(^|\\s)${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'g'), `$1${fr}`);
  const out = wordsOf(rest).map((w) => {
    const a = ADJ[w];
    return a ? (fem ? a[0] : a[1] || a[0]) : w;
  });
  if (noun) {
    // « Variation » seule → « Variante » ; « Classical Variation » → « Variante classique »
    return [noun[0], ...out].join(' ');
  }
  // sans nom final : « with 5.Bd3 » → « avec 5.Bd3 », « Main Line » déjà traité plus haut
  return out.join(' ');
}

// Nom de famille : table, puis règles génériques « X Opening/Defense/Gambit/Attack/System/Game ».
function family(f) {
  if (FAMILY[f]) return FAMILY[f];
  const m = f.match(/^(.*?)\s+(Opening|Defense|Gambit|Attack|System|Game|Countergambit|Formation)(?:\s+(Accepted|Declined))?$/);
  if (m) {
    const [, who, kind, st] = m;
    const [n, g] = NOUN[kind];
    const head = kind === 'Gambit' || kind === 'Countergambit' ? `${n} ${who}` : `${n} ${who}`;
    return head + (st ? ` ${g === 'f' ? ADJ[st][0] : ADJ[st][1]}` : '');
  }
  return segment(f);
}

const cache = new Map();
// « Sicilian Defense: Najdorf Variation, English Attack » → français. Chaîne vide / absente → inchangée.
export function frOpening(name) {
  if (!name) return name;
  if (cache.has(name)) return cache.get(name);
  const i = name.indexOf(':');
  const fam = i < 0 ? name : name.slice(0, i);
  // « Famille, sous-famille » sans « : » (rare) : on ne traduit que la première partie par table
  const parts = i < 0 ? [] : name.slice(i + 1).split(',').map(segment).filter(Boolean);
  let head = family(fam.trim());
  if (i < 0 && fam.includes(',')) {
    const [a, ...b] = fam.split(',');
    head = family(a.trim());
    parts.push(...b.map(segment).filter(Boolean));
  }
  let out = head;
  if (parts.length) {
    const [first, ...others] = parts;
    out += ` : ${first.charAt(0).toUpperCase() + first.slice(1)}`;
    if (others.length) out += `, ${others.join(', ')}`;
  }
  cache.set(name, out);
  return out;
}
