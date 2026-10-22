import { canvasGeometry, resizeCanvasAction, fitCanvasViewport, projectCanvasGeometry } from './canvas-geometry.js';
import { presentResizeVector } from './resize-vector.js';

// Pointer capture belongs to the stable host, not to a handle replaced by a new
// worker-rendered SVG. One in-flight preview plus one latest intent bounds work.
export function createCanvasResize(host, callbacks) {
  let geometry, viewport, gesture = null, stage, mountedProgram;
  function mount(program, svg) {
    mountedProgram = program;
    geometry = canvasGeometry(program);
    if (!geometry) return;
    host.classList.add('canvas-editor');
    const display = gesture?.action && !gesture.ended ? projectCanvasGeometry(gesture.geometry, gesture.action) : geometry;
    viewport = fitCanvasViewport(display, host.clientWidth, host.clientHeight);
    const { scale, left, top } = viewport;
    const focusedHandle = gesture && gesture.pointerId === undefined ? gesture.handle
      : host.contains(document.activeElement) ? document.activeElement.dataset.resize : null;
    if (!stage?.isConnected) { stage = document.createElement('div'); stage.className = 'canvas-stage'; }
    Object.assign(stage.style, { width: `${display.width * scale}px`, height: `${display.height * scale}px`,
      marginLeft: `${left}px`, marginTop: `${top}px` });
    svg.setAttribute('viewBox', `0 0 ${geometry.width} ${geometry.height}`);
    if (svg.parentNode !== stage) stage.prepend(svg);
    if (stage.parentNode !== host) host.replaceChildren(stage);
    const projection = display !== geometry
      ? presentResizeVector(svg, geometry, display, gesture.handle.startsWith('canvas'), { scale }) : null;
    let overlay = stage.querySelector('.canvas-resize-overlay');
    if (!overlay) { overlay = document.createElement('div'); overlay.className = 'canvas-resize-overlay'; stage.append(overlay); }
    function frame(kind, x, y, width, height, dimensions = { width, height }) {
      let box = overlay.querySelector(`.${kind}-boundary`);
      const exists = Boolean(box);
      if (!box) { box = document.createElement('div'); box.className = `resize-boundary ${kind}-boundary`; }
      Object.assign(box.style, { left: `${x * scale}px`, top: `${y * scale}px`, width: `${width * scale}px`, height: `${height * scale}px` });
      const label = box.querySelector('.resize-label') ?? document.createElement('span'); label.className = 'resize-label';
      label.textContent = `${kind === 'canvas' ? 'Canvas' : display.facet ? 'All plots' : 'Plot'} ${Math.round(dimensions.width)} × ${Math.round(dimensions.height)}`;
      if (exists) return;
      box.append(label);
      const edges = kind === 'canvas' ? ['e', 's', 'se'] : ['e', 's', 'w', 'se'];
      for (const edge of edges) {
        const button = document.createElement('button'); button.type = 'button';
        button.className = `resize-handle resize-${edge}`; button.dataset.resize = `${kind}-${edge}`;
        button.setAttribute('aria-label', `Resize ${kind} ${edge === 's' ? 'height' : edge === 'se' ? 'width and height' : 'width'}`);
        button.title = `${button.getAttribute('aria-label')} · Drag or use arrow keys · Esc to cancel`;
        box.append(button);
      }
      overlay.append(box);
    }
    frame('canvas', 0, 0, display.width, display.height);
    if (!display.composition || display.facet) {
      // Native layout can lag behind the pointer. Follow the actually painted
      // axis rectangle, using the exact same projection as the image layer.
      const plot = projection?.plot ?? { x: display.x, y: display.y, ...display.plot };
      frame('plot', plot.x, plot.y, plot.width, plot.height, display.plot);
    }
    if (focusedHandle) stage.querySelector(`[data-resize="${focusedHandle}"]`)?.focus({ preventScroll: true });
  }
  function start(handle, event) {
    if (gesture || !callbacks.canStart() || !geometry || !viewport?.scale) return false;
    const context = callbacks.start(handle);
    // Freeze only the pointer-to-native conversion, not the rendered viewport.
    // Re-fitting must never feed back into accumulated pointer displacement.
    gesture = { handle, context, geometry, viewport: { ...viewport }, pointerId: event.pointerId,
      baseKey: JSON.stringify(resizeCanvasAction(geometry, handle, 0, 0)),
      x: event.clientX, y: event.clientY, dx: 0, dy: 0, pending: null, running: false, ended: false, changed: false };
    host.classList.add('resizing'); host.style.setProperty('--resize-cursor', handle.endsWith('se') ? 'nwse-resize' : handle.endsWith('s') ? 'ns-resize' : 'ew-resize');
    return true;
  }
  function move(g, dx, dy) {
    if (g !== gesture || g.ended) return;
    g.dx = dx; g.dy = dy;
    if (Math.abs(dx) + Math.abs(dy) < 1 && !g.changed) return;
    const action = resizeCanvasAction(g.geometry, g.handle, dx, dy);
    const key = JSON.stringify(action);
    if (g.key === key) return;
    g.key = key; g.changed = true; g.pending = key === g.baseKey ? { restore: true } : { action, dx, dy };
    g.action = action;
    if (!g.frame) g.frame = requestAnimationFrame(() => {
      g.frame = null;
      if (g !== gesture || g.ended) return;
      const svg = stage?.querySelector(':scope > svg');
      if (svg) mount(mountedProgram, svg);
      callbacks.motion?.(g.context, g.action);
    });
    pump(g);
  }
  async function pump(g) {
    if (g.running) return;
    g.running = true;
    while (g === gesture && g.pending) {
      const intent = g.pending; g.pending = null;
      if (intent.restore) {
        g.final = null; g.error = null; g.valid = { dx: 0, dy: 0 }; callbacks.cancel(g.context); continue;
      }
      const accept = (prepared, action, dx, dy) => {
        callbacks.preview(g.context, prepared); g.final = action; g.error = null; g.valid = { dx, dy };
      };
      try {
        const prepared = await callbacks.prepare(g.context, intent.action);
        if (g !== gesture) break;
        if (!prepared) continue;
        // Results are serialized, so each is newer than the displayed chart.
        // Paint completed work even during continuous motion; otherwise an
        // always-pending pointer stream would starve live chart/code updates.
        accept(prepared, intent.action, intent.dx, intent.dy);
      } catch (error) {
        if (g !== gesture || g.pending) continue;
        if (error.reason === 'no-change') {
          g.final = null; g.error = null; g.valid = { dx: 0, dy: 0 }; callbacks.cancel(g.context);
        } else if (/overlap|space|margin|bounds|fit/i.test(error.message)) {
          // Respect native text/guide constraints. Find the closest valid point
          // toward this intent instead of losing the entire drag on overshoot.
          const from = g.valid ?? { dx: 0, dy: 0 };
          let low = 0, high = 1, best;
          for (let i = 0; i < 6 && g === gesture && !g.pending; i++) {
            const fraction = (low + high) / 2;
            const dx = from.dx + (intent.dx - from.dx) * fraction, dy = from.dy + (intent.dy - from.dy) * fraction;
            const action = resizeCanvasAction(g.geometry, g.handle, dx, dy);
            try {
              const prepared = await callbacks.prepare(g.context, action);
              if (!prepared) break;
              best = { prepared, action, dx, dy }; low = fraction;
            }
            catch { high = fraction; }
          }
          if (g === gesture && !g.pending) {
            if (best) accept(best.prepared, best.action, best.dx, best.dy);
            else if (!g.final) g.error = error;
          }
        } else g.error = error;
      }
    }
    g.running = false;
    if (g === gesture && g.ended) finish(g);
  }
  async function finish(g) {
    if (g.finishing || g !== gesture) return;
    g.finishing = true;
    cancelAnimationFrame(g.frame);
    try {
      if (g.changed && g.final && !g.error) await callbacks.commit(g.context, g.final);
      else callbacks.cancel(g.context, g.error);
    } finally { if (gesture === g) { gesture = null; host.classList.remove('resizing'); callbacks.end(); } }
  }
  function cancel() {
    if (!gesture || gesture.finishing) return;
    const g = gesture; gesture = null;
    cancelAnimationFrame(g.frame);
    if (g.pointerId !== undefined && host.hasPointerCapture(g.pointerId)) host.releasePointerCapture(g.pointerId);
    host.classList.remove('resizing'); callbacks.cancel(g.context); callbacks.end();
  }
  host.addEventListener('pointerdown', event => {
    const button = event.target.closest('[data-resize]');
    if (!button || event.button !== 0 || !start(button.dataset.resize, event)) return;
    event.preventDefault(); event.stopPropagation(); host.setPointerCapture(event.pointerId);
  });
  host.addEventListener('pointermove', event => {
    const g = gesture;
    if (!g || g.pointerId !== event.pointerId || g.ended) return;
    event.preventDefault();
    move(g, (event.clientX - g.x) / g.viewport.scale, (event.clientY - g.y) / g.viewport.scale);
  });
  host.addEventListener('pointerup', event => {
    const g = gesture;
    if (!g || g.pointerId !== event.pointerId) return;
    move(g, (event.clientX - g.x) / g.viewport.scale, (event.clientY - g.y) / g.viewport.scale);
    g.ended = true; host.releasePointerCapture(event.pointerId);
    if (!g.running) finish(g);
  });
  host.addEventListener('pointercancel', cancel);
  host.addEventListener('lostpointercapture', () => { if (gesture && !gesture.ended) cancel(); });
  window.addEventListener('blur', cancel);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && gesture) { event.preventDefault(); cancel(); } });
  host.addEventListener('keydown', event => {
    const button = event.target.closest('[data-resize]');
    if (!button || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (!start(button.dataset.resize, {})) return;
    const step = event.shiftKey ? 10 : 1, g = gesture;
    move(g, event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0,
      event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0);
    g.ended = true; if (!g.running) finish(g);
  });
  let lastSize = '';
  new ResizeObserver(() => {
    const size = `${host.clientWidth}:${host.clientHeight}`;
    if (size === lastSize) return;
    lastSize = size;
    if (!host.classList.contains('canvas-editor')) return;
    cancel();
    const svg = host.querySelector('.canvas-stage > svg');
    if (svg && mountedProgram) mount(mountedProgram, svg);
  }).observe(host);
  return { mount, cancel,
    clear() { host.classList.remove('canvas-editor'); },
  };
}
