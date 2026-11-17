// Formats d'affichage partagés (nombres, dates, durées) — à placer dans core/format.js.
// Une seule source pour l'écran, les toasts et les annonces du lecteur d'écran.
// Règles : planche « Formats et textes longs » du canevas.

const NNBSP = ' ';   // espace fine insécable : milliers, avant % ; ! ?
const MINUS = '−';   // vrai signe moins

const nf = (min, max = min) => new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: false,
});
const dec = (x, digits) => nf(digits).format(x);              // 1,2 (virgule, pas de groupement)
const signed = (s) => s.replace(/^-/, MINUS);

/** Entier : sans séparateur jusqu'à 9999, espace fine au-delà. 412 · 2200 · 18 402 */
export function fmtInt(n) {
  const s = String(Math.round(Math.abs(n)));
  const g = s.length > 4 ? s.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP) : s;
  return (n < 0 ? MINUS : '') + g;
}

/** Évaluation moteur. cp en centipions (point de vue des Blancs), mate en coups signés.
 *  +0,4 · −2,1 · 0,0 · M3 · −M5 */
export function fmtEval(cp, mate = null) {
  if (mate != null && mate !== 0) return (mate < 0 ? MINUS : '') + 'M' + Math.abs(mate);
  const v = Math.round(cp / 10) / 10;
  if (v === 0) return '0,0';
  return (v > 0 ? '+' : '') + signed(dec(v, 1));
}

/** Perte d'un coup en pions. « perte ≈ 2,5 pions » */
export function fmtLoss(cp) {
  const v = Math.abs(cp) / 100;
  return `perte ≈ ${dec(v, 1)} pion${v >= 2 ? 's' : ''}`;
}

/** Pourcentage. fmtPct(71.84, 1) → 71,8 % ; fmtPct(52.4) → 52 % */
export function fmtPct(x, digits = 0) {
  return dec(x, digits) + NNBSP + '%';
}

/** Nœuds par seconde. 850 k nœuds/s · 1,2 M nœuds/s */
export function fmtNps(n) {
  if (n >= 1e6) return dec(n / 1e6, 1) + ' M nœuds/s';
  if (n >= 1e3) return Math.round(n / 1e3) + ' k nœuds/s';
  return n + ' nœuds/s';
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

/** Échéance de révision. aujourd'hui · demain · dans 4 j */
export function fmtDue(date, now = new Date()) {
  const a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(date); b.setHours(0, 0, 0, 0);
  const days = Math.round((b - a) / 86400000);
  if (days <= 0) return 'aujourd’hui';
  if (days === 1) return 'demain';
  return `dans ${days} j`;
}

/** Pendule. 12:47 · 1:05:12 · 0:08,4 (dixièmes sous 10 s) */
export function fmtClock(ms) {
  const t = Math.max(0, ms);
  if (t < 10000) return `0:0${Math.floor(t / 1000)},${Math.floor((t % 1000) / 100)}`;
  const s = Math.floor(t / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`;
}

const TC = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', daily: 'Par jour', classical: 'Rapide' };
/** Cadence chess.com. ('blitz', '180+2') → Blitz 3+2 ; ('daily', '1/259200') → Par jour (3 j) */
export function fmtTimeControl(timeClass, tc = '') {
  const name = TC[timeClass] || timeClass;
  if (timeClass === 'daily') {
    const sec = Number(String(tc).split('/')[1]);
    return sec ? `${name} (${Math.round(sec / 86400)} j)` : name;
  }
  const [base, inc = '0'] = String(tc).split('+');
  return base ? `${name} ${Math.round(Number(base) / 60)}+${inc}` : name;
}

/** Durée estimée. ≈ 40 s · ≈ 6 min · ≈ 1 h 20 */
export function fmtEta(sec) {
  if (sec < 60) return `≈ ${Math.max(5, Math.round(sec / 5) * 5)} s`;
  if (sec < 3600) return `≈ ${Math.round(sec / 60)} min`;
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return m ? `≈ ${h} h ${String(m).padStart(2, '0')}` : `≈ ${h} h`;
}

/** Numéro de coup devant un SAN déjà converti en figurines. ply 0 = premier coup blanc.
 *  (30, '♗b3') → 16. ♗b3 ; (11, 'a6') → 6… a6 */
export function fmtMove(ply, san) {
  const n = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${n}. ${san}` : `${n}… ${san}`;
}
