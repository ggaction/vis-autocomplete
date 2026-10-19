let activeTransfer = null;

export function cancelChartTransfer() {
  activeTransfer?.finish();
}

// Move an independently rendered copy so SVG resource IDs remain unique.
export async function transferChart(source, target, draw) {
  cancelChartTransfer();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  if (reducedMotion.matches || !source.querySelector('svg') || !source.animate) return;
  const from = source.getBoundingClientRect(), to = target.getBoundingClientRect();
  if (!from.width || !from.height || !to.width || !to.height) return;

  const flight = document.createElement('div');
  flight.className = 'chart-view chart-transfer';
  flight.setAttribute('aria-hidden', 'true');
  Object.assign(flight.style, { left: `${from.left}px`, top: `${from.top}px`,
    width: `${from.width}px`, height: `${from.height}px` });
  draw(flight);
  document.body.append(flight);
  source.classList.add('chart-transfer-source');
  const movement = flight.animate([
    { transform: 'translate(0, 0) scale(1, 1)' },
    { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})` },
  ], { duration: 480, easing: 'cubic-bezier(.22, .61, .36, 1)', fill: 'forwards' });
  const departure = target.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
  let finished = false;
  const transfer = { finish() {
    if (finished) return;
    finished = true;
    movement.cancel(); departure.cancel();
    flight.remove(); source.classList.remove('chart-transfer-source');
    window.removeEventListener('resize', transfer.finish);
    window.removeEventListener('scroll', transfer.finish, true);
    reducedMotion.removeEventListener('change', transfer.finish);
    if (activeTransfer === transfer) activeTransfer = null;
  } };
  activeTransfer = transfer;
  // If the layout moves, land immediately instead of flying to stale coordinates.
  window.addEventListener('resize', transfer.finish, { once: true });
  window.addEventListener('scroll', transfer.finish, { capture: true, passive: true });
  reducedMotion.addEventListener('change', transfer.finish, { once: true });
  try { await movement.finished; }
  catch (error) { if (error.name !== 'AbortError') throw error; }
  finally { transfer.finish(); }
}
