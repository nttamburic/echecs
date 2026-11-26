// Mode Woodpecker : écran de progression (jeu, cycles) et séance de résolution chronométrée.
// Comme dans les autres modes, une erreur compte le puzzle comme raté mais on peut réessayer. Ni indice ni
// analyse avant la solution. Le temps compté est celui passé sur le puzzle, page affichée. Le niveau ne change pas.
import { Board, announce } from '../board.js';
import { $, $$, esc, toast } from '../core/ui.js';
import { loadManifest, loadPack } from '../core/puzzle-data.js';
import { getStats } from '../core/puzzle-stats.js';
import { reprise } from '../core/puzzle-reprise.js';
import {
  TAILLES, TAILLE_DEFAUT, NB_CYCLES, DELAIS, composerJeu, chargerPaquets, nouveauJeu, bilanJeu, prochainPuzzle,
  jeuActif, formatDuree, chrono, lireWoodpecker, enregistrerJeu, enregistrerEssai,
} from '../core/woodpecker.js';
import { PuzzleRun } from './puzzles-engine.js';
import { analyserPuzzle } from './puzzles-analyse.js';

const ACCUEIL = '#/puzzles/woodpecker';
const JOUER = '#/puzzles/woodpecker/jouer';
const REPLY_DELAY = 350;
const S = { seq: 0, vue: 0, board: null, timer: null, tic: null, phase: 'idle', run: null, essai: null, chrono: null };

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const date = (t) => new Date(t).toLocaleDateString('fr-FR');

// ------------------------------------------------------------------ progression
function tableau(bilan, titre) {
  const ligne = (c) => {
    const commence = c.debut !== null;
    const enCours = bilan.courant === c && commence;
    return `<tr${enCours ? ' class="encours"' : ''}><th scope="row">${c.n}</th>
      <td>${c.precision === null ? '–' : `${c.precision} %`}${commence && !c.termine ? `<small>${c.faits} / ${c.total}</small>` : ''}</td>
      <td>${commence ? formatDuree(c.ms) : '–'}${c.moyenne === null ? '' : `<small>${formatDuree(c.moyenne)} par puzzle</small>`}${c.gain === null ? '' : `<small class="${c.gain > 0 ? 'mieux' : ''}">${Math.abs(c.gain)} % ${c.gain >= 0 ? 'plus rapide' : 'plus lent'}</small>`}</td>
      <td>${commence ? pluriel(c.jours, 'jour') : '–'}<small>${pluriel(c.delai, 'jour')} visé${c.delai > 1 ? 's' : ''}</small></td></tr>`;
  };
  return `<table class="wp-table"><caption class="sr-only">${esc(titre)}</caption>
    <thead><tr><th scope="col">Cycle</th><th scope="col">Précision</th><th scope="col">Temps</th><th scope="col">Durée</th></tr></thead>
    <tbody>${bilan.cycles.map(ligne).join('')}</tbody></table>`;
}

function carteActive(jeu, bilan) {
  const c = bilan.courant;
  const commence = c.debut !== null;
  const delai = !commence ? `Durée visée : ${pluriel(c.delai, 'jour')}.`
    : c.jours > c.delai ? `Jour ${c.jours} : la durée visée (${pluriel(c.delai, 'jour')}) est dépassée, continuez à votre rythme.`
      : `Jour ${c.jours} sur ${c.delai} visé${c.delai > 1 ? 's' : ''}.`;
  return `<section class="card wp-actif">
    <h2>Cycle ${c.n} sur ${NB_CYCLES}</h2>
    <p class="muted small">${pluriel(jeu.puzzles.length, 'puzzle')}, créé le ${date(jeu.creeLe)} au niveau ${jeu.niveau}.</p>
    <div class="wp-bar" role="progressbar" aria-label="Avancement du cycle" aria-valuemin="0" aria-valuemax="${c.total}" aria-valuenow="${c.faits}"><span style="width:${(100 * c.faits) / c.total}%"></span></div>
    <p><b>${c.faits} / ${c.total}</b> terminés. ${delai}</p>
    <p class="wp-cta"><a class="btn primary big" href="${JOUER}">${commence ? 'Continuer' : 'Commencer'} le cycle ${c.n}</a></p>
    ${tableau(bilan, 'Résultats par cycle')}
    <p><button type="button" class="btn small danger" id="wp-abandon">Abandonner ce jeu</button></p>
  </section>`;
}

