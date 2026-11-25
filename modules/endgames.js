// Module « Finales » : page d’accueil (trois onglets) et jeu d’une position contre la table de finales.
import { Board, announce } from '../board.js';
import { $, $$, esc, fetchJson, local, toast, uciOf } from '../core/ui.js';
import * as store from '../core/store.js';
import { FAMILLES, LECONS, NIVEAUX, leconParId, leconSuivante } from '../core/finales-cours.js';
import { progression, resumeFamilles, REUSSITES_POUR_MAITRISE } from '../core/finales-progres.js';
import { creerSonde, Exercice, lireFen, NOM_FIN, NOM_RESULTAT, uciEnCoup } from '../core/finales.js';
import { frSan } from '../explain.js';
import { figSan } from './analyse.js';
import { fenError, miniBoard, renderEditor } from './setup.js';
import { Chess } from '../vendor/chess.js';

const DELAI_REPONSE = 450;
const NOM_CAMP = { w: 'Blancs', b: 'Noirs' };
const NOM_PIECE = { k: 'le Roi', q: 'la Dame', r: 'la Tour', b: 'le Fou', n: 'le Cavalier', p: 'le pion' };
const sonde = creerSonde(fetchJson);

const ESSAIS = 'endgameAttempts';
const ETAPES = [['comprendre', '1. Comprendre'], ['voir', '2. Voir'], ['reussir', '3. Réussir']];
const ETATS = { decouvrir: ['○', 'À découvrir'], encours: ['◐', 'En cours'], maitrisee: ['✓', 'Maîtrisée'] };
const COULEUR_FLECHE = { best: 'var(--arrow-best)', alt: 'var(--arrow-alt)', threat: 'var(--arrow-threat)' };
const ONGLETS = [['cours', 'Cours'], ['entrainement', 'Entraînement'], ['mes-finales', 'Mes finales']];
let brouillon = { fen: '', camp: '' };

// lecon : leçon ouverte (null en position libre) ; libre et essais gardent l’essai de chaque écran.
// ex : essai affiché. message : { type, html }. indice : dernier indice demandé.
// correction : { ply, coups, erreur } quand le résultat de chaque coup est affiché.
const P = { lecon: null, etape: 'comprendre', voirPly: 0, libre: null, essais: new Map(), creation: null, etats: null, ex: null, plateau: null, vue: null, message: null, indice: null, correction: null, erreur: null, minuteur: null };

// ------------------------------------------------------------------ progression
async function chargerEtats() {
  const lignes = await store.all(ESSAIS);
  P.etats = progression(LECONS, lignes.map((r) => r.data));
}
function noter(position) {
  return (resultat) => {
    const at = Date.now();
    store.put(ESSAIS, `${position}-${at}-${Math.random().toString(36).slice(2, 8)}`, { position, at, resultat }, { file: 'endgames/attempts.json' })
      .catch(() => toast('Enregistrement de l’essai impossible.', { type: 'err' }));
  };
}
// essais faits ici ou reçus d’un autre appareil
store.onChange(async (info) => {
  if (info.col !== ESSAIS) return;
  try { await chargerEtats(); } catch { return; }
  const vue = document.body.dataset.view;
  if (vue === 'endgames') listerCours();
  else if (vue === 'endgame' && P.lecon) dessinerEtat();
});

const symbole = (etat) => `<span class="eg-etat ${etat}" aria-hidden="true">${ETATS[etat][0]}</span>`;
function texteEtat(e) {
  const nom = ETATS[e.etat][1];
  return e.etat === 'encours' ? `${nom} · ${e.jours} jour${e.jours > 1 ? 's' : ''} réussi${e.jours > 1 ? 's' : ''} sur ${REUSSITES_POUR_MAITRISE}` : nom;
}

