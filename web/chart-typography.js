import { TEXT_GROUPS, chartTextItems, textUnderlines } from '../src/chart-typography.js';
import { canvasGeometry } from './canvas-geometry.js';
import { selectedGuideTextTargets } from '../src/guide-manipulation.js';

const FONTS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New'];
function fontOption(family, label = family) {
  const option = new Option(label, family);
  option.style.fontFamily = family || 'Arial, sans-serif';
  return option;
}
export function createTypographyToolbar(host, chartHost, { read, apply, onError, selection = () => [], clearSelection, selectLegendScope, canSelectLegendScope = () => true, editing = () => null, alignEditing }) {
  let program, underlineProgram, underlineGeometry, highlightKey, underlineOverlay, items = [], selected = new Set(TEXT_GROUPS.map(g => g.id)), hovered = null, active = false, pending, timer, working = false;
  host.classList.add('typography-toolbar'); host.setAttribute('aria-label', 'Chart typography');
  const font = document.createElement('select'); font.id = 'chart-font'; font.setAttribute('aria-label', 'Chart font family'); font.title = 'Font family for the whole chart';
  for (const family of FONTS) font.add(fontOption(family));
  const menu = document.createElement('details'); menu.className = 'text-group-menu';
  const summary = document.createElement('summary'); summary.setAttribute('aria-label', 'Choose text groups');
  const list = document.createElement('div'); list.className = 'text-group-list'; list.setAttribute('role', 'group'); list.setAttribute('aria-label', 'Text groups');
  menu.append(summary, list);
  const scopes = document.createElement('div'); scopes.className = 'legend-selection-scopes'; scopes.setAttribute('role', 'group'); scopes.setAttribute('aria-label', 'Legend selection scope');
  for (const [part, label] of [['all', 'All legends'], ['legend', 'Legend'], ['title', 'Title'], ['items', 'Items']]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.dataset.legendScope = part; button.setAttribute('aria-label', `Select ${label.toLowerCase()}`);
    button.addEventListener('click', () => { selectLegendScope?.(part); refresh(); }); scopes.append(button);
  }
  const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = 'Clear selection';
  clear.className = 'clear-element-selection'; clear.addEventListener('click', () => { clearSelection?.(); refresh(); });
  list.append(scopes, clear);
  const rows = new Map();
  for (const group of [{ id: 'all', label: 'All text' }, ...TEXT_GROUPS]) {
    const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
    input.type = 'checkbox'; input.value = group.id; input.setAttribute('aria-label', group.label); text.textContent = group.label;
    label.append(input, text); list.append(label); rows.set(group.id, { label, input });
    input.addEventListener('change', () => {
      clearSelection?.();
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
  const alignment = document.createElement('div'); alignment.className = 'chart-text-alignment';
  alignment.setAttribute('role', 'group'); alignment.setAttribute('aria-label', 'Text alignment');
  for (const value of ['left', 'center', 'right']) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.textAlign = value;
    button.setAttribute('aria-label', `Align text ${value}`); button.title = `Align text ${value}`;
    // Simple line icons remain crisp at any display density.
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 16 16'); icon.setAttribute('aria-hidden', 'true');
    for (const [y, width] of [[3,12],[6,8],[9,12],[12,8]]) {
      const line = document.createElementNS(icon.namespaceURI, 'path');
      const x = value === 'left' ? 2 : value === 'right' ? 14-width : 8-width/2;
      line.setAttribute('d', `M${x} ${y}h${width}`); icon.append(line);
    }
    button.append(icon); alignment.append(button);
    button.addEventListener('pointerdown', event => { if (editing()) event.preventDefault(); });
    button.addEventListener('click', () => {
      if (editing()) alignEditing(value); else request({ ...selectedScope(), align: value });
    });
  }
  host.append(alignment);
  const selectedScope = () => {
    const chosen = selection();
    return chosen.length ? { elements: chosen.map(t => t.key) } : { groups: [...selected] };
  };
  function request(options) {
    if (options.delta && pending?.delta && JSON.stringify([pending.groups, pending.elements]) === JSON.stringify([options.groups, options.elements])) {
      pending.deltas.push(options.delta);
    } else pending = { ...options, ...(options.delta ? { deltas: [options.delta] } : {}) };
    clearTimeout(timer); timer = setTimeout(flush, 120);
    if (options.delta) refresh();
  }
  async function flush() {
    if (working || !pending) return;
    const next = pending; pending = null; working = true;
    try {
      // Preserve every click (including clamping at the bounds), but materialize
      // the final requested sizes only once per burst.
      if (next.delta) await apply({ groups: next.groups, elements: next.elements, deltas: next.deltas });
      else await apply(next);
    } catch (error) { onError(error.message); }
    finally { working = false; refresh(); if (pending) flush(); }
  }
  font.addEventListener('change', () => request({ ...(selection().length ? selectedScope() : {}), fontFamily: font.value }));
  size.addEventListener('change', () => {
    if (size.value === '') return;
    if (!size.checkValidity()) { size.reportValidity(); return; }
    request({ ...selectedScope(), fontSize: size.valueAsNumber });
  });
  size.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); size.dispatchEvent(new Event('change')); }
    if (event.key === 'Escape') { pending = null; clearTimeout(timer); refresh(); size.blur(); }
  });
  decrease.addEventListener('click', () => request({ ...selectedScope(), delta: -1 }));
  increase.addEventListener('click', () => request({ ...selectedScope(), delta: 1 }));
  host.addEventListener('pointerenter', () => { active = true; highlight(); });
  host.addEventListener('pointerleave', () => { active = false; hovered = null; highlight(); });
  host.addEventListener('focusin', highlight);
  host.addEventListener('focusout', () => queueMicrotask(highlight));
  menu.addEventListener('toggle', highlight);
  document.addEventListener('pointerdown', event => { if (!host.contains(event.target)) { menu.open = false; hovered = null; active = false; highlight(false); } });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu.open) { menu.open = false; summary.focus(); } });
  function highlight(force) {
    if (!program || host.hidden || read().resizing || selection().length && !hovered || !(force ?? (active || menu.open || host.contains(document.activeElement)))) {
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
    const elements = selection(), direct = elements.length > 0;
    const configs = direct ? selectedGuideTextTargets(program, elements.map(t => t.key)).map(t => t.config) : null;
    const chosen = [...selected].filter(group => present.has(group));
    const all = chosen.length === present.size && present.size > 0;
    summary.textContent = editing()?.label ?? (direct ? elements.length === 1 ? elements[0].label : `${elements.length} selected`
      : all ? 'All text' : chosen.length === 1 ? TEXT_GROUPS.find(g => g.id === chosen[0]).label : `${chosen.length} text groups`);
    summary.title = summary.textContent;
    scopes.hidden = !elements.some(t => t.legendPart); clear.hidden = !direct;
    for (const button of scopes.children) {
      button.disabled = busy || !canSelectLegendScope(button.dataset.legendScope);
      button.setAttribute('aria-pressed', String(elements.some(t => t.legendPart === button.dataset.legendScope)));
    }
    for (const [id, row] of rows) {
      row.input.checked = !direct && (id === 'all' ? all : selected.has(id) && present.has(id));
      row.input.indeterminate = !direct && id === 'all' && chosen.length > 0 && !all;
      row.input.disabled = busy || id !== 'all' && !present.has(id);
    }
    const fonts = [...new Set((configs ?? items).map(item => item.fontFamily ?? 'sans-serif'))];
    const family = fonts.length === 1 ? fonts[0] : '';
    for (const option of [...font.options]) if (option.dataset.dynamic) option.remove();
    if (!FONTS.includes(family)) { const option = fontOption(family, family || 'Mixed fonts'); option.dataset.dynamic = 'true'; option.disabled = !family; font.add(option); }
    font.value = family; font.disabled = busy || !available || direct && !configs.length;
    font.style.fontFamily = family || 'Arial, sans-serif';
    font.title = direct ? 'Font family for selected elements' : 'Font family for the whole chart';
    const sizes = [...new Set((configs ?? items.filter(item => selected.has(item.group))).map(item => item.fontSize ?? 12))];
    if (document.activeElement !== size || busy) size.value = sizes.length === 1 ? sizes[0] : '';
    size.placeholder = sizes.length > 1 ? 'Mixed' : '—';
    size.disabled = busy || !sizes.length;
    // Only our own typography transaction may accept more size steps while
    // committing. Queue them against the next committed view, not stale sizes.
    // Bounds are enforced per step by typographyCalls; until the queue settles,
    // either direction must remain available (e.g. 6 → + → − during rendering).
    const stepsBlocked = !available || !sizes.length || state.loading || state.resizing || state.committing && !working;
    decrease.disabled = stepsBlocked || !working && !pending && sizes.every(value => value <= 6);
    increase.disabled = stepsBlocked || !working && !pending && sizes.every(value => value >= 96);
    const aligns = [...new Set(editing() ? [editing().align]
      : (configs ?? items.filter(item => selected.has(item.group))).map(item => item.align ?? item.textAlign))];
    for (const button of alignment.children) {
      button.disabled = editing() ? false : busy || !available || !sizes.length;
      button.setAttribute('aria-pressed', String(aligns.length === 1 && aligns[0] === button.dataset.textAlign));
    }
    highlight();
  }
  return { refresh, mount: highlight };
}
