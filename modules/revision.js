// Module « Révision » : la page d'accueil (révision espacée des erreurs, conversion d'avantages) et
// l'écran d'exercice « Trouvez mieux », aussi ouvert depuis le bilan et les listes d'erreurs.
import { Board, announce } from '../board.js';
import { $, $$, esc, badge, toast } from '../core/ui.js';
import { fmtGameDate, fmtEval } from '../core/format.js';
import { CLASSES } from '../analysis.js';
import { frSan } from '../explain.js';
import { Chess } from '../vendor/chess.js';
import { analyzePosition, analysisSettings, maxTime } from '../core/engine.js';
import * as store from '../core/store.js';
import { JOURS_NOUVELLES, NOUVELLES_PAR_JOUR, evaluer, noteDe, occasionsConversion, verdictConnu } from '../core/revision.js';
import { chargerFile, lireConversions, noterErreur, prendreSeance, retirerConversion } from '../core/revision-store.js';
import { BOOK, figSan, getUser, stashGamePly } from './analyse.js';
import { stashPlay } from './play.js';
import { aUnPseudo } from '../core/joueur.js';

const NOM_PIECE = { k: 'le Roi', q: 'la Dame', r: 'la Tour', b: 'le Fou', n: 'le Cavalier', p: 'un pion' };
const plural = (n, un, plusieurs = un + 's') => `${n} ${n > 1 ? plusieurs : un}`;
const jour = (end) => (end ? fmtGameDate(end * 1000) : '');
const enCoup = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

// ------------------------------------------------------------------ page d'accueil
const H = { el: null, seq: 0, off: null, timer: null };

function ligneConversion(o) {
  const score = o.score.mate !== undefined ? 'mat forcé' : fmtEval(o.color === 'w' ? o.score.cp : -o.score.cp);
  const suivi = o.suivi?.reussie ? '<span class="rv-ok">✓ Réussie</span>' : o.suivi?.essais ? `<span class="muted small">${plural(o.suivi.essais, 'essai')}</span>` : '';
  return `<li class="rv-ligne">
    <span class="rv-texte"><b>${esc(o.adversaire || 'Adversaire inconnu')}</b>
      <span class="muted small">${jour(o.end)} · coup ${o.numero} · avantage ${score} · partie ${o.nulle ? 'nulle' : 'perdue'}</span> ${suivi}</span>
    <button type="button" class="btn${o.suivi?.reussie ? '' : ' primary'}" data-jouer="${esc(o.id)}">${o.suivi?.reussie ? 'Rejouer' : 'Jouer contre Maia'}</button>
    <button type="button" class="btn" data-retirer="${esc(o.id)}" aria-label="Retirer la position contre ${esc(o.adversaire)}">Retirer</button>
  </li>`;
}

