// Définitions des thèmes d'après lichess-puzzler, tagger/cook.py (AGPL-3.0), réécrites
import { Chess } from '../../../vendor/chess.js';
import { adverse, colonne, distance, rang } from './commun.js';
import { VAL, attackersOf, boardMap, kingOf, pinLine, rawAttacks, sq } from './geometry.js';

export const libellesThemes = Object.freeze({
  mate: 'Mat',
  mateIn1: 'Mat en 1',
  mateIn2: 'Mat en 2',
  mateIn3: 'Mat en 3',
  mateIn4: 'Mat en 4',
  mateIn5: 'Mat en 5 ou plus',
  backRankMate: 'Mat du couloir',
  smotheredMate: 'Mat à l’étouffée',
  fork: 'Fourchette',
  pin: 'Clouage',
  skewer: 'Enfilade',
  discoveredAttack: 'Attaque à la découverte',
  doubleCheck: 'Double échec',
  hangingPiece: 'Pièce en prise',
  trappedPiece: 'Pièce piégée',
  sacrifice: 'Sacrifice',
  deflection: 'Déviation',
  attraction: 'Attraction',
  capturingDefender: 'Capture du défenseur',
  xRayAttack: 'Rayons X',
  intermezzo: 'Coup intermédiaire',
  interference: 'Interférence',
  clearance: 'Dégagement',
  quietMove: 'Coup tranquille',
  defensiveMove: 'Coup défensif',
  promotion: 'Promotion',
  underPromotion: 'Sous-promotion',
  advancedPawn: 'Pion avancé',
  exposedKing: 'Roi exposé',
  attackingF2F7: 'Attaque sur f2 / f7',
  kingsideAttack: 'Attaque côté roi',
  queensideAttack: 'Attaque côté dame',
});

// Seuls les thèmes qui passent 85 % de précision et 70 % de rappel en réglage sont autorisés en rédaction.
const fiablesReglage = new Set([
  'mate', 'mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5', 'backRankMate', 'smotheredMate',
  'fork', 'pin', 'skewer', 'discoveredAttack', 'doubleCheck', 'hangingPiece', 'trappedPiece', 'sacrifice',
  'deflection', 'attraction', 'capturingDefender', 'xRayAttack', 'intermezzo', 'interference', 'clearance',
  'quietMove', 'defensiveMove', 'promotion', 'underPromotion', 'advancedPawn', 'exposedKing', 'attackingF2F7',
  'kingsideAttack', 'queensideAttack',
]);
export const catalogueThemes = Object.freeze(Object.fromEntries(Object.entries(libellesThemes).map(([theme, libelle]) =>
  [theme, Object.freeze({ libelle, fiable: fiablesReglage.has(theme) })])));
export const themeFiable = theme => Object.hasOwn(catalogueThemes, theme) && catalogueThemes[theme].fiable;

const rayons = new Set(['b', 'r', 'q']);
const valeur = type => VAL[type] ?? 0;
const estUci = uci => typeof uci === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci);

function entre(a, b) {
  const df = colonne(b) - colonne(a);
  const dr = Number(b[1]) - Number(a[1]);
  if (df && dr && Math.abs(df) !== Math.abs(dr)) return [];
  const pasF = Math.sign(df);
  const pasR = Math.sign(dr);
  return Array.from({ length: Math.max(0, Math.abs(df), Math.abs(dr)) - Number(a !== b) }, (_, i) =>
    sq(colonne(a) + pasF * (i + 1), Number(a[1]) - 1 + pasR * (i + 1)));
}

function etat(chess) {
  const map = boardMap(chess);
  const fen = chess.fen();
  const echec = chess.isCheck();
  const trait = chess.turn();
  const roi = kingOf(map, trait);
  const cache = new Map();
  return {
    map, fen, echec, trait, roi, mat: echec && chess.isCheckmate(),
    attaques(camp, s) {
      const cle = camp + s;
      if (!cache.has(cle)) cache.set(cle, attackersOf(map, s, camp));
      return cache.get(cle);
    },
  };
}