function listerCours() {
  const el = $('#eg-cours');
  if (!el || !P.etats) return;
  const familles = resumeFamilles(LECONS, P.etats);
  el.innerHTML = `<div class="card eg-card"><h2>Votre progression</h2>
      <p class="muted small">Une position est maîtrisée après ${REUSSITES_POUR_MAITRISE} réussites sans aide, sur ${REUSSITES_POUR_MAITRISE} jours différents. Un échec remet le compte à zéro.</p>
      <ul class="eg-familles">${Object.entries(FAMILLES).map(([k, nom]) => {
        const f = familles.get(k);
        return `<li><span>${nom}</span><b>${f.maitrisees} sur ${f.total}</b><span class="small muted">maîtrisée${f.maitrisees > 1 ? 's' : ''}</span></li>`;
      }).join('')}</ul></div>
    ${Object.entries(NIVEAUX).map(([n, nom]) => `<div class="card eg-card"><h2>Niveau ${n} · ${nom}</h2><ul class="eg-lecons">${LECONS.filter((l) => l.niveau === Number(n)).map((l) => {
      const e = P.etats.get(l.id);
      return `<li><a href="#/endgames/lecon/${l.id}">${symbole(e.etat)}<span class="eg-titre">${l.titre}</span><span class="small muted">${texteEtat(e)}</span></a></li>`;
    }).join('')}</ul></div>`).join('')}`;
}

// ------------------------------------------------------------------ lancement d’un essai
async function lancer(fen, camp) {
  const depuis = location.hash;
  const ex = await Exercice.creer({ fen, camp, sonde });
  if (location.hash !== depuis) return; // l’utilisateur a changé de page pendant la réponse de la table
  clearTimeout(P.minuteur);
  Object.assign(P, { lecon: null, libre: ex, ex, message: null, indice: null, correction: null, erreur: null });
  P.plateau?.setOrientation(camp);
  location.hash = '#/endgames/play';
}

