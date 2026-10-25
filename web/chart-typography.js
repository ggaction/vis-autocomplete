import { TEXT_GROUPS, chartTextItems, textUnderlines } from '../src/chart-typography.js';
import { canvasGeometry } from './canvas-geometry.js';

const FONTS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New'];
export function createTypographyToolbar(host, chartHost, { read, apply, onError }) {
  let program, underlineProgram, underlineGeometry, highlightKey, underlineOverlay, items = [], selected = new Set(TEXT_GROUPS.map(g => g.id)), hovered = null, active = false, pending, timer, working = false;
  host.classList.add('typography-toolbar'); host.setAttribute('aria-label', 'Chart typography');
  const font = document.createElement('select'); font.id = 'chart-font'; font.setAttribute('aria-label', 'Chart font family'); font.title = 'Font family for the whole chart';
  for (const family of FONTS) font.add(new Option(family, family));
  const menu = document.createElement('details'); menu.className = 'text-group-menu';
  const summary = document.createElement('summary'); summary.setAttribute('aria-label', 'Choose text groups');
  const list = document.createElement('div'); list.className = 'text-group-list'; list.setAttribute('role', 'group'); list.setAttribute('aria-label', 'Text groups');
  menu.append(summary, list);
  const rows = new Map();
  for (const group of [{ id: 'all', label: 'All text' }, ...TEXT_GROUPS]) {
    const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
    input.type = 'checkbox'; input.value = group.id; input.setAttribute('aria-label', group.label); text.textContent = group.label;
    label.append(input, text); list.append(label); rows.set(group.id, { label, input });
    input.addEventListener('change', () => {
      if (group.id === 'all') selected = new Set(input.checked ? TEXT_GROUPS.map(g => g.id) : []);
      else if (input.checked) selected.add(group.id); else selected.delete(group.id);
      refresh();
    });
    label.addEventListener('pointerenter', () => { hovered = group.id === 'all' ? TEXT_GROUPS.map(g => g.id) : [group.id]; highlight(); });
    label.addEventListener('pointerleave', () => { hovered = null; highlight(); });
    input.addEventListener('focus', () => { hovered = group.id === 'all' ? TEXT_GROUPS.map(g => g.id) : [group.id]; highlight(); });
    input.addEventListener('blur', () => { hovered = null; highlight(); });
  }
  const sizeGroup = document.createElement('div'); sizeGroup.className = 'chart-font-size';
  const decrease = document.createElement('button'), increase = document.createElement('button'), size = document.createElement('input');
  decrease.type = increase.type = 'button'; decrease.textContent = '−'; increase.textContent = '+';
  decrease.setAttribute('aria-label', 'Decrease selected font sizes'); increase.setAttribute('aria-label', 'Increase selected font sizes');
  size.type = 'number'; size.min = '6'; size.max = '96'; size.step = '1'; size.id = 'chart-font-size'; size.setAttribute('aria-label', 'Selected text font size'); size.title = 'Font size in chart pixels';
  sizeGroup.append(decrease, size, increase); host.append(font, menu, sizeGroup);
  function request(options) {
    if (options.delta && pending?.delta && JSON.stringify(pending.groups) === JSON.stringify(options.groups)) {
      pending.deltas.push(options.delta);
    } else pending = { ...options, ...(options.delta ? { deltas: [options.delta] } : {}) };
    clearTimeout(timer); timer = setTimeout(flush, 120);
  }
  async function flush() {
    if (working || !pending) return;
    const next = pending; pending = null; working = true;
    try {
      // Preserve every click (including clamping at the bounds), but materialize
      // the final requested sizes only once per burst.
      if (next.delta) await apply({ groups: next.groups, deltas: next.deltas });
      else await apply(next);
    } catch (error) { onError(error.message); }
    finally { working = false; refresh(); if (pending) flush(); }
  }
  font.addEventListener('change', () => request({ fontFamily: font.value }));
  size.addEventListener('change', () => {
    if (size.value === '') return;
    if (!size.checkValidity()) { size.reportValidity(); return; }
    request({ groups: [...selected], fontSize: size.valueAsNumber });
  });
  size.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); size.dispatchEvent(new Event('change')); }
    if (event.key === 'Escape') { pending = null; clearTimeout(timer); refresh(); size.blur(); }
  });
  decrease.addEventListener('click', () => request({ groups: [...selected], delta: -1 }));
  increase.addEventListener('click', () => request({ groups: [...selected], delta: 1 }));
  host.addEventListener('pointerenter', () => { active = true; highlight(); });
  host.addEventListener('pointerleave', () => { active = false; hovered = null; highlight(); });
  host.addEventListener('focusin', highlight);
  host.addEventListener('focusout', () => queueMicrotask(highlight));
  menu.addEventListener('toggle', highlight);
  document.addEventListener('pointerdown', event => { if (!host.contains(event.target)) { menu.open = false; hovered = null; active = false; highlight(false); } });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu.open) { menu.open = false; summary.focus(); } });
  function highlight(force) {
    if (!program || host.hidden || read().resizing || !(force ?? (active || menu.open || host.contains(document.activeElement)))) {
      underlineOverlay?.remove(); underlineOverlay = null; highlightKey = null; return;
    }
    const stage = chartHost.querySelector('.canvas-stage'); if (!stage) return;
    const scale = stage.clientWidth / canvasGeometry(program).width;
    const groups = document.activeElement === font ? TEXT_GROUPS.map(g => g.id) : hovered ?? [...selected];
    if (underlineProgram !== program) { underlineProgram = program; underlineGeometry = textUnderlines(program, TEXT_GROUPS.map(g => g.id)); highlightKey = null; }
    const key = `${scale}:${[...groups].sort().join(',')}`;
    if (key === highlightKey && underlineOverlay?.parentNode === stage) return;
    highlightKey = key;
    underlineOverlay?.remove();
    const overlay = document.createElement('div'); overlay.className = 'text-underlines'; overlay.setAttribute('aria-hidden', 'true');
    underlineOverlay = overlay;
    for (const b of underlineGeometry.filter(b => groups.includes(b.group))) {
      const line = document.createElement('span'); line.dataset.textGroup = b.group;
      Object.assign(line.style, { left: `${b.x*scale}px`, top: `${b.y*scale}px`, width: `${Math.max(2,b.length*scale)}px`,
        transformOrigin: '0 0', transform: `rotate(${b.rotation}rad)` });
      overlay.append(line);
    }
    stage.append(overlay);
  }
  function refresh() {
    const state = read(); const available = state.phase !== 'initial' && state.view;
    host.hidden = !available;
    const busy = state.loading || state.committing || state.resizing;
    if (program !== state.view) { program = state.view; items = available ? chartTextItems(program) : []; }
    const present = new Set(items.map(item => item.group));
    const chosen = [...selected].filter(group => present.has(group));
    const all = chosen.length === present.size && present.size > 0;
    summary.textContent = all ? 'All text' : chosen.length === 1 ? TEXT_GROUPS.find(g => g.id === chosen[0]).label : `${chosen.length} text groups`;
    for (const [id, row] of rows) {
      row.input.checked = id === 'all' ? all : selected.has(id) && present.has(id);
      row.input.indeterminate = id === 'all' && chosen.length > 0 && !all;
      row.input.disabled = busy || id !== 'all' && !present.has(id);
    }
    const fonts = [...new Set(items.map(item => item.fontFamily ?? 'sans-serif'))];
    const family = fonts.length === 1 ? fonts[0] : '';
    for (const option of [...font.options]) if (option.dataset.dynamic) option.remove();
    if (!FONTS.includes(family)) { const option = new Option(family || 'Mixed fonts', family); option.dataset.dynamic = 'true'; option.disabled = !family; font.add(option); }
    font.value = family; font.disabled = busy || !available;
    const sizes = [...new Set(items.filter(item => selected.has(item.group)).map(item => item.fontSize ?? 12))];
    if (document.activeElement !== size || busy) size.value = sizes.length === 1 ? sizes[0] : '';
    size.placeholder = sizes.length > 1 ? 'Mixed' : '—';
    size.disabled = busy || !chosen.length;
    decrease.disabled = size.disabled || sizes.every(value => value <= 6);
    increase.disabled = size.disabled || sizes.every(value => value >= 96);
    highlight();
  }
  return { refresh, mount: highlight };
}