function carteCreation(niveau) {
  return `<section class="card wp-creation">
    <h2>Nouveau jeu</h2>
    <p class="muted small">Un mélange de motifs tactiques de la base Lichess, autour de votre niveau (${niveau}), du plus facile au plus difficile. Le jeu et son ordre ne changent plus ensuite.</p>
    <p class="lbl-up" id="wp-lbl-taille">Nombre de puzzles</p>
    <div class="segctl" role="group" aria-labelledby="wp-lbl-taille">${TAILLES.map((n) => `<button type="button" class="chip" data-taille="${n}" aria-pressed="${n === TAILLE_DEFAUT}">${n}</button>`).join('')}</div>
    <p class="wp-cta"><button type="button" class="btn primary big" id="wp-creer">Créer le jeu</button></p>
    <p id="wp-creer-msg" class="small muted" role="status"></p>
  </section>`;
}

export async function show(el) {
  const vue = ++S.vue;
  const perime = () => vue !== S.vue || location.hash !== ACCUEIL;
  $('#topbar-soon').textContent = 'Woodpecker';
  const tete = `<div class="pz-head"><a href="#/puzzles" class="icon-btn" aria-label="Retour aux puzzles" title="Retour"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></a><h1 class="page-title">Woodpecker</h1></div>`;
  el.innerHTML = tete + '<p class="muted">Chargement…</p>';
  let donnees, stats;
  try {
    [donnees, stats] = await Promise.all([lireWoodpecker(), getStats()]);
  } catch {
    if (!perime()) el.innerHTML = tete + '<p class="tmsg wrong" role="alert">Impossible de lire votre progression sur cet appareil.</p>';
    return;
  }
  if (perime()) return;
  const { jeux, essais } = donnees;
  const actif = jeuActif(jeux, essais);
  const anciens = jeux.filter((j) => j !== actif).sort((a, b) => b.creeLe - a.creeLe);
  el.innerHTML = tete + `
    <p class="pz-lead">Résolvez un jeu fixe de puzzles, puis refaites-le en ${NB_CYCLES} cycles de plus en plus rapides (durées visées : ${DELAIS.join(', ')} jours). Elles sont indicatives et ne bloquent rien.</p>
    ${actif ? carteActive(actif, bilanJeu(actif, essais)) : carteCreation(stats.elo)}
    ${anciens.length ? `<h2 class="pz-gtitle">Jeux précédents</h2>${anciens.map((j) => {
      const b = bilanJeu(j, essais);
      const etat = b.termine ? 'terminé' : j.abandonneLe ? 'abandonné' : 'mis de côté';
      return `<details class="card wp-ancien"><summary>${pluriel(j.puzzles.length, 'puzzle')} du ${date(j.creeLe)} · ${etat}</summary>${tableau(b, `Résultats du jeu du ${date(j.creeLe)}`)}</details>`;
    }).join('')}` : ''}
    <p class="muted small">Puzzles de la base <a href="https://database.lichess.org/#puzzles" target="_blank" rel="noopener">Lichess</a> (CC0). La création d’un jeu demande Internet ; il est ensuite disponible hors ligne.</p>`;

  const abandon = $('#wp-abandon', el);
  if (abandon) abandon.onclick = async () => {
    if (!confirm('Abandonner ce jeu ? Ses résultats restent dans « Jeux précédents », mais vous ne pourrez plus le reprendre.')) return;
    try { await enregistrerJeu({ ...actif, abandonneLe: Date.now() }); } catch { toast('Enregistrement impossible.', { type: 'err' }); return; }
    show(el);
  };
  const creer = $('#wp-creer', el);
  if (!creer) return;
  let taille = TAILLE_DEFAUT;
  const choix = $$('[data-taille]', el);
  for (const b of choix) b.onclick = () => { taille = Number(b.dataset.taille); for (const x of choix) x.setAttribute('aria-pressed', String(x === b)); };
  creer.onclick = async () => {
    const msg = $('#wp-creer-msg', el);
    creer.disabled = true;
    msg.className = 'small muted';
    msg.textContent = 'Préparation du jeu…';
    try {
      const packs = await chargerPaquets(await loadManifest(), loadPack);
      const puzzles = composerJeu(packs, { taille, niveau: stats.elo });
      if (puzzles.length < taille) throw new Error('Pas assez de puzzles disponibles. Vérifiez votre connexion puis réessayez.');
      if (perime()) return;
      await enregistrerJeu(nouveauJeu(puzzles, stats.elo));
      if (!perime()) show(el);
    } catch (err) {
      creer.disabled = false;
      msg.className = 'small err';
      msg.textContent = err.message;
    }
  };
}

