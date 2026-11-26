// Module « Finales » : page d’accueil (trois onglets) et jeu d’une position contre la table de finales.
import { Board, announce } from '../board.js';
import { $, $$, esc, fetchJson, local, uciOf } from '../core/ui.js';
import { creerSonde, Exercice, lireFen, NOM_FIN, NOM_RESULTAT, uciEnCoup } from '../core/finales.js';
import { grouperFinales, TYPES_FINALES } from '../core/finales-erreurs.js';
import { frSan } from '../explain.js';
import { BOOK, figSan, getGames, getUser } from './analyse.js';
import * as puzzles from './endgames-puzzles.js';
import { creerListeErreurs } from './liste-erreurs.js';
import { fenError, renderEditor } from './setup.js';
import { Chess } from '../vendor/chess.js';

const DELAI_REPONSE = 450;
const NOM_CAMP = { w: 'Blancs', b: 'Noirs' };
const NOM_PIECE = { k: 'le Roi', q: 'la Dame', r: 'la Tour', b: 'le Fou', n: 'le Cavalier', p: 'le pion' };
const sonde = creerSonde(fetchJson);

const COULEUR_INDICE = 'var(--arrow-best)';
const ONGLETS = [['cours', 'Cours'], ['puzzles', 'Puzzles de finales'], ['mes-finales', 'Mes finales']];
// L’onglet « Cours » est volontairement vide. L’écran de la position libre est gardé (route
// #/endgames/setup) mais aucun lien n’y mène pour le moment.
const mesFinales = creerListeErreurs({
  prefixe: 'endgameMistakes',
  onglets: TYPES_FINALES,
  nomOnglets: 'Type de finale',
  retour: { href: '#/endgames', texte: 'Retour à mes finales' },
  textes: {
    chargement: 'Chargement de vos finales…',
    vide: 'Aucune faute dans ce type de finale sur cette période.',
    echec: 'Impossible de charger vos finales.',
  },
  charger: (analyses, travaux, periode) => grouperFinales(analyses, getGames(), travaux, getUser(), BOOK, periode),
});
// Quitte la page d’accueil du module (abonnements de « Mes finales »).
export const leave = () => mesFinales.leave();

// ex : essai en cours. indice : dernier indice demandé.
// correction : { ply, coups, erreur } quand le résultat de chaque coup est affiché.
const P = { ex: null, plateau: null, vue: null, indice: null, correction: null, erreur: null, minuteur: null };

// ------------------------------------------------------------------ lancement d’un essai
async function lancer(fen, camp) {
  const depuis = location.hash;
  const ex = await Exercice.creer({ fen, camp, sonde });
  if (location.hash !== depuis) return; // l’utilisateur a changé de page pendant la réponse de la table
  clearTimeout(P.minuteur);
  Object.assign(P, { ex, indice: null, correction: null, erreur: null });
  P.plateau?.setOrientation(camp);
  location.hash = '#/endgames/play';
}

