import { readViewPreference, writeViewPreference } from './view-preferences.js';
const storageKey = 'vis-autocomplete.workspace-sizes';
const clamp = (value, min, max) => Math.min(Math.max(min, max), Math.max(min, value));

// Resize mounted panels, never chart programs: resizing a view must not rank
// recommendations, change chart history, or replace its Canvas/card elements.
export function initializeWorkspaceResize({ workspace, reset, busy, beforeChange, afterChange }) {
  const author = workspace.querySelector('.authoring-area');
  const charts = workspace.querySelector('.visualizations');
  const options = workspace.querySelector('.options-section');
  const history = workspace.querySelector('.history-section');
  const code = workspace.querySelector('.code-panel');
  const current = charts.children[0], preview = charts.children[1];
  let preferences = {}, frame = null, drag = null;
  try {
    const stored = JSON.parse(readViewPreference(storageKey));
    for (const mode of ['preview', 'transition']) for (const layout of ['horizontal', 'vertical']) {
      const entry = stored?.[`${mode}:${layout}`];
      if (!entry || typeof entry !== 'object') continue;
      const valid = Object.fromEntries(['code', 'primary', 'history', 'views']
        .filter(name => Number.isFinite(entry[name])).map(name => [name, clamp(entry[name], .05, .95)]));
      if (Object.keys(valid).length) preferences[`${mode}:${layout}`] = valid;
    }
  } catch { /* Optional preference. */ }
  const key = () => `${document.documentElement.dataset.viewMode}:${document.documentElement.dataset.workspaceLayout}`;
  const sizes = () => preferences[key()] ?? {};
  const save = () => { try { writeViewPreference(storageKey, JSON.stringify(preferences)); } catch { /* Still usable. */ } };
  const box = element => element.getBoundingClientRect();
  const gap = element => parseFloat(getComputedStyle(element).gap) || 12;
  const vertical = () => document.documentElement.dataset.workspaceLayout === 'vertical';
  const narrow = () => innerWidth <= 1000;
  const handles = [
    { name: 'code', label: 'Resize ggaction Code', first: author, second: code },
    { name: 'primary', label: 'Resize visualization and option cards', first: charts, second: options },
    { name: 'history', label: 'Resize History', first: author, second: history },
    { name: 'views', label: 'Resize Current and Preview', first: current, second: preview },
  ];
  for (const handle of handles) {
    const element = document.createElement('div');
    element.className = 'workspace-divider'; element.dataset.divider = handle.name;
    element.setAttribute('role', 'separator'); element.tabIndex = 0;
    element.setAttribute('aria-label', handle.label); element.title = `${handle.label} · drag or use arrow keys · double-click to reset`;
    workspace.append(element); handle.element = element;
    element.addEventListener('pointerdown', event => {
      if (event.button !== 0 || busy() || element.hidden) return;
      event.preventDefault(); beforeChange?.(); element.focus({ preventScroll: true });
      const geometry = measure(handle);
      drag = { handle, geometry, start: event[geometry.axis === 'x' ? 'clientX' : 'clientY'], before: structuredClone(preferences), pointer: event.pointerId };
      element.setPointerCapture(event.pointerId);
      workspace.classList.add('resizing-panels');
      workspace.dataset.resizeAxis = geometry.axis;
    });
    element.addEventListener('pointermove', event => {
      if (drag?.handle !== handle) return;
      drag.value = event[drag.geometry.axis === 'x' ? 'clientX' : 'clientY']; schedule();
    });
    const finish = (cancel = false) => {
      if (drag?.handle !== handle) return;
      if (cancel) preferences = drag.before;
      else if (drag.value !== undefined) move(handle, drag.geometry, drag.value - drag.start);
      const pointer = drag.pointer; drag = null;
      if (element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
      workspace.classList.remove('resizing-panels'); delete workspace.dataset.resizeAxis;
      save(); refresh(); afterChange?.();
    };
    element.addEventListener('pointerup', () => finish());
    element.addEventListener('pointercancel', () => finish(true));
    element.addEventListener('lostpointercapture', () => { if (drag?.handle === handle) finish(true); });
    element.addEventListener('keydown', event => {
      if (event.key === 'Escape') { finish(true); return; }
      const geometry = measure(handle);
      const direction = geometry.axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
      if (!direction.includes(event.key) || busy()) return;
      event.preventDefault(); beforeChange?.();
      move(handle, geometry, (event.key === direction[0] ? -1 : 1) * (event.shiftKey ? 40 : 12));
      save(); refresh(); afterChange?.();
    });
    element.addEventListener('dblclick', () => {
      if (busy()) return;
      beforeChange?.(); delete preferences[key()]?.[handle.name]; save(); refresh(); afterChange?.();
    });
  }
  function measure(handle) {
    const a = box(handle.first), b = box(handle.second);
    const axis = handle.name === 'history' ? 'y' : b.x >= a.right - 1 ? 'x' : 'y';
    if (handle.name === 'history') return { axis, span: box(author).height, value: b.height, reverse: true };
    const span = axis === 'x' ? a.width + b.width : a.height + b.height;
    return { axis, span, value: axis === 'x' ? a.width : a.height };
  }
  function move(handle, geometry, delta) {
    const value = (geometry.value + delta * (geometry.reverse ? -1 : 1)) / geometry.span;
    (preferences[key()] ??= {})[handle.name] = clamp(value, 0.05, 0.95);
  }
  function clearStyles() {
    workspace.style.removeProperty('grid-template-columns');
    for (const node of [author, charts]) {
      node.style.removeProperty('grid-template-columns'); node.style.removeProperty('grid-template-rows');
    }
    code.style.removeProperty('height'); author.style.removeProperty('height');
    current.style.removeProperty('height'); preview.style.removeProperty('height');
  }
  function refresh() {
    frame = null;
    if (drag?.value !== undefined) move(drag.handle, drag.geometry, drag.value - drag.start);
    clearStyles();
    const prefs = sizes();
    if (Number.isFinite(prefs.code) && !workspace.classList.contains('code-collapsed')) {
      if (!narrow()) {
        const width = box(workspace).width - gap(workspace);
        const codeWidth = clamp(width * (1 - prefs.code), 210, width - 320);
        workspace.style.gridTemplateColumns = `minmax(0, 1fr) ${codeWidth}px`;
      } else {
        // In the responsive stack the code panel's edge adjusts its own height.
        const height = box(author).height + box(code).height;
        const first = clamp(height * prefs.code, 460, height - 140);
        author.style.height = `${first}px`;
        code.style.height = `${height - first}px`;
      }
    }
    if (vertical() && Number.isFinite(prefs.primary)) {
      const width = box(author).width - gap(author);
      const first = clamp(width * prefs.primary, Math.min(200, width * .35), width - Math.min(240, width * .35));
      author.style.gridTemplateColumns = `${first}px minmax(0, 1fr)`;
    }
    const collapsed = workspace.classList.contains('history-collapsed');
    if (Number.isFinite(prefs.history) || (!vertical() && Number.isFinite(prefs.primary)) || (narrow() && Number.isFinite(prefs.code))) {
      const height = box(author).height;
      const historyHeight = collapsed ? box(history).height : Number.isFinite(prefs.history)
        ? clamp(height * prefs.history, 80, height * .4) : box(history).height;
      if (vertical()) author.style.gridTemplateRows = `minmax(180px, 1fr) ${historyHeight}px`;
      else {
        const available = height - historyHeight - 2 * gap(author);
        const ratio = Number.isFinite(prefs.primary) ? prefs.primary : box(charts).height / (box(charts).height + box(options).height);
        const first = clamp(available * ratio, Math.min(150, available * .3), available - Math.min(180, available * .35));
        author.style.gridTemplateRows = `${first}px minmax(0, 1fr) ${historyHeight}px`;
      }
    }
    if (document.documentElement.dataset.viewMode === 'preview' && Number.isFinite(prefs.views)) {
      const stacked = vertical() || innerWidth <= 650;
      const span = (stacked ? box(charts).height : box(charts).width) - gap(charts);
      const first = clamp(span * prefs.views, Math.min(120, span * .3), span - Math.min(120, span * .3));
      charts.style[stacked ? 'gridTemplateRows' : 'gridTemplateColumns'] = `${first}px minmax(0, 1fr)`;
      if (innerWidth <= 650) { current.style.height = 'auto'; preview.style.height = 'auto'; }
    }
    const origin = box(workspace);
    for (const handle of handles) {
      const { element, name } = handle;
      element.hidden = (name === 'code' && workspace.classList.contains('code-collapsed')) ||
        (name === 'history' && collapsed) || (name === 'views' && document.documentElement.dataset.viewMode !== 'preview');
      if (element.hidden) continue;
      const a = box(handle.first), b = box(handle.second), geometry = measure(handle);
      const x = geometry.axis === 'x';
      const start = x ? (a.right + b.left) / 2 : name === 'history' ? b.top - gap(author) / 2 : (a.bottom + b.top) / 2;
      const left = x ? start - 5 : Math.max(a.left, b.left);
      const top = x ? Math.max(a.top, b.top) : start - 5;
      Object.assign(element.style, { left: `${left - origin.left}px`, top: `${top - origin.top}px`,
        width: `${x ? 10 : Math.min(a.right, b.right) - left}px`, height: `${x ? Math.min(a.bottom, b.bottom) - top : 10}px` });
      element.dataset.axis = geometry.axis;
      element.setAttribute('aria-orientation', x ? 'vertical' : 'horizontal');
      element.setAttribute('aria-valuemin', '5'); element.setAttribute('aria-valuemax', '95');
      element.setAttribute('aria-valuenow', String(Math.round(geometry.value / geometry.span * 100)));
    }
  }
  function schedule() { if (frame === null) frame = requestAnimationFrame(refresh); }
  new ResizeObserver(schedule).observe(workspace);
  for (const node of [author, charts, code, history]) new ResizeObserver(schedule).observe(node);
  new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['data-workspace-layout', 'data-view-mode'] });
  new MutationObserver(schedule).observe(workspace, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', schedule, { passive: true });
  reset.addEventListener('click', () => {
    if (busy() || drag) return;
    beforeChange?.(); preferences = {}; save(); refresh(); afterChange?.();
  });
  refresh();
}
