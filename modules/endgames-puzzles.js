// Onglet « Puzzles de finales » : puzzles de la base Lichess, un par un, au niveau de l'utilisateur.
// Un mauvais coup compte le puzzle comme raté, mais on peut réessayer ; « Puzzle suivant » apparaît une fois le puzzle résolu.
import { Board, announce } from '../board.js';
import { $, esc, toast } from '../core/ui.js';
import * as store from '../core/store.js';
import { loadPack } from '../core/puzzle-data.js';
import { getStats } from '../core/puzzle-stats.js';
import { bilanTheme, choisirPuzzle, nomTheme, THEMES_FINALES } from '../core/finales-puzzles.js';
import { reprise } from '../core/puzzle-reprise.js';
import { PuzzleRun } from './puzzles-engine.js';
import { analyserPuzzle } from './puzzles-analyse.js';

const COL = 'endgamePuzzles';
const REPLY_DELAY = 350;
const S = { seq: 0, board: null, vue: null, timer: null, phase: 'idle', theme: null, pack: null, run: null };

async function lireEssais() {
  const lignes = await store.all(COL);
  return lignes.map((r) => r.data);
}
// niveau de départ d'un thème jamais joué : le niveau du module Puzzles
const departParDefaut = async () => (await getStats()).elo;

// ------------------------------------------------------------------ liste des thèmes (onglet)
export async function listerThemes(zone) {
  try {
    const [essais, depart] = await Promise.all([lireEssais(), departParDefaut()]);
    zone.innerHTML = `<div class="card eg-card"><h2>Puzzles de finales</h2>
      <p class="muted small">Des positions tirées de parties réelles : trouvez la suite gagnante ou salvatrice. Le niveau monte quand vous réussissez et baisse quand vous échouez ; il est propre à chaque thème. Une réussite avec indice ne le change pas.</p>
      <ul class="eg-themes">${THEMES_FINALES.map(([k, nom]) => {
        const b = bilanTheme(k, essais, depart);
        const detail = b.joues ? `${b.reussis} réussi${b.reussis > 1 ? 's' : ''} sans aide sur ${b.joues}` : 'Pas encore joué';
        return `<li><a href="#/endgames/puzzles/${k}"><b>${nom}</b><span class="small muted">Niveau ${b.niveau}</span><span class="small muted">${detail}</span></a></li>`;
      }).join('')}</ul>
      <p class="muted small">Puzzles de la base <a href="https://database.lichess.org/#puzzles" target="_blank" rel="noopener">Lichess</a> (CC0). La première ouverture d’un thème demande Internet.</p></div>`;
  } catch {
    zone.innerHTML = '<p class="msg err" role="alert">Impossible de lire vos résultats sur cet appareil.</p>';
  }
}

// ------------------------------------------------------------------ écran de jeu
export function leave() {
  S.seq++;
  clearTimeout(S.timer);
  S.phase = 'idle';
}

function construire(el) {
  el.innerHTML = `<h1 class="sr-only">Puzzles de finales</h1>
    <div class="left"><div id="egp-board"></div></div>
    <aside class="panel pz-panel" aria-label="Puzzles de finales">
      <div class="phead"><a class="btn small" href="#/endgames/puzzles">← Finales</a><span class="ptitle" id="egp-title"></span></div>
      <div class="popening" id="egp-sub"></div>
      <div id="egp-msg" class="tmsg" role="status" aria-live="polite"></div>
      <div class="tactions">
        <button id="egp-hint" class="btn" type="button">💡 Indice</button>
        <button id="egp-analyse" class="btn" type="button">Analyser la position</button>
        <button id="egp-next" class="btn primary" type="button">Puzzle suivant →</button>
      </div>
      <div class="tstats pz-stats" id="egp-stats"></div>
    </aside>`;
  S.vue = el;
  S.board = new Board($('#egp-board', el), { onMove: (from, to, promo) => monCoup(from, to, promo) });
  $('#egp-hint', el).onclick = indice;
  $('#egp-analyse', el).onclick = analyser;
  $('#egp-next', el).onclick = () => { if (S.phase === 'resolu') suivant(); };
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'endgamepz' || document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(e.target.tagName)) return;
    if ((e.key === 'Enter' || e.key === 'ArrowRight') && S.phase === 'resolu') { suivant(); e.preventDefault(); }
    else if (e.key === 'h' || e.key === 'i') indice();
  });
}

function message(type, html) {
  const m = $('#egp-msg', S.vue);
  m.className = 'tmsg' + (type ? ' ' + type : '');
  m.innerHTML = html;
}

function statistiques() {
  $('#egp-stats', S.vue).innerHTML = `
    <span><b>${S.bilan ? S.bilan.niveau : '–'}</b>niveau</span>
    <span><b>${S.run ? S.run.puzzle.rating : '–'}</b>puzzle</span>
    <span><b>${S.bilan ? S.bilan.reussis : 0}</b>réussis</span>
    <span><b>${S.bilan ? S.bilan.joues : 0}</b>joués</span>`;
}

function echec(err) {
  S.phase = 'idle';
  message('wrong', `${esc(err.message)}<br><button class="btn" id="egp-retry" type="button">Réessayer</button>`);
  $('#egp-retry', S.vue).onclick = () => demarrer(S.vue, S.theme);
}

