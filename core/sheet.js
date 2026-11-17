// Feuille coulissante à 3 crans (replié, mi-hauteur, plein) pour le panneau de la vue partie sur mobile.
// Active seulement quand le CSS empile le panneau (la poignée n'est visible que dans ce cas).
const ORDER = ['min', 'mid', 'max'];

export function initSheet(panel, grab, { onChange } = {}) {
  const heights = () => {
    const h = {};
    const prev = panel.dataset.detent;
    panel.classList.add('measuring');
    panel.style.height = '';
    for (const d of ORDER) { panel.dataset.detent = d; h[d] = panel.offsetHeight; }
    panel.dataset.detent = prev;
    panel.classList.remove('measuring');
    return h;
  };
  const set = (d) => {
    panel.dataset.detent = d;
    panel.style.height = '';
    grab.setAttribute('aria-expanded', String(d !== 'min'));
    if (onChange) onChange(d);
  };
  // toucher la poignée : cran suivant (le dernier revient à mi-hauteur)
  grab.addEventListener('click', () => {
    if (grab.dataset.dragged) { delete grab.dataset.dragged; return; }
    const i = ORDER.indexOf(panel.dataset.detent);
    set(i === 2 ? 'mid' : ORDER[i + 1]);
  });
  grab.addEventListener('keydown', (e) => {
    const i = ORDER.indexOf(panel.dataset.detent);
    if (e.key === 'ArrowUp') { set(ORDER[Math.min(2, i + 1)]); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { set(ORDER[Math.max(0, i - 1)]); e.preventDefault(); }
  });
  // glisser la poignée : la feuille suit le doigt puis se cale sur le cran le plus proche
  let drag = null;
  grab.addEventListener('pointerdown', (e) => {
    drag = { y: e.clientY, h0: panel.offsetHeight, hs: heights(), moved: false };
    grab.setPointerCapture(e.pointerId);
    panel.classList.add('measuring');
  });
  grab.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = drag.y - e.clientY;
    if (Math.abs(dy) > 4) drag.moved = true;
    const lo = drag.hs.min, hi = drag.hs.max;
    panel.style.height = Math.min(hi, Math.max(lo, drag.h0 + dy)) + 'px';
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null;
    panel.classList.remove('measuring');
    if (!d.moved) { panel.style.height = ''; return; }
    grab.dataset.dragged = '1';
    setTimeout(() => delete grab.dataset.dragged, 60); // le clic de fin de geste suit tout de suite ; sans clic (pointercancel), le drapeau ne reste pas
    const cur = panel.offsetHeight;
    const best = ORDER.reduce((a, k) => (Math.abs(d.hs[k] - cur) < Math.abs(d.hs[a] - cur) ? k : a), 'mid');
    set(best);
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
}