function precedent(fen, options) {
  const { coupAdversePrecedent: uci, fenAvantCoupAdverse } = options;
  if (!estUci(uci)) return null;
  if (!fenAvantCoupAdverse) return { coup: { from: uci.slice(0, 2), to: uci.slice(2, 4) } };
  try {
    const chess = new Chess(fenAvantCoupAdverse);
    const avant = etat(chess);
    const coup = chess.move(uci);
    if (coup.after.split(' ').slice(0, 4).join(' ') !== fen.split(' ').slice(0, 4).join(' ')) return null;
    return { coup, avant };
  } catch {
    return null;
  }
}

function solution(fen, ligne, options) {
  if (!Array.isArray(ligne) || !ligne.length || !ligne.every(estUci)) return null;
  try {
    const chess = new Chess(fen);
    const origine = etat(chess);
    const etapes = [];
    let avant = origine;
    for (const [i, uci] of ligne.entries()) {
      const coup = chess.move(uci);
      const apres = etat(chess);
      etapes.push({ i, coup, avant, apres, type: coup.promotion ?? coup.piece });
      avant = apres;
    }
    const origineAdverse = precedent(origine.fen, options);
    return { origine, etapes, camp: origine.trait, ennemi: adverse(origine.trait),
      nosCoups: etapes.filter(e => e.coup.color === origine.trait),
      precedent: origineAdverse && origine.map[origineAdverse.coup.to]?.color === adverse(origine.trait)
        ? origineAdverse : null };
  } catch {
    return null;
  }
}

function ciblePrise(etape) {
  const { coup } = etape;
  return coup.isEnPassant() ? coup.to[0] + coup.from[1] : coup.to;
}

function ennemisTouches({ coup, apres }) {
  return rawAttacks(apres.map, coup.to).filter(s => apres.map[s] && apres.map[s].color !== coup.color);
}

function sansDefense(position, s) {
  const { map } = position;
  const camp = map[s].color;
  if (position.attaques(camp, s).length) return false;
  // Une batterie derrière l'attaquant peut reprendre après son déplacement.
  return !position.attaques(adverse(camp), s).some(a => {
    if (!rayons.has(map[a].type)) return false;
    const { [a]: retiree, ...apres } = map;
    return attackersOf(apres, s, camp).length > 0;
  });
}

function vulnerable(position, s) {
  const { map } = position;
  const attaquants = position.attaques(adverse(map[s].color), s);
  return attaquants.length > 0 && (attaquants.some(a => valeur(map[a].type) < valeur(map[s].type)) || sansDefense(position, s));
}

function mat(solution, emettre) {
  const derniere = solution.etapes.at(-1);
  const { i, coup, apres } = derniere;
  if (coup.color !== solution.camp || !apres.mat) return;
  const { map, roi } = apres;
  const donneurs = apres.attaques(solution.camp, roi);
  const cases = [donneurs.includes(coup.to) ? coup.to : donneurs[0], roi];
  emettre('mate', i, cases);
  emettre('mateIn' + Math.min(5, solution.nosCoups.length), i, cases);

  const adjacentes = rawAttacks(map, roi);
  const etouffe = donneurs.find(s => map[s].type === 'n');
  if (etouffe && adjacentes.every(s => map[s]?.color === solution.ennemi)) {
    emettre('smotheredMate', i, [etouffe, roi, ...adjacentes]);
    return;
  }
  const rangBase = solution.ennemi === 'w' ? '1' : '8';
  const front = adjacentes.filter(s => s[1] !== rangBase);
  const donneur = donneurs.find(s => s[1] === rangBase);
  if (roi[1] === rangBase && donneur && front.every(s => map[s]?.color === solution.ennemi &&
    !apres.attaques(solution.camp, s).length)) {
    emettre('backRankMate', i, [donneur, roi, ...front]);
  }
}

function fourchettes(p, emettre) {
  for (const e of p.nosCoups.slice(0, -1)) {
    const { apres, coup, type, i } = e;
    const acteur = coup.to;
    if (vulnerable(apres, acteur)) continue;
    const ripostes = apres.attaques(p.ennemi, acteur);
    const cibles = ennemisTouches(e).filter(s => {
      const cible = apres.map[s].type;
      return cible !== 'p' && (valeur(cible) > valeur(type) || (!ripostes.includes(s) && sansDefense(apres, s)));
    });
    if (cibles.length >= 2) emettre('fork', i, [acteur, ...cibles]);
  }
}

