// Module Finales : jugement des coups avec la table de finales Lichess. Sans DOM (testé avec node).
// Un « résultat » est toujours un nombre : 1 = gain, 0 = nulle, -1 = perte.
import { Chess, validateFen } from '../vendor/chess.js';

export const MAX_PIECES = 7;
export const COUPS_POUR_ANNULER = 30; // objectif « Annulez » : réussi après ce nombre de coups tenus
export const NOM_RESULTAT = Object.freeze({ 1: 'Gain', 0: 'Nulle', '-1': 'Perte' });

// Catégories de l'API, vues par le camp au trait. Un gain ou une perte annulés par la règle
// des 50 coups comptent comme une nulle. « maybe- » et « syzygy- » : l'arrondi de la table ne
// permet pas de trancher, on garde le gain ou la perte (si la règle des 50 coups l'annule,
// la table le dira sur une des positions suivantes).
const CATEGORIES = Object.freeze({
  win: 1, 'maybe-win': 1, 'syzygy-win': 1,
  draw: 0, 'cursed-win': 0, 'blessed-loss': 0,
  loss: -1, 'maybe-loss': -1, 'syzygy-loss': -1,
});
export const resultat = (categorie) => (Object.hasOwn(CATEGORIES, categorie) ? CATEGORIES[categorie] : null);
const inverse = (r) => (r === null ? null : 0 - r);

// La catégorie d'un coup est celle de la position obtenue, vue par l'adversaire.
export const resultatDuCoup = (coup) => inverse(resultat(coup.category));

export const uciEnCoup = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

// Nulle ou mat constatés sur l'échiquier (la répétition demande l'historique des coups).
export function finDePartie(chess) {
  if (chess.isCheckmate()) return 'mat';
  if (chess.isStalemate()) return 'pat';
  if (chess.isInsufficientMaterial()) return 'materiel';
  if (chess.isThreefoldRepetition()) return 'repetition';
  if (Number(chess.fen().split(' ')[4]) >= 100) return 'cinquante';
  return null;
}
export const NOM_FIN = Object.freeze({
  mat: 'Échec et mat',
  pat: 'Pat',
  materiel: 'Matériel insuffisant pour mater',
  repetition: 'Répétition de la position',
  cinquante: 'Règle des 50 coups',
});

// FEN saisi par l'utilisateur → FEN complet jouable, ou message d'erreur en français.
export function lireFen(texte, traduireErreur = (m) => m) {
  const champs = String(texte ?? '').trim().split(/\s+/).filter(Boolean);
  if (!champs.length) return { erreur: 'Collez un FEN ou placez les pièces.' };
  const complet = [champs[0], champs[1] ?? 'w', champs[2] ?? '-', champs[3] ?? '-', champs[4] ?? '0', champs[5] ?? '1', ...champs.slice(6)].join(' ');
  const v = validateFen(complet);
  if (!v.ok) return { erreur: `FEN invalide : ${traduireErreur(v.error)}.` };
  const pieces = complet.split(' ')[0].replace(/[^a-z]/gi, '').length;
  if (pieces > MAX_PIECES) return { erreur: `La table de finales est limitée à ${MAX_PIECES} pièces, rois et pions compris (${pieces} ici).` };
  if (complet.split(' ')[2] !== '-') return { erreur: 'La table de finales n’accepte aucun droit au roque : remplacez-les par « - ».' };
  const autre = complet.split(' ');
  autre[1] = autre[1] === 'w' ? 'b' : 'w';
  autre[3] = '-';
  if (new Chess(autre.join(' ')).inCheck()) return { erreur: 'Position impossible : le roi du camp qui n’a pas le trait est en échec.' };
  return { fen: complet };
}

// Interrogation de la table. « requete » a la signature de fetchJson (core/ui.js).
export function creerSonde(requete) {
  const memoire = new Map();
  return async (fen) => {
    if (memoire.has(fen)) return memoire.get(fen);
    const { status, body } = await requete('https://tablebase.lichess.ovh/standard?fen=' + encodeURIComponent(fen));
    if (status === 0) throw new Error('Table de finales injoignable. Vérifiez votre connexion Internet.');
    if (status === 429) throw new Error('La table de finales reçoit trop de demandes. Patientez une minute.');
    if (status !== 200 || !body || !Array.isArray(body.moves)) throw new Error(`La table de finales n’a pas répondu correctement (code ${status}).`);
    if (resultat(body.category) === null || body.moves.some((m) => resultat(m.category) === null)) {
      throw new Error('La table de finales ne connaît pas le résultat exact de cette position.');
    }
    memoire.set(fen, body);
    if (memoire.size > 2000) memoire.delete(memoire.keys().next().value);
    return body;
  };
}

// Un essai sur une position. États : « jeu » (à vous ou à l'adversaire), « faute » (le dernier coup
// a dégradé le résultat : on peut le rejouer), « fini ».
export class Exercice {
  // noter(resultat) est appelé une seule fois par essai : dès qu'il est raté, sinon à sa réussite.
  static async creer({ fen, camp, sonde, limite = COUPS_POUR_ANNULER, noter = null }) {
    const chess = new Chess(fen);
    const fin = finDePartie(chess);
    if (fin) throw new Error(`Rien à jouer : la partie est déjà terminée (${NOM_FIN[fin].toLowerCase()}).`);
    const table = await sonde(chess.fen());
    const auTrait = resultat(table.category);
    const pourMoi = chess.turn() === camp ? auTrait : inverse(auTrait);
    if (pourMoi === null) throw new Error('La table de finales ne connaît pas le résultat exact de cette position.');
    if (pourMoi < 0) throw new Error(`Position perdante pour les ${camp === 'w' ? 'Blancs' : 'Noirs'} : il n’y a rien à réussir. Changez de camp ou de position.`);
    return new Exercice({ fen: chess.fen(), camp, sonde, limite, objectif: pourMoi, noter });
  }

