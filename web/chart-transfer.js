import { refreshChartCanvas } from './chart-canvas.js';
import { fittedChartPose, containedChartPose, chartPoseTransform, chartPoseClip } from './chart-transfer-geometry.js';

let activeTransfer = null;

export function cancelChartTransfer() {
  activeTransfer?.finish();
}

function screenFrame(element, rect) {
  const style = getComputedStyle(element), px = property => parseFloat(style[property]) || 0;
  const width = px('width') + (style.boxSizing === 'border-box' ? 0 : px('paddingLeft') + px('paddingRight') + px('borderLeftWidth') + px('borderRightWidth'));
  const height = px('height') + (style.boxSizing === 'border-box' ? 0 : px('paddingTop') + px('paddingBottom') + px('borderTopWidth') + px('borderBottomWidth'));
  const scaleX = rect.width / (width || element.offsetWidth), scaleY = rect.height / (height || element.offsetHeight);
  return { x: rect.left + px('borderLeftWidth') * scaleX, y: rect.top + px('borderTopWidth') * scaleY, scaleX, scaleY };
}

function visibleViewport(element) {
  const rect = element.getBoundingClientRect(), clip = element.closest('.chart-viewport-clip')?.getBoundingClientRect();
  return clip ? { left: Math.max(rect.left, clip.left), top: Math.max(rect.top, clip.top),
    right: Math.min(rect.right, clip.right), bottom: Math.min(rect.bottom, clip.bottom) } : rect;
}

// Move an independently painted Canvas; never clone an empty Canvas element.
export async function transferChart(source, target, draw, geometry) {
  cancelChartTransfer();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  if (reducedMotion.matches || !source.querySelector('canvas') || !source.animate) return;
  const from = source.getBoundingClientRect(), to = target.getBoundingClientRect();
  if (!from.width || !from.height || !to.width || !to.height) return;
  const sourceClip = visibleViewport(source), targetClip = visibleViewport(target);

  const flight = document.createElement('div');
  flight.className = 'chart-view chart-transfer';
  flight.setAttribute('aria-hidden', 'true');
  Object.assign(flight.style, { left: `${from.left}px`, top: `${from.top}px`,
    width: `${from.width}px`, height: `${from.height}px` });
  draw(flight);
  let startTransform = 'translate(0, 0) scale(1, 1)';
  let endTransform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`;
  let startClip = 'inset(0px 0px 0px 0px)';
  let endClip = startClip;
  if (geometry) {
    // Preview and Current share the native logical canvas.
    // Animate the same native coordinate system between those two viewports,
    // so the picture neither jumps at departure nor changes size on landing.
    const image = source.querySelector('canvas');
    const [x0,y0,width,height] = image.dataset.viewBox.split(' ').map(Number);
    const box = { x:x0, y:y0, width, height };
    const departure = containedChartPose(box, image.getBoundingClientRect());
    const destination = fittedChartPose(geometry, target.clientWidth, target.clientHeight, screenFrame(target, to));
    Object.assign(flight.style, { left: '0px', top: '0px', width: `${geometry.width}px`, height: `${geometry.height}px` });
    startTransform = chartPoseTransform(departure);
    endTransform = chartPoseTransform(destination);
    startClip = chartPoseClip(geometry, departure, sourceClip);
    endClip = chartPoseClip(geometry, destination, targetClip);
  }
  flight.style.transform = startTransform;
  flight.style.clipPath = startClip;
  document.body.append(flight);
  refreshChartCanvas(flight.querySelector('canvas'));
  source.classList.add('chart-transfer-source');
  const movement = flight.animate([
    { transform: startTransform, clipPath: startClip },
    { transform: endTransform, clipPath: endClip },
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
    resizeObserver.disconnect();
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
    const clipChanged = (element, before) => {
      const now = visibleViewport(element);
      return ['left', 'top', 'right', 'bottom'].some(key => Math.abs(now[key] - before[key]) > .5);
    };
    if (moved(source, from) || moved(target, to) || clipChanged(source, sourceClip) || clipChanged(target, targetClip)) transfer.finish();
  }
  const resizeObserver = new ResizeObserver(layoutChanged);
  for (const element of new Set([source, target, source.closest('.chart-viewport-clip'), target.closest('.chart-viewport-clip')].filter(Boolean))) resizeObserver.observe(element);
  window.addEventListener('resize', layoutChanged);
  window.addEventListener('scroll', layoutChanged, { capture: true, passive: true });
  reducedMotion.addEventListener('change', transfer.finish, { once: true });
  try { await movement.finished; }
  catch (error) { if (error.name !== 'AbortError') throw error; }
  finally { transfer.finish(); }
}