// ------------------------------------------------------------------ page d’accueil
export function show(el) {
  $('#topbar-soon').textContent = 'Finales';
  const choisi = ONGLETS.some(([k]) => k === local.get('endgamesTab')) ? local.get('endgamesTab') : 'cours';
  el.innerHTML = `<h1 class="page-title">Finales</h1>
    <div class="ptabs" role="tablist" aria-label="Parties du module">${ONGLETS.map(([k, nom]) =>
      `<button type="button" role="tab" id="eg-tab-${k}" aria-controls="eg-panel-${k}" data-k="${k}" aria-selected="${k === choisi}" tabindex="${k === choisi ? 0 : -1}">${nom}</button>`).join('')}</div>
    <section role="tabpanel" id="eg-panel-cours" aria-labelledby="eg-tab-cours">
      <div id="eg-cours"><p class="muted" role="status">Chargement de la progression…</p></div></section>
    <section role="tabpanel" id="eg-panel-entrainement" aria-labelledby="eg-tab-entrainement">
      <div class="card eg-card eg-libre">
        ${miniBoard('4k3/8/3K4/4P3/8/8/8/8', 160)}
        <div><h2>Position libre</h2>
          <p class="muted">Jouez une position de 7 pièces au maximum contre la défense parfaite des tables de finales. Une connexion Internet est nécessaire.</p>
          <p><a class="btn primary" href="#/endgames/setup">Placer les pièces</a></p></div>
      </div>
      <form id="eg-form" class="card eg-card eg-form">
        <label for="eg-fen">Ou coller un FEN (le code texte d’une position)</label>
        <input id="eg-fen" spellcheck="false" autocomplete="off" placeholder="4k3/8/3K4/4P3/8/8/8/8 w - - 0 1" value="${esc(brouillon.fen)}">
        <div class="row"><label for="eg-camp">Je joue</label>
          <select id="eg-camp"><option value="">Le camp au trait</option><option value="w">Les Blancs</option><option value="b">Les Noirs</option></select>
          <button class="btn" type="submit" id="eg-jouer">Jouer</button></div>
        <p id="eg-err" class="small err" role="alert"></p>
      </form>
      ${P.libre && P.libre.etat !== 'fini' ? '<p><a class="btn" href="#/endgames/play">Reprendre l’exercice en cours</a></p>' : ''}
    </section>
    <section role="tabpanel" id="eg-panel-mes-finales" aria-labelledby="eg-tab-mes-finales">
      <div class="card eg-card"><h2>Mes finales</h2><p class="muted">Les finales ratées dans vos parties, à rejouer. Cette partie arrive avec le lot 5.</p></div></section>`;

  const onglets = $$('[role="tab"]', el);
  const choisir = (i) => {
    onglets.forEach((b, j) => {
      b.setAttribute('aria-selected', String(i === j));
      b.tabIndex = i === j ? 0 : -1;
      $('#eg-panel-' + b.dataset.k, el).hidden = i !== j;
    });
    local.set('endgamesTab', onglets[i].dataset.k);
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

  listerCours();
  chargerEtats().then(listerCours).catch(() => {
    const zone = $('#eg-cours', el);
    if (zone) zone.innerHTML = '<p class="msg err" role="alert">Impossible de lire la progression sur cet appareil.</p>';
  });

  $('#eg-camp', el).value = brouillon.camp;
  $('#eg-camp', el).onchange = (e) => { brouillon.camp = e.target.value; };
  $('#eg-fen', el).oninput = (e) => { brouillon.fen = e.target.value; };
  $('#eg-form', el).onsubmit = async (e) => {
    e.preventDefault();
    const erreur = $('#eg-err', el), bouton = $('#eg-jouer', el);
    const lu = lireFen(brouillon.fen, fenError);
    if (lu.erreur) { erreur.textContent = lu.erreur; return; }
    erreur.textContent = '';
    bouton.disabled = true;
    try { await lancer(lu.fen, brouillon.camp || lu.fen.split(' ')[1]); }
    catch (err) { erreur.textContent = err.message; }
    finally { bouton.disabled = false; }
  };
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
      <div id="eg-steps" class="ptabs eg-steps" role="group" aria-label="Étapes de la leçon"></div>
      <p id="eg-state" class="eg-state small"></p>
      <div id="eg-lesson" class="eg-lesson"></div>
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
  if (!P.libre) { location.replace('#/endgames'); return; }
  if (P.vue !== el) construire(el);
  if (P.lecon || P.ex !== P.libre) Object.assign(P, { lecon: null, ex: P.libre, indice: null, correction: null, erreur: null });
  P.plateau.setOrientation(P.ex.camp);
  dessiner();
  planifierReponse();
}

export function leconVue(el, id) {
  $('#topbar-soon').textContent = 'Finales';
  const lecon = leconParId(id);
  if (!lecon) { location.replace('#/endgames'); return; }
  if (P.vue !== el) construire(el);
  if (P.lecon !== lecon) {
    clearTimeout(P.minuteur);
    Object.assign(P, { lecon, etape: 'comprendre', voirPly: 0, ex: P.essais.get(id) ?? null, indice: null, correction: null, erreur: null });
  }
  P.plateau.setOrientation(lecon.camp);
  dessiner();
  if (P.etape === 'reussir') preparerEssai();
  planifierReponse();
  chargerEtats().then(() => { if (P.lecon === lecon) dessinerEtat(); }).catch(() => {});
}

const enJeu = () => !P.lecon || P.etape === 'reussir';

// Crée l’essai d’une leçon (la table n’est nécessaire qu’à l’étape « Réussir »).
async function preparerEssai() {
  const lecon = P.lecon;
  if (!lecon || P.ex || P.creation === lecon.id) return;
  P.creation = lecon.id;
  P.erreur = null;
  dessiner();
  try {
    const ex = await Exercice.creer({ fen: lecon.fen, camp: lecon.camp, sonde, limite: lecon.limite, noter: noter(lecon.id) });
    P.essais.set(lecon.id, ex);
    if (P.lecon === lecon) P.ex = ex;
  } catch (err) {
    if (P.lecon === lecon) P.erreur = err.message;
  } finally {
    if (P.creation === lecon.id) P.creation = null;
  }
  if (P.lecon === lecon && document.body.dataset.view === 'endgame') { dessiner(); planifierReponse(); }
}

// Positions de la ligne montrée à l’étape « Voir ».
function ligneDe(lecon) {
  const chess = new Chess(lecon.fen);
  return lecon.ligne.split(' ').map((san) => chess.move(san));
}

const messageErreur = (err) => { P.erreur = err.message; dessiner(); };

function planifierReponse() {
  clearTimeout(P.minuteur);
  const ex = P.ex;
  if (!enJeu() || !ex?.aLui || P.erreur) return;
  P.minuteur = setTimeout(async () => {
    try {
      if (P.ex === ex && await ex.repondre()) dessiner();
    } catch (err) { if (P.ex === ex) messageErreur(err); }
  }, DELAI_REPONSE);
}

async function monCoup(uci) {
  const ex = P.ex;
  if (!enJeu() || !ex || !ex.aMoi || ex.occupe) { dessiner(); return; }
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
  etape(b) {
    clearTimeout(P.minuteur);
    Object.assign(P, { etape: b.dataset.etape, indice: null, correction: null, erreur: null });
    dessiner();
    if (P.etape === 'reussir') { preparerEssai(); planifierReponse(); }
  },
  aller(b) { allerA(Number(b.dataset.ply)); },
  preparer() { preparerEssai(); },
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
  const note = ex.verdict === 'aide' ? ' Une réussite avec aide ne comptera pas pour la maîtrise.'
    : ex.verdict === 'rate' && atteint ? ' Vous avez atteint l’objectif, mais après une faute : l’essai compte comme raté.' : '';
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
      + suite();
  }
  if (ex.etat === 'faute') {
    return bouton('rejouer', 'Rejouer le coup', { primaire: true }) + bouton('recommencer', 'Recommencer') + bouton('abandonner', 'Terminer l’exercice');
  }
  return relance + bouton('indice', 'Indice', { inactif: !ex.aMoi || P.indice?.niveau === 2 })
    + bouton('rejouer', 'Rejouer le coup', { inactif: !ex.peutRejouer })
    + bouton('recommencer', 'Recommencer', { inactif: !ex.coups.length && !ex.aide && !ex.rate }) + bouton('abandonner', 'Abandonner');
}