  constructor({ fen, camp, sonde, limite, objectif, noter = null }) {
    Object.assign(this, { depart: fen, camp, sonde, limite, objectif, noter });
    this.version = 0;
    this.recommencer();
  }

  // Nouvel essai depuis la position de départ.
  recommencer() {
    this.version++;
    this.chess = new Chess(this.depart);
    this.coups = [];
    this.etat = 'jeu';
    this.aide = false;
    this.rate = false;
    this.faute = null;
    this.fin = null;
    this.niveauIndice = 0;
    this.occupe = false;
    this.note = null;
  }

  signaler(resultatEssai) {
    if (this.note || !resultatEssai) return;
    this.note = resultatEssai;
    this.noter?.(resultatEssai);
  }

  get aMoi() { return this.etat === 'jeu' && this.chess.turn() === this.camp; }
  get aLui() { return this.etat === 'jeu' && this.chess.turn() !== this.camp; }
  get mesCoups() { return this.coups.filter((m) => m.color === this.camp).length; }
  get peutRejouer() { return this.etat !== 'fini' && this.mesCoups > 0; }

  // Positions de l'essai, de la position de départ à la position actuelle.
  positions() { return [this.depart, ...this.coups.map((m) => m.after)]; }

  // Exécute une opération qui interroge la table ; son résultat est abandonné si l'essai a changé entre-temps.
  async avecTable(operation) {
    if (this.occupe) return false;
    const version = this.version;
    this.occupe = true;
    try {
      const table = await this.sonde(this.chess.fen());
      if (version !== this.version) return false;
      return operation(table);
    } finally {
      if (version === this.version) this.occupe = false;
    }
  }

  jouer(uci) {
    if (!this.aMoi) return Promise.resolve(false);
    return this.avecTable((table) => {
      const info = table.moves.find((m) => m.uci === uci);
      if (!info) throw new Error('Coup inconnu de la table de finales.');
      const apres = resultatDuCoup(info);
      this.coups.push(this.chess.move(uciEnCoup(uci)));
      this.niveauIndice = 0;
      const fin = finDePartie(this.chess);
      if (fin === 'mat') this.terminer(true, fin);
      else if (apres < this.objectif) {
        this.rate = true;
        this.etat = 'faute';
        this.faute = { avant: this.objectif, apres, fin, san: this.coups.at(-1).san };
        this.signaler('rate');
      } else if (fin) this.terminer(this.objectif === 0, fin);
      else if (this.objectif === 0 && this.mesCoups >= this.limite) this.terminer(true, 'tenu');
      return true;
    });
  }

  // Réponse de l'adversaire : le premier coup de la table (elle les classe du meilleur au moins bon)
  // parmi ceux qui conservent son résultat.
  repondre() {
    if (!this.aLui) return Promise.resolve(false);
    return this.avecTable((table) => {
      const sien = resultat(table.category);
      const info = table.moves.find((m) => resultatDuCoup(m) === sien) ?? table.moves[0];
      if (!info) throw new Error('La table de finales ne propose aucun coup.');
      this.coups.push(this.chess.move(uciEnCoup(info.uci)));
      const fin = finDePartie(this.chess);
      if (fin === 'mat') this.terminer(false, fin);
      else if (fin) this.terminer(this.objectif === 0, fin);
      // la catégorie du coup adverse est celle de la nouvelle position vue par vous
      else if (resultat(info.category) < this.objectif) this.terminer(false, 'cinquante');
      return true;
    });
  }

  // Indice en deux temps : la pièce, puis le coup.
  indice() {
    if (!this.aMoi) return Promise.resolve(false);
    return this.avecTable((table) => {
      const info = table.moves.find((m) => resultatDuCoup(m) >= this.objectif);
      if (!info) throw new Error('Aucun coup ne conserve le résultat.');
      this.aide = true;
      this.niveauIndice = Math.min(2, this.niveauIndice + 1);
      const coup = new Chess(this.chess.fen()).move(uciEnCoup(info.uci));
      return { niveau: this.niveauIndice, coup };
    });
  }

  // Annule votre dernier coup (et la réponse qui l'a suivi).
  rejouer() {
    if (!this.peutRejouer) return false;
    this.version++;
    this.occupe = false;
    let retire;
    do { retire = this.coups.pop(); this.chess.undo(); } while (retire.color !== this.camp);
    this.aide = true;
    this.etat = 'jeu';
    this.faute = null;
    this.niveauIndice = 0;
    return true;
  }

  // Met fin à l'essai sans le réussir (après une faute, ou abandon).
  abandonner() {
    if (this.etat === 'fini') return false;
    this.version++;
    this.occupe = false;
    this.terminer(false, this.faute ? 'faute' : 'abandon');
    return true;
  }

  terminer(atteint, raison) {
    if (!atteint) this.rate = true;
    this.etat = 'fini';
    this.fin = { atteint, raison };
    this.signaler(this.verdict);
  }

  // « reussi » (sans aide), « aide » (réussi avec une aide) ou « rate ».
  get verdict() {
    if (this.etat !== 'fini') return null;
    if (this.rate) return 'rate';
    return this.aide ? 'aide' : 'reussi';
  }

  // Résultat de chaque coup possible d'une position de l'essai : seulement une fois l'essai fini.
  async correction(ply) {
    if (this.etat !== 'fini') return null;
    const fen = this.positions()[ply];
    if (!fen) return null;
    if (finDePartie(new Chess(fen)) === 'mat') return [];
    const table = await this.sonde(fen);
    return table.moves.map((m) => ({ uci: m.uci, san: m.san, resultat: resultatDuCoup(m) }));
  }
}