// ------------------------------------------------------------------ séance
// Garde le temps du puzzle en cours, pour le reprendre avec le même chronomètre.
function enregistrer() {
  S.essai.ms = S.chrono.lire();
  S.essai.at = Date.now();
  enregistrerEssai({ ...S.essai }).catch(() => toast('Enregistrement du puzzle impossible.', { type: 'err' }));
}

export function leave() {
  S.seq++;
  clearTimeout(S.timer);
  clearInterval(S.tic);
  if (S.phase === 'playing') { S.chrono.arreter(); enregistrer(); }
  S.phase = 'idle';
}

function visibilite() {
  if (S.phase !== 'playing') return;
  if (document.visibilityState === 'hidden') { S.chrono.arreter(); enregistrer(); } else S.chrono.lancer();
}

function build(el) {
  el.innerHTML = `
  <h1 class="sr-only">Woodpecker</h1>
  <div class="left">
    <div class="board-wrap"><div id="wp-board"></div></div>
  </div>
  <aside class="panel pz-panel" id="wp-panel" aria-label="Woodpecker">
    <div class="phead">
      <a href="${ACCUEIL}" class="icon-btn" title="Mettre en pause et voir la progression" aria-label="Mettre en pause et voir la progression"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></a>
      <span class="ptitle" id="wp-title">Woodpecker</span>
    </div>
    <div class="popening" id="wp-sub"></div>
    <div class="wp-clock"><span class="pz-clock" id="wp-clock" role="timer" aria-label="Temps du cycle"></span><span class="muted small" id="wp-clock-label">temps du cycle</span></div>
    <div id="wp-msg" class="tmsg" aria-live="polite"></div>
    <div class="tactions">
      <button id="wp-analyse" class="btn" type="button">Analyser la position</button>
      <button id="wp-next" class="btn primary" type="button">Suivant →</button>
    </div>
    <div class="tstats pz-stats" id="wp-stats"></div>
    <div id="wp-summary" class="pz-summary"></div>
  </aside>`;
  S.board = new Board($('#wp-board', el), { onMove: (from, to, promo) => userMove(from, to, promo) });
  $('#wp-next', el).onclick = () => next();
  $('#wp-analyse', el).onclick = analyse;
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'puzzle' || document.querySelector('dialog[open]')) return;
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(e.target.tagName)) return;
    if ((e.key === 'Enter' || e.key === 'ArrowRight') && S.phase === 'resolved') { next(); e.preventDefault(); }
  });
  document.addEventListener('visibilitychange', visibilite);
}

function setMsg(kind, html) {
  const m = $('#wp-msg');
  m.className = 'tmsg' + (kind ? ' ' + kind : '');
  m.innerHTML = html;
}

const bilanCourant = () => bilanJeu(S.jeu, [...S.essais.filter((e) => !(e.cycle === S.cycle && e.puzzle === S.essai?.puzzle)), ...(S.essai ? [S.essai] : [])]).cycles[S.cycle - 1];

function renderClock() {
  if (!S.essai) return;
  const ici = S.chrono.lire();
  $('#wp-clock').textContent = formatDuree(S.autres + ici);
  const t = $('#wp-time');
  if (t) t.textContent = formatDuree(ici);
}