function suite() {
  if (!P.lecon) return '<a class="btn" href="#/endgames">Autre position</a>';
  const apres = leconSuivante(P.lecon.id);
  return apres ? `<a class="btn" href="#/endgames/lecon/${apres.id}">Leçon suivante</a>` : '<a class="btn" href="#/endgames">Tous les cours</a>';
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

function allerA(ply) {
  P.voirPly = Math.max(0, Math.min(ligneDe(P.lecon).length, ply));
  dessiner();
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

function dessinerEtat() {
  const zone = $('#eg-state', P.vue);
  const e = P.lecon && P.etats?.get(P.lecon.id);
  zone.hidden = !e;
  zone.innerHTML = e ? `${symbole(e.etat)} ${texteEtat(e)}` : '';
}

// En-tête et étapes de la leçon ; renvoie false quand l’écran n’est pas un essai en cours.
function dessinerLecon() {
  const lecon = P.lecon;
  $('#eg-title', P.vue).textContent = lecon ? lecon.titre : 'Position libre';
  const etapes = $('#eg-steps', P.vue), zone = $('#eg-lesson', P.vue);
  etapes.hidden = !lecon;
  const actif = document.activeElement?.closest('#eg-steps button')?.dataset.etape;
  etapes.innerHTML = lecon ? ETAPES.map(([k, nom]) => `<button type="button" data-action="etape" data-etape="${k}" aria-pressed="${P.etape === k}">${nom}</button>`).join('') : '';
  if (actif) $(`[data-etape="${actif}"]`, etapes)?.focus({ preventScroll: true });
  dessinerEtat();

  const attente = Boolean(lecon) && P.etape === 'reussir' && !P.ex;
  const jeu = enJeu() && !attente;
  for (const id of ['#eg-goal', '#eg-msg', '#eg-actions', '#eg-correction']) $(id, P.vue).hidden = !jeu;
  zone.hidden = jeu;
  if (jeu) { zone.innerHTML = ''; return true; }
  $('#eg-moves', P.vue).innerHTML = '';
  P.plateau.interactive = false;

  if (attente) {
    P.plateau.setPosition(lecon.fen);
    zone.innerHTML = P.erreur
      ? `<p class="msg err" role="alert">${esc(P.erreur)}</p>${bouton('preparer', 'Réessayer', { primaire: true })}`
      : '<p class="muted" role="status">Interrogation de la table de finales…</p>';
    return false;
  }

  if (P.etape === 'comprendre') {
    P.plateau.setPosition(lecon.fen, { arrows: lecon.fleches.map(([from, to, type]) => ({ from, to, color: COULEUR_FLECHE[type] })) });
    for (const c of lecon.cases) P.plateau.hl.add(c);
    P.plateau.render();
    zone.innerHTML = `<p class="eg-but"><b>${lecon.objectif === 1 ? 'Gagnez' : 'Annulez'}</b> avec les ${NOM_CAMP[lecon.camp]}.</p>
      ${lecon.idee.map((t) => `<p>${t}</p>`).join('')}
      <div class="eg-suite">${bouton('etape', 'Voir la ligne', { primaire: true, attributs: 'data-etape="voir"' })}${bouton('etape', 'Jouer la position', { attributs: 'data-etape="reussir"' })}</div>`;
    return false;
  }

  const ligne = ligneDe(lecon);
  const ply = P.voirPly;
  const dernier = ply > 0 ? ligne[ply - 1] : null;
  P.plateau.setPosition(dernier ? dernier.after : lecon.fen, { lastMove: dernier ? [dernier.from, dernier.to] : null });
  const focus = document.activeElement?.closest('#eg-lesson button')?.dataset.cle;
  const nav = (cle, vers, texte, nom, inactif) => bouton('aller', texte, { inactif, attributs: `data-ply="${vers}" data-cle="${cle}" aria-label="${nom}"` });
  zone.innerHTML = `<p class="muted small">La ligne principale, coup par coup. Les touches ← et → fonctionnent aussi.</p>
    <div class="eg-nav">${nav('debut', 0, '⏮', 'Début', ply === 0)}${nav('prec', ply - 1, '‹', 'Coup précédent', ply === 0)}
      <span>${ply} sur ${ligne.length}</span>${nav('suiv', ply + 1, '›', 'Coup suivant', ply === ligne.length)}${nav('fin', ligne.length, '⏭', 'Fin', ply === ligne.length)}</div>
    <div class="eg-moves eg-ligne">${htmlListe(ligne, (m, i) => `<button type="button" class="eg-coup${i + 1 === ply ? ' cur' : ''}" data-action="aller" data-ply="${i + 1}" data-cle="coup${i}">${figSan(m.san, m.color)}</button>`)}</div>
    <div class="eg-suite">${bouton('etape', 'Jouer la position', { primaire: ply === ligne.length, attributs: 'data-etape="reussir"' })}</div>`;
  if (focus) ($(`[data-cle="${focus}"]:not(:disabled)`, zone) || $('.eg-nav .btn:not(:disabled)', zone))?.focus({ preventScroll: true });
  return false;
}

function dessiner() {
  if (!P.vue || !dessinerLecon()) return;
  const ex = P.ex;
  if (!ex) return;

  // échiquier : position jouée, ou position consultée dans la correction
  const ply = P.correction ? P.correction.ply : ex.coups.length;
  const dernier = ply > 0 ? ex.coups[ply - 1] : null;
  const fleches = [];
  if (!P.correction && P.indice?.niveau === 2 && ex.aMoi) fleches.push({ from: P.indice.coup.from, to: P.indice.coup.to, color: 'var(--arrow-best)' });
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

document.addEventListener('keydown', (e) => {
  if (document.body.dataset.view !== 'endgame' || !P.lecon || P.etape !== 'voir' || document.querySelector('dialog[open]')) return;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  const pas = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
  if (pas) { e.preventDefault(); allerA(P.voirPly + pas); }
});