// ------------------------------------------------------------------ page d’accueil
export function show(el) {
  $('#topbar-soon').textContent = 'Finales';
  mesFinales.leave();
  const choisi = ONGLETS.some(([k]) => k === local.get('endgamesTab')) ? local.get('endgamesTab') : 'cours';
  el.innerHTML = `<h1 class="page-title">Finales</h1>
    <div class="ptabs eg-onglets" role="tablist" aria-label="Parties du module">${ONGLETS.map(([k, nom]) =>
      `<button type="button" role="tab" id="eg-tab-${k}" aria-controls="eg-panel-${k}" data-k="${k}" aria-selected="${k === choisi}" tabindex="${k === choisi ? 0 : -1}">${nom}</button>`).join('')}</div>
    <section role="tabpanel" id="eg-panel-cours" aria-labelledby="eg-tab-cours"></section>
    <section role="tabpanel" id="eg-panel-puzzles" aria-labelledby="eg-tab-puzzles">
      <div id="eg-puzzles"><p class="muted" role="status">Chargement…</p></div></section>
    <section role="tabpanel" id="eg-panel-mes-finales" aria-labelledby="eg-tab-mes-finales">
      <div id="eg-mes-finales"></div></section>`;

  const onglets = $$('.eg-onglets [role="tab"]', el);
  const choisir = (i) => {
    onglets.forEach((b, j) => {
      b.setAttribute('aria-selected', String(i === j));
      b.tabIndex = i === j ? 0 : -1;
      $('#eg-panel-' + b.dataset.k, el).hidden = i !== j;
    });
    const cle = onglets[i].dataset.k;
    local.set('endgamesTab', cle);
    // « Mes finales » relit toutes les analyses : on ne le calcule que lorsqu’il est affiché
    if (cle === 'mes-finales') mesFinales.show($('#eg-mes-finales', el)); else mesFinales.leave();
  };
  onglets.forEach((b, i) => {
    b.onclick = () => choisir(i);
    b.onkeydown = (e) => {
      const suivant = { ArrowLeft: i + onglets.length - 1, ArrowRight: i + 1, Home: 0, End: onglets.length - 1 }[e.key];
      if (suivant === undefined) return;
      e.preventDefault();
      choisir(suivant % onglets.length);
      onglets[suivant % onglets.length].focus();
    };
  });
  choisir(ONGLETS.findIndex(([k]) => k === choisi));

  puzzles.listerThemes($('#eg-puzzles', el));
}

export function editeur(el) {
  $('#topbar-soon').textContent = 'Finales';
  renderEditor(el, { finale: {
    probleme: (fen) => lireFen(fen, fenError).erreur ?? null,
    jouer: (fen, camp) => lancer(fen, camp),
  } });
}

// ------------------------------------------------------------------ écran de jeu
function construire(el) {
  el.innerHTML = `<h1 class="sr-only">Finales</h1>
    <div class="left"><div id="eg-board"></div>
      <div class="board-opts"><button type="button" id="eg-flip" class="btn small">⇅ Retourner</button></div></div>
    <aside class="panel pz-panel" id="eg-panel" aria-label="Exercice de finale">
      <div class="phead"><a class="btn small" href="#/endgames">← Finales</a><span class="ptitle" id="eg-title"></span></div>
      <div id="eg-goal" class="eg-goal"></div>
      <div id="eg-msg" class="tmsg" role="status" aria-live="polite"></div>
      <div id="eg-actions" class="tactions eg-actions"></div>
      <div id="eg-correction" class="eg-correction"></div>
      <div id="eg-moves" class="eg-moves" aria-label="Coups de l’exercice"></div>
    </aside>`;
  P.plateau = new Board($('#eg-board', el), { onMove: (from, to, promo) => monCoup(from + to + (promo || '')) });
  P.vue = el;
  $('#eg-flip', el).onclick = () => { P.plateau.flip(); dessiner(); };
  // un seul gestionnaire pour tous les boutons du panneau, reconstruits à chaque affichage
  $('#eg-panel', el).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-action]');
    if (b) ACTIONS[b.dataset.action](b);
  });
}

export function jouerVue(el) {
  $('#topbar-soon').textContent = 'Finales';
  if (!P.ex) { location.replace('#/endgames'); return; }
  if (P.vue !== el) construire(el);
  P.plateau.setOrientation(P.ex.camp);
  dessiner();
  planifierReponse();
}

const messageErreur = (err) => { P.erreur = err.message; dessiner(); };

function planifierReponse() {
  clearTimeout(P.minuteur);
  const ex = P.ex;
  if (!ex?.aLui || P.erreur) return;
  P.minuteur = setTimeout(async () => {
    try {
      if (P.ex === ex && await ex.repondre()) dessiner();
    } catch (err) { if (P.ex === ex) messageErreur(err); }
  }, DELAI_REPONSE);
}