function renderStats() {
  const c = bilanCourant();
  $('#wp-stats').innerHTML = `
    <span><b>${c.reussis}</b>réussis</span>
    <span><b>${c.rates}</b>ratés</span>
    <span><b>${c.precision === null ? '–' : `${c.precision} %`}</b>précision</span>
    <span><b id="wp-time"></b>ce puzzle</span>`;
  renderClock();
}

export async function start(el) {
  if (!el.dataset.built) { build(el); el.dataset.built = '1'; }
  leave();
  $('#topbar-soon').textContent = 'Woodpecker';
  const retour = reprise(location.hash);
  if (retour) { retour(); return; }
  const seq = S.seq;
  Object.assign(S, { phase: 'loading', run: null, essai: null, jeu: null, cycle: null });
  S.board.interactive = false;
  for (const id of ['#wp-next', '#wp-analyse']) $(id).classList.add('hidden');
  $('#wp-summary').innerHTML = '';
  $('#wp-stats').innerHTML = '';
  $('#wp-sub').textContent = '';
  $('#wp-clock').textContent = '';
  $('#wp-title').textContent = 'Woodpecker';
  setMsg('', 'Chargement…');
  await charger(seq);
}

// Relit la progression avant chaque puzzle : elle peut avoir avancé sur un autre appareil.
async function charger(seq) {
  let donnees;
  try { donnees = await lireWoodpecker(); } catch {
    if (seq !== S.seq) return;
    S.phase = 'idle';
    setMsg('wrong', 'Impossible de lire votre progression sur cet appareil.');
    return;
  }
  if (seq !== S.seq) return;
  const jeu = S.jeu ? donnees.jeux.find((j) => j.id === S.jeu.id && !j.abandonneLe) : jeuActif(donnees.jeux, donnees.essais);
  if (!jeu) { location.replace(ACCUEIL); return; }
  S.jeu = jeu;
  S.essais = donnees.essais.filter((e) => e.jeu === jeu.id);
  if (!S.cycle) {
    const courant = bilanJeu(jeu, S.essais).courant;
    if (!courant) { location.replace(ACCUEIL); return; }
    S.cycle = courant.n;
    $('#wp-title').textContent = `Woodpecker · cycle ${S.cycle} / ${NB_CYCLES}`;
  }
  const suite = prochainPuzzle(jeu, S.essais, S.cycle);
  if (!suite) { finCycle(); return; }
  montrer(suite);
}

function montrer({ index, puzzle, essai }) {
  let st;
  try {
    S.run = new PuzzleRun(puzzle);
    st = S.run.start();
  } catch (err) {
    S.phase = 'idle';
    setMsg('wrong', esc(err.message));
    return;
  }
  const maintenant = Date.now();
  S.essai = essai ? { ...essai } : { jeu: S.jeu.id, cycle: S.cycle, puzzle: puzzle.id, ok: null, fini: false, ms: 0, debut: maintenant, at: maintenant };
  if (S.essai.ok === false) S.run.settle(false); // déjà raté avant une pause
  S.autres = S.essais.filter((e) => e.cycle === S.cycle && e.puzzle !== puzzle.id).reduce((a, e) => a + e.ms, 0);
  S.chrono = chrono(S.essai.ms);
  if (document.visibilityState !== 'hidden') S.chrono.lancer();
  S.reply = null;
  S.phase = 'playing';
  S.board.setOrientation(st.color);
  S.board.setPosition(st.fen, { lastMove: st.lastMove });
  S.board.interactive = true;
  for (const id of ['#wp-next', '#wp-analyse']) $(id).classList.add('hidden');
  const camp = st.color === 'w' ? 'Blancs' : 'Noirs';
  $('#wp-sub').textContent = `Puzzle ${index + 1} / ${S.jeu.puzzles.length} · trait aux ${camp}`;
  setMsg('', S.essai.ok === false ? `Reprise : ce puzzle est déjà compté comme raté. Trouvez le meilleur coup pour les ${camp}.` : `Trouvez le meilleur coup pour les ${camp}.`);
  renderStats();
  clearInterval(S.tic);
  S.tic = setInterval(renderClock, 250);
}

