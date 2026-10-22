import { refreshChartCanvas } from './chart-canvas.js';
import { fitCanvasViewport } from './canvas-geometry.js';

let activeTransfer = null;

export function cancelChartTransfer() {
  activeTransfer?.finish();
}

// Move an independently painted Canvas; never clone an empty Canvas element.
export async function transferChart(source, target, draw, geometry) {
  cancelChartTransfer();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  if (reducedMotion.matches || !source.querySelector('canvas') || !source.animate) return;
  const from = source.getBoundingClientRect(), to = target.getBoundingClientRect();
  if (!from.width || !from.height || !to.width || !to.height) return;

  const flight = document.createElement('div');
  flight.className = 'chart-view chart-transfer';
  flight.setAttribute('aria-hidden', 'true');
  Object.assign(flight.style, { left: `${from.left}px`, top: `${from.top}px`,
    width: `${from.width}px`, height: `${from.height}px` });
  draw(flight);
  let startTransform = 'translate(0, 0) scale(1, 1)';
  let endTransform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`;
  let startClip = 'inset(0px 0px 0px 0px)';
  if (geometry) {
    // Preview and Current share the native logical canvas.
    // Animate the same native coordinate system between those two viewports,
    // so the picture neither jumps at departure nor changes size on landing.
    const image = source.querySelector('canvas');
    const [x0,y0,width,height] = image.dataset.viewBox.split(' ').map(Number);
    const box = { x:x0, y:y0, width, height };
    const scale = Math.min(from.width / box.width, from.height / box.height);
    const x = from.left + (from.width - box.width * scale) / 2 - box.x * scale;
    const y = from.top + (from.height - box.height * scale) / 2 - box.y * scale;
    const destination = fitCanvasViewport(geometry, target.clientWidth, target.clientHeight);
    Object.assign(flight.style, { left: '0px', top: '0px', width: `${geometry.width}px`, height: `${geometry.height}px` });
    startTransform = `translate(${x}px, ${y}px) scale(${scale})`;
    endTransform = `translate(${to.left + destination.left}px, ${to.top + destination.top}px) scale(${destination.scale})`;
    startClip = `inset(${Math.max(0, (from.top - y) / scale)}px ${Math.max(0, geometry.width - (from.right - x) / scale)}px ${Math.max(0, geometry.height - (from.bottom - y) / scale)}px ${Math.max(0, (from.left - x) / scale)}px)`;
  }
  flight.style.transform = startTransform;
  flight.style.clipPath = startClip;
  document.body.append(flight);
  refreshChartCanvas(flight.querySelector('canvas'));
  source.classList.add('chart-transfer-source');
  const movement = flight.animate([
    { transform: startTransform, clipPath: startClip },
    { transform: endTransform, clipPath: 'inset(0px 0px 0px 0px)' },
  ], { duration: 560, easing: 'cubic-bezier(.22, .61, .36, 1)', fill: 'forwards' });
  const departure = target.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
  let finished = false;
  const transfer = { finish() {
    if (finished) return;
    finished = true;
    movement.cancel(); departure.cancel();
    flight.remove(); source.classList.remove('chart-transfer-source');
    window.removeEventListener('resize', layoutChanged);
    window.removeEventListener('scroll', layoutChanged, true);
    reducedMotion.removeEventListener('change', transfer.finish);
    if (activeTransfer === transfer) activeTransfer = null;
  } };
  activeTransfer = transfer;
  // Code/history/cards can scroll during Apply without moving either chart.
  // Only an actual change of endpoint geometry invalidates the flight.
  function layoutChanged() {
    const moved = (element, rect) => {
      const now = element.getBoundingClientRect();
      return ['left', 'top', 'width', 'height'].some(key => Math.abs(now[key] - rect[key]) > 0.5);
    };
    if (moved(source, from) || moved(target, to)) transfer.finish();
  }
  window.addEventListener('resize', layoutChanged);
  window.addEventListener('scroll', layoutChanged, { capture: true, passive: true });
  reducedMotion.addEventListener('change', transfer.finish, { once: true });
  try { await movement.finished; }
  catch (error) { if (error.name !== 'AbortError') throw error; }
  finally { transfer.finish(); }
}