async function rendreAccueil() {
  const seq = ++H.seq;
  const user = getUser();
  const entete = '<h1 class="page-title">Révision</h1>';
  if (!aUnPseudo(user)) {
    H.el.innerHTML = `${entete}<p class="muted">Indiquez votre pseudo chess.com dans <a href="#/settings/profile">Paramètres → Profil</a>, puis analysez des parties.</p>`;
    return;
  }
  let file, occasions;
  try {
    const [f, analyses, suivis] = await Promise.all([chargerFile(user, BOOK), store.all('analysis'), lireConversions()]);
    file = f;
    occasions = occasionsConversion(analyses, user, suivis);
  } catch {
    if (seq === H.seq && H.el) H.el.innerHTML = `${entete}<p role="alert">Impossible de charger vos erreurs.</p>`;
    return;
  }
  if (seq !== H.seq || !H.el) return;
  const aFaire = file.dues.length + file.nouvelles.length;
  const etat = aFaire
    ? [file.dues.length && `${file.dues.length} à revoir`, file.nouvelles.length && plural(file.nouvelles.length, 'nouvelle')].filter(Boolean).join(' · ')
    : file.enAttente ? 'Terminé pour aujourd’hui.' : file.cartes ? 'Rien à revoir pour le moment.' : 'Aucune erreur à réviser pour le moment.';
  H.el.innerHTML = `${entete}
    <section class="card rv-bloc" aria-labelledby="rv-rep">
      <h2 id="rv-rep">Trouvez mieux</h2>
      <p class="muted">Vos erreurs stratégiques et vos fautes en finale des ${JOURS_NOUVELLES} derniers jours : retrouvez un meilleur coup.
        Chaque position revient juste avant d’être oubliée, avec ${NOUVELLES_PAR_JOUR} nouvelles par jour au plus.
        Les erreurs tactiques du milieu de jeu se révisent dans <a href="#/puzzles/recommend">Puzzles → Recommandés</a>.</p>
      <p role="status"><b>${etat}</b>${file.enAttente > file.nouvelles.length ? ` <span class="muted">${file.enAttente - file.nouvelles.length} en réserve pour les prochains jours.</span>` : ''}</p>
      ${aFaire ? '<div class="row"><a class="btn primary" href="#/revision/seance">Commencer</a></div>' : ''}
    </section>
    <section class="card rv-bloc" aria-labelledby="rv-conv">
      <h2 id="rv-conv">Convertir l’avantage</h2>
      <p class="muted">Des parties des ${JOURS_NOUVELLES} derniers jours où vous étiez nettement gagnant sans gagner. Reprenez la position contre Maia, au niveau de votre adversaire. La position est réussie si vous gagnez.</p>
      ${occasions.length ? `<ul class="rv-liste">${occasions.map(ligneConversion).join('')}</ul>`
        : '<p class="muted">Aucune position de ce type dans vos parties analysées.</p>'}
    </section>`;
  const parId = new Map(occasions.map((o) => [o.id, o]));
  $$('[data-jouer]', H.el).forEach((b) => {
    b.onclick = () => {
      const o = parId.get(b.dataset.jouer);
      stashPlay({ fen: o.fen, user: o.color, elo: o.elo, label: null,
        etude: { type: 'conversion', id: o.id, retour: { href: '#/revision', texte: 'Retour à la révision' } } });
      location.hash = '#/play';
    };
  });
  $$('[data-retirer]', H.el).forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.retirer;
      try {
        await retirerConversion(id);
        toast('Position retirée.', { type: 'ok', action: { label: 'Annuler', fn: () => retirerConversion(id, false) } });
      } catch { toast('Suppression impossible.'); }
    };
  });
}

const rafraichir = (info) => {
  if (!['analysis', 'strategyWork', 'conversionWork', 'errorCards', 'settings'].includes(info?.col ?? 'analysis')) return;
  clearTimeout(H.timer);
  H.timer = setTimeout(rendreAccueil, 300);
};

export function show(el) {
  $('#topbar-soon').textContent = 'Révision';
  if (!H.el) {
    H.el = el;
    H.off = store.onChange(rafraichir);
    window.addEventListener('cj:games', rafraichir);
    el.innerHTML = '<h1 class="page-title">Révision</h1><p class="muted" role="status">Chargement de vos erreurs…</p>';
  }
  return rendreAccueil();
}

export function leave() {
  if (!H.el) return;
  H.el = null;
  H.seq++;
  clearTimeout(H.timer);
  H.off?.();
  window.removeEventListener('cj:games', rafraichir);
}

// ------------------------------------------------------------------ séance « Trouvez mieux »
// S.essai change à chaque exercice ou départ : une réponse tardive du moteur est alors ignorée.
const S = { vue: null, plateau: null, exercices: [], i: 0, retour: null, espacee: false, bilan: [], essai: 0, ex: null, minuteur: null };

function nouvelEtat(ex) {
  return { ex, fautes: 0, indice: 0, fini: false, solution: false, trouve: null, notee: false, calcul: false, message: null };
}

function construire(el) {
  el.innerHTML = `<h1 class="sr-only">Trouvez mieux</h1>
    <div class="left"><div id="rv-board"></div>
      <div class="board-opts"><button type="button" id="rv-flip" class="btn small">⇅ Retourner</button></div></div>
    <aside class="panel pz-panel" aria-label="Exercice « Trouvez mieux »">
      <div class="phead"><a class="btn small" id="rv-retour"></a><span class="ptitle">Trouvez mieux</span></div>
      <p id="rv-contexte" class="popening"></p>
      <div id="rv-msg" class="tmsg" role="status" aria-live="polite"></div>
      <div id="rv-actions" class="tactions"></div>
      <div id="rv-solution" class="rv-solution"></div>
    </aside>`;
  S.plateau = new Board($('#rv-board', el), { onMove: (from, to, promo) => jouer(from + to + (promo || '')) });
  S.vue = el;
  $('#rv-flip', el).onclick = () => { S.plateau.flip(); dessiner(); };
}