export async function demarrer(el, theme) {
  if (!nomTheme(theme)) { location.replace('#/endgames'); return; }
  $('#topbar-soon').textContent = 'Finales';
  if (S.vue !== el) construire(el);
  leave();
  const retour = reprise(location.hash);
  if (retour) { retour(); return; }
  const seq = S.seq;
  Object.assign(S, { theme, pack: null, run: null, bilan: null, phase: 'chargement' });
  $('#egp-title', el).textContent = `Puzzles · ${nomTheme(theme)}`;
  $('#egp-sub', el).textContent = '';
  $('#egp-hint', el).classList.add('hidden');
  $('#egp-next', el).classList.add('hidden');
  $('#egp-analyse', el).classList.add('hidden');
  S.board.interactive = false;
  statistiques();
  message('', 'Chargement des puzzles…');
  try {
    const [pack, essais, depart] = await Promise.all([loadPack('theme', theme), lireEssais(), departParDefaut()]);
    if (seq !== S.seq) return;
    S.pack = pack;
    S.essais = essais;
    S.bilan = bilanTheme(theme, essais, depart);
  } catch (err) { if (seq === S.seq) echec(err); return; }
  suivant();
}

function suivant() {
  const puzzle = choisirPuzzle(S.pack, S.bilan.niveau, S.bilan.vus);
  if (!puzzle) { S.phase = 'idle'; message('info', 'Vous avez joué tous les puzzles de ce thème.'); return; }
  let st;
  try {
    S.run = new PuzzleRun(puzzle);
    st = S.run.start();
  } catch (err) { echec(err); return; }
  S.aide = false;
  S.reponse = null;
  S.phase = 'jeu';
  S.board.setOrientation(st.color);
  S.board.setPosition(st.fen, { lastMove: st.lastMove });
  S.board.interactive = true;
  $('#egp-hint', S.vue).classList.remove('hidden');
  $('#egp-analyse', S.vue).classList.remove('hidden');
  $('#egp-next', S.vue).classList.add('hidden');
  const camp = st.color === 'w' ? 'Blancs' : 'Noirs';
  $('#egp-sub', S.vue).textContent = `Trait aux ${camp}`;
  message('', `Trouvez le meilleur coup pour les ${camp}.`);
  statistiques();
}

function indice() {
  if (S.phase !== 'jeu' || !S.run?.expected) return;
  S.aide = true;
  S.board.hl.clear();
  S.board.hl.add(S.run.expected.slice(0, 2));
  S.board.render();
  message('hint', 'Déplacez la pièce mise en évidence.');
}

// Compte le résultat du puzzle, une seule fois (première erreur, analyse ou réussite).
function noter(reussi) {
  if (!S.run.settle(reussi)) return;
  const resultat = !reussi ? 'rate' : S.aide ? 'aide' : 'reussi';
  const at = Date.now();
  const essai = { theme: S.theme, puzzle: S.run.puzzle.id, note: S.run.puzzle.rating, depart: S.bilan.niveau, resultat, at };
  S.essais.push(essai);
  const avant = S.bilan.niveau;
  S.bilan = bilanTheme(S.theme, S.essais, avant);
  statistiques();
  const ecart = S.bilan.niveau - avant;
  if (ecart) $('#egp-sub', S.vue).textContent = `Niveau ${ecart > 0 ? '+' : '−'}${Math.abs(ecart)}`;
  store.put(COL, `${essai.theme}-${essai.puzzle}-${at}`, essai, { file: 'endgames/puzzles.json' })
    .catch(() => toast('Enregistrement du puzzle impossible.', { type: 'err' }));
}

function resolu() {
  S.phase = 'resolu';
  noter(true); // sans effet si le puzzle est déjà compté raté
  S.board.interactive = false;
  if (S.run.verdict) message('ok', S.aide ? 'Résolu (avec indice).' : 'Bien joué !');
  else message('ok', 'Trouvé ! Ce puzzle reste compté comme raté.');
  announce('Puzzle résolu.');
  $('#egp-hint', S.vue).classList.add('hidden');
  const bouton = $('#egp-next', S.vue);
  bouton.classList.remove('hidden');
  bouton.focus({ preventScroll: true });
}

function monCoup(from, to, promo) {
  if (S.phase !== 'jeu') return;
  const res = S.run.move(from, to, promo);
  if (res.illegal) return;
  S.board.hl.clear();
  if (!res.ok) {
    noter(false);
    S.board.render();
    message('wrong', 'Ce n’est pas le bon coup. Réessayez. Le puzzle est compté comme raté.');
    announce('Mauvais coup. Réessayez.');
    return;
  }
  S.board.setPosition(res.fen, { lastMove: res.lastMove });
  if (res.done) { resolu(); return; }
  S.board.interactive = false;
  S.reponse = res.reply;
  S.timer = setTimeout(jouerReponse, REPLY_DELAY);
}

function jouerReponse() {
  if (S.phase !== 'jeu' || !S.reponse) return;
  S.board.setPosition(S.reponse.fen, { lastMove: S.reponse.lastMove });
  S.reponse = null;
  S.board.interactive = true;
  message('ok', 'Bon coup, continuez.');
}

// Avant la solution, consulter le moteur revient à voir la réponse : le puzzle est compté raté.
function analyser() {
  if ((S.phase !== 'jeu' && S.phase !== 'resolu') || !S.run) return;
  const phase = S.phase;
  if (phase === 'jeu') {
    noter(false);
    message('info', 'Position analysée avant la solution : ce puzzle est compté comme raté. Trouvez le coup pour continuer.');
  }
  analyserPuzzle(S.run, { onglet: 'endgames', reprendre: () => { $('#topbar-soon').textContent = 'Finales'; S.phase = phase; jouerReponse(); } });
}