function clouages(p, emettre) {
  for (const { i, apres } of p.nosCoups) {
    const { map, roi } = apres;
    for (const [s, piece] of Object.entries(map)) {
      if (piece.color !== p.ennemi || piece.type === 'k') continue;
      const rayon = pinLine(map, s);
      if (!rayon) continue;
      const cloueur = rayon.at(-1);
      const horsRayon = z => z !== roi && !rayon.includes(z) && !entre(roi, z).includes(s);
      const attaques = rawAttacks(map, s).filter(horsRayon);
      const gainEmpeche = attaques.find(z => map[z]?.color === p.camp && map[z].type !== 'k' &&
        (valeur(map[z].type) > valeur(piece.type) || sansDefense(apres, z)));
      if (gainEmpeche) {
        emettre('pin', i, [cloueur, s, gainEmpeche, roi]);
        continue;
      }
      const fuite = piece.type === 'p'
        ? attaques.some(z => map[z]?.color === p.camp)
        : attaques.some(z => map[z]?.color !== p.ennemi);
      const cible = apres.attaques(p.camp, s).find(a => rayon.includes(a) && map[a].type !== 'k' &&
        (valeur(piece.type) > valeur(map[a].type) ||
          (fuite && sansDefense(apres, s) && !apres.attaques(p.ennemi, a).includes(s))));
      if (cible) emettre('pin', i, [cloueur, s, roi]);
    }
  }
}

function enfilades(p, emettre) {
  for (const e of p.nosCoups.slice(1)) {
    const { coup, i, avant, apres, type } = e;
    const fuite = p.etapes[i - 1];
    if (!coup.captured || !rayons.has(type) || apres.mat || fuite.coup.to === coup.to) continue;
    if (valeur(fuite.type) > valeur(coup.captured) && entre(coup.from, coup.to).includes(fuite.coup.from) &&
      vulnerable(avant, coup.to)) {
      emettre('skewer', i, [coup.to, fuite.coup.from, fuite.coup.to]);
    }
  }
}

function decouvertes(p, emettre) {
  for (const { i, coup, apres } of p.nosCoups) {
    if (!apres.echec) continue;
    const donneurs = apres.attaques(p.camp, apres.roi);
    if (!donneurs.includes(coup.to)) emettre('discoveredAttack', i, [donneurs[0], apres.roi, coup.to]);
  }
  for (const { i, coup } of p.nosCoups.slice(1)) {
    if (!coup.captured) continue;
    if (p.etapes[i - 1].coup.to === coup.to) break;
    const ouverture = p.etapes[i - 2].coup;
    if (entre(coup.from, coup.to).includes(ouverture.from) && ouverture.to !== coup.from && ouverture.to !== coup.to &&
      !ouverture.isKingsideCastle() && !ouverture.isQueensideCastle()) {
      emettre('discoveredAttack', i, [coup.to, ouverture.from]);
    }
  }
}

function doublesEchecs(p, emettre) {
  for (const { i, apres } of p.nosCoups) {
    if (!apres.echec) continue;
    const donneurs = apres.attaques(p.camp, apres.roi);
    if (donneurs.length > 1) emettre('doubleCheck', i, [...donneurs, apres.roi]);
  }
}

const bilan = (position, camp) => Object.values(position.map).reduce((total, piece) =>
  total + (piece.color === camp ? 1 : -1) * valeur(piece.type), 0);

function pieceEnPrise(p, emettre) {
  if (!p.precedent) return;
  const [e, , confirmation] = p.etapes;
  const s = ciblePrise(e);
  if (!e.coup.captured || e.coup.captured === 'p' || !sansDefense(e.avant, s)) return;
  const { coup } = p.precedent;
  if (coup.to === s && (!p.precedent.avant || valeur(coup.captured) >= valeur(e.coup.captured))) return;
  if (!confirmation || bilan(confirmation.apres, p.camp) >= bilan(e.apres, p.camp)) {
    emettre('hangingPiece', 0, [s]);
  }
}