async function monCoup(uci) {
  const ex = P.ex;
  if (!ex || !ex.aMoi || ex.occupe) { dessiner(); return; }
  P.erreur = null;
  P.indice = null;
  const attente = ex.jouer(uci);
  // le coup est montré tout de suite, pendant que la table répond
  const essai = new Chess(ex.chess.fen());
  try { essai.move(uciEnCoup(uci)); } catch { /* coup refusé par l’échiquier */ }
  P.plateau.interactive = false;
  P.plateau.setPosition(essai.fen(), { lastMove: [uci.slice(0, 2), uci.slice(2, 4)] });
  try {
    if (!await attente || P.ex !== ex) return;
    dessiner();
    planifierReponse();
  } catch (err) { if (P.ex === ex) messageErreur(err); }
}

const ACTIONS = {
  async indice() {
    const ex = P.ex;
    P.erreur = null;
    try {
      const i = await ex.indice();
      if (i && P.ex === ex) { P.indice = i; dessiner(); }
    } catch (err) { if (P.ex === ex) messageErreur(err); }
  },
  rejouer() {
    if (!P.ex.rejouer()) return;
    clearTimeout(P.minuteur);
    Object.assign(P, { indice: null, erreur: null });
    dessiner();
    planifierReponse();
  },
  recommencer() {
    clearTimeout(P.minuteur);
    P.ex.recommencer();
    Object.assign(P, { indice: null, erreur: null, correction: null });
    dessiner();
    planifierReponse();
  },
  abandonner() {
    if (!P.ex.abandonner()) return;
    clearTimeout(P.minuteur);
    Object.assign(P, { indice: null, erreur: null });
    dessiner();
  },
  reessayer() { P.erreur = null; dessiner(); planifierReponse(); },
  correction() {
    // après une faute, on ouvre sur la position où elle a été commise
    const fautive = P.ex.fin.raison === 'faute' ? P.ex.coups.length - 1 : 0;
    voir(fautive);
  },
  fermer() { P.correction = null; dessiner(); },
  precedent() { voir(P.correction.ply - 1); },
  suivant() { voir(P.correction.ply + 1); },
  position(b) { voir(Number(b.dataset.ply)); },
};

async function voir(ply) {
  const ex = P.ex;
  const max = ex.coups.length;
  const c = { ply: Math.max(0, Math.min(max, ply)), coups: null, erreur: null };
  P.correction = c;
  dessiner();
  try { c.coups = await ex.correction(c.ply); }
  catch (err) { c.erreur = err.message; }
  if (P.correction === c && P.ex === ex) dessiner();
}

function texteFin(ex) {
  const { atteint, raison } = ex.fin;
  const cause = {
    tenu: `Vous avez tenu ${ex.limite} coups.`,
    cinquante: ex.objectif === 1 ? 'La règle des 50 coups annule le gain.' : 'Nulle par la règle des 50 coups.',
    faute: texteFaute(ex),
    abandon: 'Exercice abandonné.',
    mat: atteint ? 'Échec et mat.' : 'Vous avez été maté.',
  }[raison] ?? `${NOM_FIN[raison]}.`;
  const titre = { reussi: 'Réussi sans aide', aide: 'Réussi avec aide', rate: 'Raté' }[ex.verdict];
  const note = ex.verdict === 'rate' && atteint ? ' Vous avez atteint l’objectif, mais après une faute : l’essai compte comme raté.' : '';
  return `<b>${titre}.</b> ${esc(cause)}${note}`;
}

function texteFaute(ex) {
  const f = ex.faute;
  if (!f) return '';
  const titre = f.avant === 1 ? 'Gain gâché' : 'Nulle gâchée';
  const effet = f.apres === 0 ? 'la position est maintenant nulle' : 'la position est maintenant perdante';
  const cause = f.fin ? ` (${NOM_FIN[f.fin].toLowerCase()})` : '';
  return `${titre} : après ${frSan(f.san)}, ${effet}${cause}.`;
}

