import { refreshChartCanvas } from './chart-canvas.js';

import { zoomCamera } from './chart-camera.js';

// A viewing camera only: the native program, history, exports and option
// thumbnails remain unchanged. Transform the complete view so guides and live
// transition frames stay in exactly the same coordinate system as the chart.
export function createChartZoom(host, toolbar, { busy = () => false, onChange = () => {} } = {}) {
  const clip = host.parentElement;
  let camera = { zoom: 1, x: 0, y: 0 }, active = false, gesture, frame, densityTimer, rasterZoom = 1;
  const controls = document.createElement('div'); controls.className = 'chart-zoom-tools';
  controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', `${host.getAttribute('aria-label')} zoom`);
  function button(text, label, action) {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = text;
    node.setAttribute('aria-label', label); node.title = label; node.addEventListener('click', action); controls.append(node); return node;
  }
  const out = button('−', 'Zoom out', () => change(camera.zoom / 1.2));
  const percent = document.createElement('span'); percent.className = 'chart-zoom-value'; controls.append(percent);
  const inside = button('+', 'Zoom in', () => change(camera.zoom * 1.2));
  button('Fit', 'Fit chart to view', () => reset());
  toolbar.prepend(controls);
  clip.setAttribute('aria-label', `${host.getAttribute('aria-label')} viewport`);
  const size = () => ({ width: clip.clientWidth, height: clip.clientHeight });
  function paint() {
    frame = null;
    active = Boolean(host.querySelector('canvas')) && !host.classList.contains('data-view');
    controls.hidden = !active;
    clip.tabIndex = active ? 0 : -1;
    clip.title = active ? 'Scroll to zoom · drag chart space to pan · double-click to fit' : '';
    host.dataset.chartZoom = String(camera.zoom);
    host.style.transformOrigin = '50% 50%';
    host.style.transform = active ? `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` : '';
    clip.classList.toggle('chart-pannable', active && camera.zoom > 1);
    percent.textContent = `${Math.round(camera.zoom * 100)}%`;
    out.disabled = camera.zoom <= .5; inside.disabled = camera.zoom >= 4;
    if (camera.zoom !== rasterZoom) {
      rasterZoom = camera.zoom; clearTimeout(densityTimer);
      // Wheel/pinch frames move an existing layer. Repaint sharper pixels once
      // the camera settles instead of rerendering every mark on each wheel tick.
      densityTimer = setTimeout(() => {
        for (const canvas of host.querySelectorAll('canvas[data-chart]')) refreshChartCanvas(canvas);
      }, 100);
    }
    onChange();
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(paint); }
  function change(zoom, anchor = { x: 0, y: 0 }) {
    if (!active || busy() || gesture) return;
    camera = zoomCamera(camera, zoom, anchor, size()); schedule();
  }
  function reset(force = false) {
    if (!force && (busy() || gesture)) return;
    if (force) end();
    camera = { zoom: 1, x: 0, y: 0 }; schedule();
  }
  function interactive(event) { return event.target.closest('button, input, select, textarea, a, [contenteditable="true"]'); }
  (clip.closest('.current-shell') ?? clip).addEventListener('wheel', event => {
    if (!active || busy() || gesture || event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
    const rect = clip.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
    change(camera.zoom * Math.exp(-Math.max(-200, Math.min(200, delta)) * .002),
      { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 });
  }, { passive: false });
  clip.addEventListener('pointerdown', event => {
    if (!active || busy() || camera.zoom <= 1 || event.button !== 0 || interactive(event)) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, camera: { ...camera } };
    event.preventDefault(); clip.setPointerCapture(event.pointerId); clip.classList.add('chart-panning');
  });
  clip.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    camera = zoomCamera({ ...camera, x: gesture.camera.x + event.clientX - gesture.x,
      y: gesture.camera.y + event.clientY - gesture.y }, camera.zoom, { x: 0, y: 0 }, size());
    schedule();
  });
  function end(cancel = false) {
    if (!gesture) return;
    const previous = gesture; gesture = null;
    if (cancel) { camera = previous.camera; schedule(); }
    if (clip.hasPointerCapture(previous.id)) clip.releasePointerCapture(previous.id);
    clip.classList.remove('chart-panning');
  }
  clip.addEventListener('pointerup', () => end());
  clip.addEventListener('pointercancel', () => end(true));
  clip.addEventListener('lostpointercapture', () => end(true));
  window.addEventListener('blur', () => end(true));
  clip.addEventListener('dblclick', event => { if (!interactive(event)) reset(); });
  clip.addEventListener('keydown', event => {
    if (interactive(event)) return;
    if (event.key === 'Escape') { end(true); return; }
    if (['+', '=', '-', '0'].includes(event.key) && active) {
      event.preventDefault();
      if (event.key === '0') reset(); else change(camera.zoom * (event.key === '-' ? 1 / 1.2 : 1.2));
    }
  });
  new MutationObserver(schedule).observe(host, { childList: true, subtree: true });
  new ResizeObserver(() => { camera = zoomCamera(camera, camera.zoom, { x: 0, y: 0 }, size()); schedule(); }).observe(clip);
  schedule();
  return { reset: () => reset(true) };
}