function estPiegee(position, s) {
  const { map, trait } = position;
  const piece = map[s];
  if (!piece || piece.color !== trait || 'pk'.includes(piece.type) || position.echec || pinLine(map, s) ||
    !vulnerable(position, s)) return false;
  const chess = new Chess(position.fen);
  return chess.moves({ square: s, verbose: true }).every(coup => {
    if (valeur(coup.captured) >= valeur(piece.type)) return false;
    return vulnerable(etat(new Chess(coup.after)), coup.to);
  });
}

function piecesPiegees(p, emettre) {
  for (const e of p.nosCoups.slice(1)) {
    if (!e.coup.captured || e.coup.captured === 'p') continue;
    const fuite = p.etapes[e.i - 1];
    const cible = ciblePrise(e);
    const s = fuite.coup.to === cible ? fuite.coup.from : cible;
    if (estPiegee(fuite.avant, s)) emettre('trappedPiece', e.i, [cible, s]);
  }
}

function sacrifices(p, emettre) {
  if (p.etapes.some(e => e.coup.color === p.ennemi && e.coup.promotion)) return;
  const initial = bilan(p.origine, p.camp);
  for (const e of p.nosCoups.slice(1)) {
    if (bilan(e.apres, p.camp) > initial - 2) continue;
    const prise = p.etapes[e.i - 1];
    emettre('sacrifice', e.i, [ciblePrise(prise), e.coup.to]);
  }
}

function deviations(p, emettre) {
  for (const { coup, i, type, avant } of p.nosCoups.slice(1)) {
    if ((!coup.captured && !coup.promotion) || valeur(coup.captured) > valeur(type)) continue;
    const amorce = p.etapes[i - 2];
    const reponse = p.etapes[i - 1].coup;
    if (valeur(amorce.coup.captured) >= valeur(amorce.type) ||
      [amorce.coup.to, reponse.to].includes(coup.to)) continue;
    if (!amorce.apres.echec && reponse.to !== amorce.coup.to) continue;
    const avantDeviation = rawAttacks(amorce.apres.map, reponse.from);
    const perdControle = avantDeviation.includes(coup.to) || (coup.promotion &&
      reponse.from[0] === coup.to[0] && avantDeviation.includes(coup.from));
    if (perdControle && !rawAttacks(avant.map, reponse.to).includes(coup.to)) {
      emettre('deflection', i, [coup.to, reponse.from, reponse.to]);
    }
  }
}

function attractions(p, emettre) {
  for (const amorce of p.nosCoups) {
    const cible = amorce.coup.to;
    const prise = p.etapes[amorce.i + 1];
    const attaque = p.etapes[amorce.i + 2];
    if (prise?.coup.to !== cible || !attaque || !'kqr'.includes(prise.type)) continue;
    if (!attaque.apres.attaques(p.camp, cible).includes(attaque.coup.to)) continue;
    const exploitation = prise.type === 'k' ? attaque : p.etapes[amorce.i + 4];
    if (exploitation && (prise.type === 'k' || exploitation.coup.to === cible)) {
      emettre('attraction', exploitation.i, [cible, prise.coup.from, attaque.coup.to]);
    }
  }
}

function capturesDuDefenseur(p, emettre) {
  for (const { coup, i, type, avant, apres } of p.nosCoups.slice(1)) {
    const amorce = p.etapes[i - 2];
    const reponse = p.etapes[i - 1];
    const s = coup.to;
    const cibleLibre = coup.captured && !coup.isEnPassant() && type !== 'k' &&
      valeur(coup.captured) <= valeur(type) && s !== reponse.coup.to && sansDefense(avant, s);
    if (!apres.mat && !cibleLibre) continue;
    const defenseur = amorce.coup.to;
    if (amorce.avant.echec || amorce.apres.echec || defenseur === coup.from) continue;
    if (amorce.avant.map[defenseur]?.color === p.ennemi && rawAttacks(amorce.avant.map, defenseur).includes(s)) {
      emettre('capturingDefender', i, [s, defenseur]);
    }
  }
}