function message(ex) {
  if (P.erreur) return { type: 'wrong', html: esc(P.erreur) };
  if (ex.etat === 'fini') return { type: ex.verdict === 'rate' ? 'wrong' : 'ok', html: texteFin(ex) };
  if (ex.etat === 'faute') return { type: 'wrong', html: `<b>${esc(texteFaute(ex))}</b> Vous pouvez rejouer ce coup ; l’exercice comptera comme raté.` };
  if (ex.aLui) return { type: '', html: 'L’adversaire joue…' };
  if (P.indice) {
    const { niveau, coup } = P.indice;
    return { type: '', html: niveau === 1 ? `Indice : jouez ${NOM_PIECE[coup.piece]} (${coup.from}). Cliquez de nouveau sur « Indice » pour voir le coup.`
      : `Indice : jouez <b>${figSan(coup.san, coup.color)}</b>.` };
  }
  return { type: '', html: ex.rate ? 'À vous de jouer. Cet essai compte déjà comme raté.' : 'À vous de jouer.' };
}

const bouton = (action, texte, { primaire = false, inactif = false, attributs = '' } = {}) =>
  `<button type="button" class="btn${primaire ? ' primary' : ''}" data-action="${action}"${inactif ? ' disabled' : ''} ${attributs}>${texte}</button>`;

function actions(ex) {
  const relance = P.erreur && ex.aLui ? bouton('reessayer', 'Réessayer', { primaire: true }) : '';
  if (ex.etat === 'fini') {
    return bouton('recommencer', 'Recommencer', { primaire: !P.correction })
      + (P.correction ? bouton('fermer', 'Fermer la correction') : bouton('correction', 'Voir le résultat de chaque coup'))
      + '<a class="btn" href="#/endgames/setup">Autre position</a>';
  }
  if (ex.etat === 'faute') {
    return bouton('rejouer', 'Rejouer le coup', { primaire: true }) + bouton('recommencer', 'Recommencer') + bouton('abandonner', 'Terminer l’exercice');
  }
  return relance + bouton('indice', 'Indice', { inactif: !ex.aMoi || P.indice?.niveau === 2 })
    + bouton('rejouer', 'Rejouer le coup', { inactif: !ex.peutRejouer })
    + bouton('recommencer', 'Recommencer', { inactif: !ex.coups.length && !ex.aide && !ex.rate }) + bouton('abandonner', 'Abandonner');
}

function htmlCorrection(ex) {
  const c = P.correction;
  if (!c) return '';
  const fen = ex.positions()[c.ply];
  const camp = fen.split(' ')[1];
  let corps;
  if (c.erreur) corps = `<p class="msg err" role="alert">${esc(c.erreur)}</p>${bouton('position', 'Réessayer', { attributs: `data-ply="${c.ply}"` })}`;
  else if (!c.coups) corps = '<p class="muted">Interrogation de la table…</p>';
  else if (!c.coups.length) corps = '<p class="muted">Échec et mat : aucun coup possible.</p>';
  else {
    const joue = ex.coups[c.ply] && uciOf(ex.coups[c.ply]);
    corps = [1, 0, -1].map((r) => {
      const liste = c.coups.filter((m) => m.resultat === r);
      return liste.length ? `<div class="eg-groupe r${r + 1}"><h3>${NOM_RESULTAT[r]} (${liste.length})</h3><ul>${liste.map((m) =>
        `<li${m.uci === joue ? ' class="joue"' : ''}>${figSan(m.san, camp)}${m.uci === joue ? ' <span class="small">(joué)</span>' : ''}</li>`).join('')}</ul></div>` : '';
    }).join('');
  }
  return `<div class="eg-nav">${bouton('precedent', '‹', { inactif: c.ply === 0, attributs: 'aria-label="Position précédente"' })}
    <span>Position ${c.ply + 1} sur ${ex.coups.length + 1}</span>
    ${bouton('suivant', '›', { inactif: c.ply === ex.coups.length, attributs: 'aria-label="Position suivante"' })}</div>
    <p class="small muted">Résultat de chaque coup pour les ${NOM_CAMP[camp]}, au trait.</p>${corps}`;
}