export async function seance(el) {
  $('#topbar-soon').textContent = 'Trouvez mieux';
  if (S.vue !== el) construire(el);
  const essai = ++S.essai;
  const demande = prendreSeance();
  let exercices = demande?.exercices;
  if (!exercices) {
    S.ex = null;
    $('#rv-msg', el).textContent = 'Préparation de la séance…';
    for (const id of ['#rv-contexte', '#rv-actions', '#rv-solution']) $(id, el).innerHTML = '';
    try {
      const f = await chargerFile(getUser(), BOOK);
      exercices = [...f.dues, ...f.nouvelles];
    } catch { exercices = []; toast('Impossible de charger vos erreurs.'); }
    if (essai !== S.essai) return;
  }
  Object.assign(S, { exercices, i: 0, bilan: [], espacee: !demande, retour: demande?.retour ?? { href: '#/revision', texte: 'Révision' } });
  ouvrir(0);
}

function ouvrir(i) {
  S.i = i;
  S.essai++;
  clearTimeout(S.minuteur);
  const ex = S.exercices[i];
  S.ex = ex ? nouvelEtat(ex) : null;
  if (ex) S.plateau.setOrientation(ex.color);
  dessiner();
}

export function leaveSeance() {
  S.essai++;
  clearTimeout(S.minuteur);
}

function position(fen, options = {}) { S.plateau.setPosition(fen, options); }

function noter() {
  const e = S.ex;
  if (!S.espacee || e.notee) return;
  e.notee = true;
  noterErreur(e.ex, noteDe({ fautes: e.fautes, indice: e.indice > 0, solution: e.solution }))
    .catch(() => toast('Résultat non enregistré.'));
}

function terminer() {
  const e = S.ex;
  e.fini = true;
  e.calcul = false;
  noter();
  S.bilan[S.i] = !e.solution && !e.fautes && !e.indice;
  dessiner();
}

function repondre(uci, verdict) {
  const e = S.ex;
  e.calcul = false;
  if (verdict === 'juste') {
    e.trouve = uci;
    terminer();
    return;
  }
  if (verdict === 'proche') e.message = { type: '', texte: 'Bon coup, mais il y a mieux. Cherchez encore.' };
  else {
    e.fautes++;
    noter(); // noté dès la première faute : quitter l'exercice ne l'efface pas
    e.message = { type: 'wrong', texte: verdict === 'partie' ? 'C’est le coup joué dans la partie. Cherchez mieux.' : 'Ce coup n’est pas assez bon. Réessayez.' };
  }
  dessiner();
}

async function jouer(uci) {
  const e = S.ex;
  if (!e || e.fini || e.calcul) { dessiner(); return; }
  const essai = S.essai;
  const chess = new Chess(e.ex.fen);
  try { chess.move(enCoup(uci)); } catch { dessiner(); return; }
  clearTimeout(S.minuteur);
  e.calcul = true;
  e.message = { type: '', texte: 'Stockfish évalue votre coup…' };
  dessiner();
  position(chess.fen(), { lastMove: [uci.slice(0, 2), uci.slice(2, 4)] }); // le coup reste visible pendant le verdict
  S.plateau.interactive = false;
  let verdict = verdictConnu(e.ex, uci);
  if (!verdict) {
    try {
      const st = analysisSettings();
      const r = await analyzePosition(e.ex.fen, uci, { cloud: true, priority: true, depth: st.fixed ? null : st.depth, movetime: maxTime() });
      verdict = evaluer(e.ex.color, r.lines[0].score, r.played.score);
    } catch {
      if (essai !== S.essai) return;
      e.calcul = false;
      e.message = { type: 'wrong', texte: 'Le moteur n’a pas pu évaluer ce coup. Il ne compte pas : réessayez.' };
      dessiner();
      return;
    }
  }
  if (essai !== S.essai) return;
  if (verdict === 'juste') { repondre(uci, verdict); return; }
  // un court instant pour voir le coup refusé avant de revenir à la position
  S.minuteur = setTimeout(() => { if (essai === S.essai) repondre(uci, verdict); }, 500);
}

const lignePv = (fen, pv) => {
  const chess = new Chess(fen);
  const out = [];
  for (const u of pv.slice(0, 6)) {
    const trait = chess.turn(), n = Number(chess.fen().split(' ')[5]);
    let m;
    try { m = chess.move(enCoup(u)); } catch { break; }
    out.push(`${trait === 'w' ? `${n}. ` : out.length ? '' : `${n}… `}${frSan(m.san)}`);
  }
  return out.join(' ');
};

const san = (fen, uci) => { try { return new Chess(fen).move(enCoup(uci)).san; } catch { return uci; } };