function userMove(from, to, promo) {
  if (S.phase !== 'playing' || !S.run) return;
  const res = S.run.move(from, to, promo);
  if (res.illegal) return;
  if (!res.ok) {
    if (S.run.settle(false)) { S.essai.ok = false; enregistrer(); renderStats(); }
    S.board.render();
    setMsg('wrong', 'Ce n’est pas le bon coup. Réessayez. Le puzzle est compté comme raté.');
    announce('Mauvais coup. Réessayez.');
    return;
  }
  S.board.setPosition(res.fen, { lastMove: res.lastMove });
  if (res.done) { resolu(); return; }
  S.board.interactive = false;
  S.reply = res.reply;
  S.timer = setTimeout(playReply, REPLY_DELAY);
}

function playReply() {
  if (S.phase !== 'playing' || !S.reply) return;
  S.board.setPosition(S.reply.fen, { lastMove: S.reply.lastMove });
  S.reply = null;
  S.board.interactive = true;
  setMsg('ok', 'Bon coup, continuez.');
}

function resolu() {
  S.chrono.arreter();
  clearInterval(S.tic);
  S.phase = 'resolved';
  S.board.interactive = false;
  if (S.run.settle(true)) S.essai.ok = true;
  S.essai.fini = true;
  enregistrer();
  renderStats();
  setMsg('ok', S.essai.ok ? 'Bien joué !' : 'Trouvé ! Ce puzzle reste compté comme raté.');
  announce('Puzzle résolu.');
  const dernier = bilanCourant().termine;
  const btn = $('#wp-next');
  btn.textContent = dernier ? 'Terminer le cycle' : 'Suivant →';
  btn.classList.remove('hidden');
  $('#wp-analyse').classList.remove('hidden');
  btn.focus({ preventScroll: true });
}

function next() {
  if (S.phase !== 'resolved') return;
  S.phase = 'loading';
  S.essai = null;
  charger(S.seq);
}

// Seulement une fois le puzzle résolu : avant, le moteur donnerait la réponse et fausserait le cycle.
function analyse() {
  if (S.phase !== 'resolved') return;
  analyserPuzzle(S.run, { onglet: 'puzzles', reprendre: () => { S.phase = 'resolved'; } });
}

function finCycle() {
  S.phase = 'over';
  S.essai = null;
  S.board.interactive = false;
  const bilan = bilanJeu(S.jeu, S.essais);
  const c = bilan.cycles[S.cycle - 1];
  for (const id of ['#wp-next', '#wp-analyse']) $(id).classList.add('hidden');
  $('#wp-sub').textContent = '';
  $('#wp-stats').innerHTML = '';
  $('#wp-clock').textContent = formatDuree(c.ms);
  setMsg('end', bilan.termine ? `Les ${NB_CYCLES} cycles sont terminés. Bravo !` : `Cycle ${c.n} terminé !`);
  const compare = c.gain === null ? '' : ` · ${Math.abs(c.gain)} % ${c.gain >= 0 ? 'plus rapide' : 'plus lent'} que le cycle ${c.n - 1}`;
  $('#wp-summary').innerHTML = `<div class="pz-big" aria-label="Précision ${c.precision} %">${c.precision} %</div>
    <div class="pz-sub">${c.reussis} / ${c.total} réussis sans erreur</div>
    <div class="pz-sub muted">${formatDuree(c.ms)} en ${pluriel(c.jours, 'jour')}${compare}</div>
    <div class="tactions"><a class="btn" href="${ACCUEIL}">Progression</a>${bilan.termine ? '' : `<button id="wp-suite" class="btn primary" type="button">Commencer le cycle ${c.n + 1}</button>`}</div>`;
  const suite = $('#wp-suite');
  if (suite) { suite.onclick = () => { window.scrollTo(0, 0); start($('#puzzle-view')); }; suite.focus({ preventScroll: true }); }
  announce(`Cycle ${c.n} terminé : précision ${c.precision} %.`);
}