function rayonsX(p, emettre) {
  for (const { coup, i } of p.nosCoups.slice(1)) {
    const reponse = p.etapes[i - 1];
    const cible = coup.to;
    if (coup.captured && reponse.type !== 'k' && reponse.coup.to === cible &&
      p.etapes[i - 2].coup.to === cible && entre(coup.from, cible).includes(reponse.coup.from)) {
      emettre('xRayAttack', i, [cible, reponse.coup.from]);
    }
  }
}

function coupsIntermediaires(p, emettre) {
  for (const { coup, i } of p.nosCoups.slice(1)) {
    if (!coup.captured) continue;
    const intercale = p.etapes[i - 2];
    const reponse = p.etapes[i - 1];
    if (intercale.coup.to === coup.to || rawAttacks(intercale.apres.map, reponse.coup.from).includes(coup.to)) continue;
    const prise = p.etapes[i - 3]?.coup ?? p.precedent?.coup;
    if (prise?.captured && prise.to === coup.to &&
      new Chess(intercale.avant.fen).moves({ square: coup.from, verbose: true }).some(m => m.lan === coup.lan)) {
      emettre('intermezzo', i, [coup.to, intercale.coup.to]);
    }
    break;
  }
}

function defenseInterceptee(position, camp, cible, ecran) {
  return position.attaques(camp, cible).find(s => rayons.has(position.map[s].type) && entre(s, cible).includes(ecran));
}

function interferences(p, emettre) {
  for (const { coup, i, avant } of p.nosCoups.slice(1)) {
    const cible = coup.to;
    if (!coup.captured || coup.isEnPassant() || !sansDefense(avant, cible)) continue;
    const intercale = p.etapes[i - 2];
    const reponse = p.etapes[i - 1];
    const ecranAdverse = defenseInterceptee(intercale.apres, p.ennemi, cible, reponse.coup.to);
    const ecranAmi = cible === reponse.coup.to ? null :
      defenseInterceptee(intercale.avant, p.ennemi, cible, intercale.coup.to);
    if (ecranAdverse || ecranAmi) {
      emettre('interference', i, [cible, ecranAdverse ?? ecranAmi, ecranAdverse ? reponse.coup.to : intercale.coup.to]);
    }
  }
}

function degagements(p, emettre) {
  for (const { coup, i, type, avant, apres } of p.nosCoups.slice(1)) {
    if (coup.captured || !rayons.has(type) || avant.echec || (apres.echec && p.etapes[i - 1].type === 'k')) continue;
    const ouverture = p.etapes[i - 2];
    const { from, to, promotion, captured } = ouverture.coup;
    if (promotion || [coup.to, coup.from].includes(to)) continue;
    if ((from === coup.to || entre(coup.from, coup.to).includes(from)) &&
      (!captured || vulnerable(ouverture.apres, to))) {
      emettre('clearance', i, [coup.to, from]);
    }
  }
}

const rangPion = ({ coup }) => coup.piece === 'p' ? rang(coup.to, coup.color) : 0;
const sansPriseNiEchec = e => !e.coup.captured && !e.apres.echec;
const sansMenaceImmediate = e => sansPriseNiEchec(e) && rangPion(e) < 6 && !ennemisTouches(e).length;

function coupsTranquilles(p, emettre) {
  for (const e of p.nosCoups) {
    if (e.i < p.etapes.length - 1 && !e.avant.echec && e.type !== 'k' && sansMenaceImmediate(e)) {
      emettre('quietMove', e.i, [e.coup.to]);
    }
  }
}

function coupsDefensifs(p, emettre) {
  const derniere = p.etapes.at(-1);
  const choix = e => new Chess(e.avant.fen).moves().length >= 3;
  if (derniere.coup.color === p.camp && sansMenaceImmediate(derniere) && choix(derniere)) {
    emettre('defensiveMove', derniere.i, [derniere.coup.to]);
    return;
  }
  for (const e of p.nosCoups) {
    if (!sansPriseNiEchec(e) || !choix(e)) break;
    if (e.avant.echec) {
      emettre('defensiveMove', e.i, [e.coup.to]);
      return;
    }
  }
}