function dessiner() {
  if (!S.vue) return;
  const retour = $('#rv-retour', S.vue);
  retour.href = S.retour.href;
  retour.textContent = '← ' + S.retour.texte;
  const msg = $('#rv-msg', S.vue), actions = $('#rv-actions', S.vue), solution = $('#rv-solution', S.vue), contexte = $('#rv-contexte', S.vue);
  const e = S.ex;
  if (!e) {
    const faits = S.exercices.length;
    S.plateau.interactive = false;
    if (!faits) position(new Chess().fen());
    contexte.textContent = '';
    msg.className = 'tmsg end';
    msg.textContent = faits
      ? `Séance terminée : ${plural(S.bilan.filter(Boolean).length, 'position trouvée', 'positions trouvées')} du premier coup sur ${faits}.`
      : 'Rien à réviser pour le moment.';
    actions.innerHTML = `<a class="btn primary" href="${esc(S.retour.href)}">${esc(S.retour.texte)}</a>`;
    solution.innerHTML = '';
    return;
  }
  const { ex } = e;
  contexte.innerHTML = `${S.exercices.length > 1 ? `<b>${S.i + 1} / ${S.exercices.length}</b> · ` : ''}Contre ${esc(ex.adversaire || 'un adversaire inconnu')} · ${jour(ex.end)} · coup ${ex.numero}`;
  const camp = ex.color === 'w' ? 'Blancs' : 'Noirs';

  if (!e.fini) {
    const indice = e.indice ? `<br>Indice : jouez ${NOM_PIECE[new Chess(ex.fen).get(ex.meilleur.slice(0, 2)).type]} en ${ex.meilleur.slice(0, 2)}.` : '';
    msg.className = 'tmsg' + (e.message?.type ? ' ' + e.message.type : '');
    msg.innerHTML = `${e.message ? esc(e.message.texte) : `Trait aux ${camp}. Dans la partie, un meilleur coup existait : trouvez-le.`}${indice}`;
    if (!e.calcul) {
      const marque = e.indice ? { highlights: [{ sq: ex.meilleur.slice(0, 2), color: 'var(--arrow-best)' }] } : {};
      position(ex.fen, { lastMove: ex.precedent, ...marque });
    }
    S.plateau.interactive = !e.calcul;
    actions.innerHTML = `<button type="button" class="btn" data-a="indice"${e.indice || e.calcul ? ' disabled' : ''}>Indice</button>
      <button type="button" class="btn" data-a="solution"${e.calcul ? ' disabled' : ''}>Voir la solution</button>`;
    solution.innerHTML = '';
  } else {
    const trouve = e.trouve ?? ex.meilleur;
    msg.className = 'tmsg ' + (e.solution ? 'wrong' : 'ok');
    msg.innerHTML = e.solution ? `La solution : <b>${figSan(san(ex.fen, ex.meilleur), ex.color)}</b>`
      : `Bien joué : <b>${figSan(san(ex.fen, trouve), ex.color)}</b>${trouve === ex.meilleur ? ', le meilleur coup.' : ', aussi bon que le meilleur coup.'}`;
    S.plateau.interactive = false;
    position(ex.fen, { lastMove: ex.precedent, arrows: [
      { from: ex.joue.slice(0, 2), to: ex.joue.slice(2, 4), color: 'var(--danger)', opacity: 0.7 },
      { from: trouve.slice(0, 2), to: trouve.slice(2, 4), color: 'var(--arrow-best)' },
    ] });
    const dernier = S.i + 1 >= S.exercices.length;
    actions.innerHTML = `<button type="button" class="btn primary" data-a="suivant">${dernier ? 'Terminer' : 'Position suivante'}</button>
      <button type="button" class="btn" data-a="partie">Voir dans la partie</button>`;
    solution.innerHTML = `<dl>
      <dt>Coup joué dans la partie</dt><dd>${CLASSES[ex.gravite] ? badge(ex.gravite, true) : ''} ${figSan(ex.san, ex.color)}</dd>
      <dt>Meilleure suite du moteur</dt><dd>${esc(lignePv(ex.fen, ex.lignes[0]?.pv ?? [ex.meilleur]))}</dd></dl>`;
  }
  $$('[data-a]', actions).forEach((b) => { b.onclick = () => ACTIONS[b.dataset.a](); });
}

const ACTIONS = {
  indice() { S.ex.indice = 1; dessiner(); announce('Indice affiché.'); },
  solution() {
    clearTimeout(S.minuteur);
    S.ex.solution = true;
    terminer();
  },
  suivant() { ouvrir(S.i + 1); },
  partie() {
    const { gameId, ply } = S.ex.ex;
    stashGamePly(gameId, ply + 1);
    location.hash = '#/game/' + encodeURIComponent(gameId);
  },
};