// Liste de coups numérotée ; rendu(m, i) donne le contenu de chaque coup.
function htmlListe(coups, rendu) {
  if (!coups.length) return '';
  let html = '';
  let ouvert = false;
  coups.forEach((m, i) => {
    const numero = m.before.split(' ')[5];
    if (m.color === 'w' || i === 0) {
      if (ouvert) html += '</li>';
      html += `<li><span class="mno">${numero}${m.color === 'w' ? '.' : '…'}</span>`;
      ouvert = true;
    }
    html += rendu(m, i);
  });
  return `<ol>${html}</li></ol>`;
}
const htmlCoups = (ex) => htmlListe(ex.coups, (m) => `<span class="eg-coup">${figSan(m.san, m.color)}</span>`);

function dessiner() {
  const ex = P.ex;
  if (!P.vue || !ex) return;
  $('#eg-title', P.vue).textContent = 'Position libre';

  // échiquier : position jouée, ou position consultée dans la correction
  const ply = P.correction ? P.correction.ply : ex.coups.length;
  const dernier = ply > 0 ? ex.coups[ply - 1] : null;
  const fleches = [];
  if (!P.correction && P.indice?.niveau === 2 && ex.aMoi) fleches.push({ from: P.indice.coup.from, to: P.indice.coup.to, color: COULEUR_INDICE });
  const marque = !P.correction && ex.faute && ply === ex.coups.length
    ? { sq: dernier.to, color: 'var(--cls-gaffe)', sym: '✗', label: ex.faute.avant === 1 ? 'Gain gâché' : 'Nulle gâchée' } : null;
  P.plateau.interactive = !P.correction && ex.aMoi;
  P.plateau.setPosition(ex.positions()[ply], { lastMove: dernier ? [dernier.from, dernier.to] : null, arrows: fleches, mark: marque });
  if (!P.correction && P.indice?.niveau === 1 && ex.aMoi) { P.plateau.hl.add(P.indice.coup.from); P.plateau.render(); }

  const objectif = ex.objectif === 1 ? 'Gagnez' : 'Annulez';
  const detail = ex.objectif === 1 ? 'Allez jusqu’au mat.' : `Coups tenus : ${Math.min(ex.mesCoups - (ex.faute ? 1 : 0), ex.limite)} sur ${ex.limite}.`;
  $('#eg-goal', P.vue).innerHTML = `<span class="avatar-sm ${ex.camp}"><img src="pieces/${ex.camp}K.svg" alt=""></span>
    <div><b>${objectif}</b><span class="muted">Vous jouez les ${NOM_CAMP[ex.camp]}. ${detail}</span></div>`;

  const m = message(ex);
  const zone = $('#eg-msg', P.vue);
  zone.className = 'tmsg ' + m.type;
  if (zone.innerHTML !== m.html) zone.innerHTML = m.html;

  // le focus clavier survit à la reconstruction des boutons
  const actif = document.activeElement?.closest('#eg-panel button[data-action]')?.dataset.action;
  $('#eg-actions', P.vue).innerHTML = actions(ex);
  $('#eg-correction', P.vue).innerHTML = htmlCorrection(ex);
  $('#eg-moves', P.vue).innerHTML = htmlCoups(ex);
  if (actif) {
    const retour = $(`#eg-panel button[data-action="${actif}"]:not(:disabled)`, P.vue) || $('#eg-actions .btn:not(:disabled)', P.vue);
    retour?.focus({ preventScroll: true });
  }
  if (ex.etat === 'fini' && !P.correction) announce(zone.textContent);
}