function promotions(p, emettre) {
  for (const e of p.nosCoups) {
    if (!e.coup.promotion) continue;
    emettre('promotion', e.i, [e.coup.to]);
    if (e.type !== 'q' && (!e.apres.mat || e.type === 'n')) emettre('underPromotion', e.i, [e.coup.to]);
  }
}

function pionsAvances(p, emettre) {
  for (const e of p.nosCoups) {
    if (rangPion(e) >= 7) emettre('advancedPawn', e.i, [e.coup.to]);
  }
}

function roiExpose(p, emettre) {
  const map = p.origine.map;
  const roi = kingOf(map, p.ennemi);
  if (rang(roi, p.ennemi) > 3) return;
  const bouclier = rawAttacks(map, roi).filter(s => rang(s, p.ennemi) >= rang(roi, p.ennemi));
  if (bouclier.some(s => map[s]?.type === 'p' && map[s].color === p.ennemi)) return;
  for (const { i, apres } of p.nosCoups.slice(1, -1)) {
    if (apres.echec) emettre('exposedKing', i, [apres.roi, ...apres.attaques(p.camp, apres.roi)]);
  }
}

function attaqueF2F7(p, emettre) {
  const e = p.nosCoups.find(({ coup }) => coup.captured && ['f2', 'f7'].includes(coup.to));
  if (!e) return;
  const roi = e.coup.to === 'f7' ? 'e8' : 'e1';
  if (e.apres.map[roi]?.type === 'k' && e.apres.map[roi].color === p.ennemi) {
    emettre('attackingF2F7', e.i, [e.coup.to, roi]);
  }
}

function attaqueDeFlanc(p, emettre) {
  const roi = kingOf(p.origine.map, p.ennemi);
  if (rang(roi, p.ennemi) !== 1) return;
  const coteRoi = 'gh'.includes(roi[0]);
  if (!coteRoi && !'abc'.includes(roi[0])) return;
  if (Object.keys(p.origine.map).length < (coteRoi ? 20 : 18)) return;
  const coin = (coteRoi ? 'h' : 'a') + roi[1];
  const points = p.nosCoups.map(e => {
    const d = distance(coin, e.coup.to);
    return Number(e.apres.echec) + Number(e.coup.captured && d <= 3 ? true : false) - Number(d >= 5);
  });
  const e = p.nosCoups.findLast(e => e.apres.echec);
  if (e && points.reduce((a, b) => a + b, 0) >= 2) {
    emettre(coteRoi ? 'kingsideAttack' : 'queensideAttack', e.i, [e.apres.roi, ...e.apres.attaques(p.camp, e.apres.roi)]);
  }
}

export function detecterThemes(fen, ligneUci, options = {}) {
  const rejeu = solution(fen, ligneUci, options);
  if (!rejeu) return [];
  const themes = [];
  const emettre = (theme, demiCoup, cases) => {
    themes.push({ theme, libelle: libellesThemes[theme], camp: rejeu.camp, demiCoup, cases: [...new Set(cases)] });
  };
  mat(rejeu, emettre);
  fourchettes(rejeu, emettre);
  clouages(rejeu, emettre);
  enfilades(rejeu, emettre);
  decouvertes(rejeu, emettre);
  doublesEchecs(rejeu, emettre);
  pieceEnPrise(rejeu, emettre);
  piecesPiegees(rejeu, emettre);
  sacrifices(rejeu, emettre);
  deviations(rejeu, emettre);
  attractions(rejeu, emettre);
  capturesDuDefenseur(rejeu, emettre);
  rayonsX(rejeu, emettre);
  coupsIntermediaires(rejeu, emettre);
  interferences(rejeu, emettre);
  degagements(rejeu, emettre);
  coupsTranquilles(rejeu, emettre);
  coupsDefensifs(rejeu, emettre);
  promotions(rejeu, emettre);
  pionsAvances(rejeu, emettre);
  roiExpose(rejeu, emettre);
  attaqueF2F7(rejeu, emettre);
  if (!themes.some(m => m.theme === 'fork' || m.theme === 'backRankMate')) attaqueDeFlanc(rejeu, emettre);
  return themes.sort((a, b) => a.demiCoup - b.demiCoup);
}
