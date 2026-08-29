/** Scroll-snap number wheel for in-game amounts (no keyboard). */

function numWheelClamp(min, max, value) {
  const n = Number(value);
  const v = Number.isFinite(n) ? n : min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function numWheelValueForScroll(min, max, scrollTop, itemH) {
  const h = itemH > 0 ? itemH : 1;
  const idx = Math.round(scrollTop / h);
  return numWheelClamp(min, max, min + idx);
}

function numWheelScrollForValue(min, max, value, itemH) {
  const v = numWheelClamp(min, max, value);
  return (v - min) * (itemH > 0 ? itemH : 0);
}

function numWheelItemsHtml(min, max) {
  let html = '';
  for (let n = min; n <= max; n++) {
    html += `<div class="num-wheel-item" data-n="${n}">${n}</div>`;
  }
  return html;
}

function numWheelHtml(opts) {
  const min = Number(opts.min);
  const max = Number(opts.max);
  const value = numWheelClamp(min, max, opts.value);
  const size = opts.size === 'lg' ? 'lg' : 'sm';
  const id = opts.id ? `id="${opts.id}"` : '';
  const extra = opts.className ? ` ${opts.className}` : '';
  const change = opts.change ? ` data-change="${opts.change}"` : '';
  const game = opts.gameId != null ? ` data-game="${opts.gameId}"` : '';
  const pid = opts.playerId != null ? ` data-pid="${opts.playerId}"` : '';
  return `<div class="num-wheel num-wheel--${size}${extra}" ${id} data-min="${min}" data-max="${max}" data-value="${value}"${change}${game}${pid} onclick="event.stopPropagation()">
    <div class="num-wheel-vp" onscroll="numWheelOnScroll(this)">${numWheelItemsHtml(min, max)}</div>
    <div class="num-wheel-frame" aria-hidden="true"></div>
  </div>`;
}

function numWheelItemHeight(root) {
  const item = root && root.querySelector('.num-wheel-item');
  return item ? item.offsetHeight : 0;
}

function numWheelReadEl(root) {
  if (!root) return 0;
  const min = Number(root.dataset.min);
  const max = Number(root.dataset.max);
  const vp = root.querySelector('.num-wheel-vp');
  if (!vp) return numWheelClamp(min, max, root.dataset.value);
  return numWheelValueForScroll(min, max, vp.scrollTop, numWheelItemHeight(root));
}

function numWheelSetEl(root, value, smooth) {
  if (!root) return;
  const min = Number(root.dataset.min);
  const max = Number(root.dataset.max);
  const v = numWheelClamp(min, max, value);
  root.dataset.value = String(v);
  const vp = root.querySelector('.num-wheel-vp');
  const h = numWheelItemHeight(root);
  if (!vp || !h) return;
  const top = numWheelScrollForValue(min, max, v, h);
  if (smooth && typeof vp.scrollTo === 'function') vp.scrollTo({ top, behavior: 'smooth' });
  else vp.scrollTop = top;
  root.querySelectorAll('.num-wheel-item').forEach(el => {
    el.classList.toggle('is-selected', Number(el.dataset.n) === v);
  });
}

function numWheelOnScroll(vp) {
  const root = vp && vp.closest && vp.closest('.num-wheel');
  if (!root) return;
  clearTimeout(root._numWheelSnap);
  const v = numWheelReadEl(root);
  root.querySelectorAll('.num-wheel-item').forEach(el => {
    el.classList.toggle('is-selected', Number(el.dataset.n) === v);
  });
  root._numWheelSnap = setTimeout(() => numWheelSnap(root), 90);
}

function numWheelSnap(root) {
  if (!root) return;
  const val = numWheelReadEl(root);
  numWheelSetEl(root, val, true);
  const fn = root.dataset.change;
  if (fn && typeof window !== 'undefined' && typeof window[fn] === 'function') {
    window[fn](root, val);
  }
}

function numWheelSyncAll() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.num-wheel').forEach(root => {
    numWheelSetEl(root, root.dataset.value, false);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    numWheelClamp,
    numWheelValueForScroll,
    numWheelScrollForValue,
    numWheelItemsHtml,
    numWheelHtml,
  };
}
