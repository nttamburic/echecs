// Formats d'affichage partagés (nombres, dates, durées).
// Une seule source pour l'écran, les toasts et les annonces du lecteur d'écran.
// Règles : planche « Formats et textes longs » du canevas.

const NNBSP = ' ';   // espace fine insécable : milliers, avant % ; ! ?
const MINUS = '−';   // vrai signe moins

const nf = (min, max = min) => new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: false,
});
const dec = (x, digits) => nf(digits).format(x);              // 1,2 (virgule, pas de groupement)
const signed = (s) => s.replace(/^-/, MINUS);

/** Évaluation moteur. cp en centipions (point de vue des Blancs), mate en coups signés.
 *  +0,4 · −2,1 · 0,0 · M3 · −M5 */
export function fmtEval(cp, mate = null) {
  if (mate != null && mate !== 0) return (mate < 0 ? MINUS : '') + 'M' + Math.abs(mate);
  const v = Math.round(cp / 10) / 10;
  if (v === 0) return '0,0';
  return (v > 0 ? '+' : '') + signed(dec(v, 1));
}

/** Pourcentage. fmtPct(71.84, 1) → 71,8 % ; fmtPct(52.4) → 52 % */
export function fmtPct(x, digits = 0) {
  return dec(x, digits) + NNBSP + '%';
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const hm = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Date d'une partie. 11:42 · Hier 21:58 · 15 nov. · 3 mars 2025 */
export function fmtGameDate(date, now = new Date()) {
  const d = new Date(date);
  if (sameDay(d, now)) return hm(d);
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Hier ' + hm(d);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** Date relative pour les statuts. à l'instant · il y a 5 min · il y a 2 h · il y a 3 j */
export function fmtAgo(date, now = new Date()) {
  const s = Math.max(0, (now - new Date(date)) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

/** Pendule. 12:47 · 1:05:12 · 0:08,4 (dixièmes sous 10 s) */
export function fmtClock(ms) {
  const t = Math.max(0, ms);
  if (t < 10000) return `0:0${Math.floor(t / 1000)},${Math.floor((t % 1000) / 100)}`;
  const s = Math.floor(t / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`;
}

