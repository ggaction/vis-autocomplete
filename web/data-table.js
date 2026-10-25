import { selectionFields } from '../src/field-selection.js';
// The chart uses all rows. The table mounts only the visible row/column window.
const mounted = new WeakMap();
export const TABLE_ROW_HEIGHT = 24, TABLE_COLUMN_WIDTH = 58, TABLE_HEADER_HEIGHT = 30;
export function tableWindow({ rowCount, columnCount, scrollTop = 0, scrollLeft = 0, width = 600, height = 250, overscanRows = 4, overscanColumns = 2 }) {
  const firstRow = Math.max(0, Math.floor(Math.max(0, scrollTop - TABLE_HEADER_HEIGHT) / TABLE_ROW_HEIGHT) - overscanRows);
  const rowStart = Math.min(rowCount, firstRow), rowEnd = Math.min(rowCount, Math.max(rowStart, firstRow + Math.ceil(height / TABLE_ROW_HEIGHT) + overscanRows * 2));
  const firstColumn = Math.max(0, Math.floor(scrollLeft / TABLE_COLUMN_WIDTH) - overscanColumns);
  const columnStart = Math.min(columnCount, firstColumn), columnEnd = Math.min(columnCount, Math.max(columnStart, firstColumn + Math.ceil(width / TABLE_COLUMN_WIDTH) + overscanColumns * 2));
  return { rowStart, rowEnd, columnStart, columnEnd, top: rowStart * TABLE_ROW_HEIGHT,
    bottom: (rowCount - rowEnd) * TABLE_ROW_HEIGHT, left: columnStart * TABLE_COLUMN_WIDTH, right: (columnCount - columnEnd) * TABLE_COLUMN_WIDTH };
}
export function columnSelectionChange(selection, name) {
  if (Array.isArray(selection.fields)) {
    const fields = selectionFields(selection);
    return { fields: fields.includes(name) ? fields.filter(field => field !== name) : [...fields, name] };
  }
  const assigned = ['x', 'y', 'color'].filter(channel => selection[channel] === name);
  if (assigned.length) return Object.fromEntries(assigned.map(channel => [channel, '']));
  const next = ['x', 'y', 'color'].find(channel => !selection[channel]);
  return next ? { [next]: name } : null;
}

export function renderDataTable(host, { rows, profile, selection, onChange, controlsHost, onSchemaEdit }) {
  mounted.get(host)?.destroy(); host.replaceChildren(); host.classList.add('data-view');
  let currentSelection = selection, fieldIndexes = profile.fields.map((_, index) => index), previousWindow, frame, disposed = false;
  const fields = new Map(profile.fields.map((field, index) => [field.name, { field, index }]));
  const freeSelection = Array.isArray(selection.fields);
  const nextChannel = () => ['x', 'y', 'color'].find(channel => !currentSelection[channel]);
  const create = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
  const controls = create('div', 'selection-controls'), inputs = {}, slots = {};
  for (const [channel, title] of freeSelection ? [] : [['x', 'X'], ['y', 'Y'], ['color', 'Color']]) {
    const label = create('label'), caption = create('span', 'selection-caption', title); label.append(caption);
    const select = create('select'); select.id = `select-${channel}`; select.setAttribute('aria-label', `Encode ${channel === 'color' ? channel : title}`);
    const blank = create('option', '', channel === 'color' ? 'None' : 'Select variable'); blank.value = ''; select.append(blank);
    for (const field of profile.fields) { const option = create('option', '', field.name); option.value = field.name; option.disabled = !field.usable; select.append(option); }
    select.addEventListener('change', () => { onChange({ [channel]: select.value }); if (select.value) reveal(select.value); });
    const empty = create('span', 'selection-empty', 'Click a column'); inputs[channel] = select; slots[channel] = { label, empty };
    label.append(empty, select); controls.append(label);
  }
  const toolbar = create('div', 'data-table-tools');
  const search = create('input', 'data-field-search'); search.type = 'search'; search.placeholder = 'Find a field'; search.setAttribute('aria-label', 'Find a dataset field');
  const typeFilter = create('select', 'data-field-filter'); typeFilter.setAttribute('aria-label', 'Filter dataset fields');
  for (const [value, label] of [['all', 'All fields'], ['selected', 'Selected'], ['quantitative', 'Number'], ['nominal', 'Category'], ['ordinal', 'Ordered'], ['temporal', 'Date / time']]) {
    const option = create('option', '', label); option.value = value; typeFilter.append(option);
  }
  toolbar.append(search, typeFilter);
  if (onSchemaEdit) { const edit = create('button', 'data-schema-edit', 'Types'); edit.type = 'button'; edit.setAttribute('aria-label', 'Review dataset field types'); edit.addEventListener('click', onSchemaEdit); toolbar.append(edit); }
  const count = create('span', 'data-field-count'); count.setAttribute('role', 'status'); toolbar.append(count);
  const scroll = create('div', 'data-table-scroll'); scroll.tabIndex = 0; scroll.setAttribute('aria-label', 'Dataset table');
  const table = create('table', 'dataset-table virtual-dataset-table'); table.setAttribute('aria-rowcount', String(rows.length + 1)); table.setAttribute('aria-colcount', String(profile.fields.length));
  const columns = create('colgroup'), head = create('thead'), header = create('tr'), body = create('tbody'); head.append(header); table.append(columns, head, body); scroll.append(table); host.append(toolbar, scroll);
  controlsHost.replaceChildren(controls); controlsHost.hidden = false;
  const roles = new Map(), feedback = { hover: -1, focus: -1, pressed: -1, confirmed: -1 };
  const fitLabel = role => {
    if (!role) return;
    const viewport = scroll.getBoundingClientRect(), cell = role.cell.getBoundingClientRect();
    role.fullLabel.style.setProperty('--column-label-max-width', `${Math.max(58, scroll.clientWidth - 2)}px`);
    role.fullLabel.style.removeProperty('--column-label-width');
    const span = Math.ceil(role.fullLabel.offsetWidth / Math.max(1, cell.width)) * cell.width;
    role.fullLabel.style.setProperty('--column-label-width', `${span}px`);
    const width = role.fullLabel.offsetWidth, preferred = cell.left + width <= viewport.right - 1 ? cell.left : cell.right - width;
    const left = Math.max(viewport.left + 1, Math.min(preferred, viewport.right - width - 1));
    role.fullLabel.style.setProperty('--column-label-shift', `${left - cell.left}px`);
  };
  const paintRole = role => {
    const { field, index, col, cell, button, badge, fullBadge } = role, assigned = freeSelection ? (selectionFields(currentSelection).includes(field.name) ? ['selected'] : [])
      : ['x', 'y', 'color'].filter(channel => currentSelection[channel] === field.name);
    badge.textContent = assigned.map(channel => channel === 'selected' ? '✓' : channel === 'color' ? 'C' : channel.toUpperCase()).join(' · '); fullBadge.textContent = badge.textContent;
    for (const node of [col, cell]) {
      node.classList.toggle('encoded-column', assigned.length > 0);
      for (const [kind, value] of Object.entries(feedback)) node.classList.toggle(`column-${kind}`, value === index);
    }
    button.setAttribute('aria-pressed', String(assigned.length > 0));
    button.title = freeSelection && field.usable ? `${field.name} · ${assigned.length ? 'Deselect' : 'Select'}` : !field.usable ? `${field.name} · ${field.reason || 'Review field type and missing values.'}` : assigned.length
      ? `${field.name} · Clear ${assigned.map(channel => channel === 'color' ? 'Color' : channel.toUpperCase()).join(' / ')}`
      : nextChannel() ? `${field.name} · Encode ${nextChannel()}` : field.name;
    button.disabled = !field.usable || !freeSelection && !assigned.length && !nextChannel();
    cell.title = button.title;
  };
  const setFeedback = (kind, index) => {
    if (feedback[kind] === index) return;
    const previous = roles.get(feedback[kind]); feedback[kind] = index;
    if (previous) paintRole(previous); const next = roles.get(index); if (next) { paintRole(next); if (kind === 'hover' || kind === 'focus') fitLabel(next); }
  };
  const horizontalSpacer = (width, target) => {
    const col = create('col', 'virtual-column-spacer'); col.style.width = `${width}px`; columns.append(col);
    const cell = create('th', 'virtual-column-spacer'); cell.style.width = `${width}px`; cell.setAttribute('aria-hidden', 'true'); target.append(cell);
  };
  const drawColumns = window => {
    columns.replaceChildren(); header.replaceChildren(); roles.clear();
    if (window.left) horizontalSpacer(window.left, header);
    for (let n = window.columnStart; n < window.columnEnd; n++) {
      const index = fieldIndexes[n], field = profile.fields[index], col = create('col'); columns.append(col);
      const cell = create('th'); cell.scope = 'col'; cell.dataset.columnIndex = index; cell.setAttribute('aria-colindex', String(index + 1));
      const button = create('button', 'column-select'); button.type = 'button'; button.dataset.field = field.name; button.setAttribute('aria-label', `Select column ${field.name}`);
      const name = create('span', 'column-name', field.name), badge = create('span', 'column-roles');
      const fullLabel = create('span', 'column-full-label'); fullLabel.setAttribute('aria-hidden', 'true');
      const fullName = create('span', 'column-full-name', field.name), fullBadge = create('span', 'column-roles');
      fullLabel.append(fullName, fullBadge); button.append(name, badge); cell.append(button, fullLabel); header.append(cell);
      const role = { index, field, col, cell, button, badge, fullLabel, fullBadge }; roles.set(index, role); paintRole(role);
    }
    if (window.right) horizontalSpacer(window.right, header);
  };
  const drawRows = window => {
    body.replaceChildren(); const colspan = header.children.length || 1;
    const spacer = height => { if (!height) return; const tr = create('tr', 'virtual-row-spacer'), td = create('td'); td.colSpan = colspan; td.style.height = `${height}px`; tr.setAttribute('aria-hidden', 'true'); tr.append(td); body.append(tr); };
    spacer(window.top);
    for (let index = window.rowStart; index < window.rowEnd; index++) {
      const tr = create('tr'); tr.setAttribute('aria-rowindex', String(index + 2)); tr.dataset.rowIndex = index;
      if (window.left) { const td = create('td', 'virtual-column-spacer'); td.setAttribute('aria-hidden', 'true'); tr.append(td); }
      for (let n = window.columnStart; n < window.columnEnd; n++) {
        const fieldIndex = fieldIndexes[n], field = profile.fields[fieldIndex], value = rows[index][field.name], td = create('td');
        td.dataset.columnIndex = fieldIndex; td.setAttribute('aria-colindex', String(fieldIndex + 1));
        td.textContent = value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value); td.title = td.textContent; tr.append(td);
      }
      if (window.right) { const td = create('td', 'virtual-column-spacer'); td.setAttribute('aria-hidden', 'true'); tr.append(td); }
      body.append(tr);
    }
    spacer(window.bottom);
    table.dataset.renderedRows = window.rowEnd - window.rowStart;
    table.dataset.renderedColumns = window.columnEnd - window.columnStart;
  };
  const draw = (force = false) => {
    if (disposed) return;
    const window = tableWindow({ rowCount: rows.length, columnCount: fieldIndexes.length, scrollTop: scroll.scrollTop,
      scrollLeft: scroll.scrollLeft, width: scroll.clientWidth || 600, height: scroll.clientHeight || 220 });
    const changedColumns = force || !previousWindow || window.columnStart !== previousWindow.columnStart || window.columnEnd !== previousWindow.columnEnd;
    if (changedColumns) drawColumns(window);
    if (changedColumns || !previousWindow || window.rowStart !== previousWindow.rowStart || window.rowEnd !== previousWindow.rowEnd) drawRows(window);
    previousWindow = window;
    fitLabel(roles.get(feedback.hover)); fitLabel(roles.get(feedback.focus));
  };
  const schedule = () => { if (frame !== undefined || disposed) return; frame = requestAnimationFrame(() => { frame = undefined; draw(); }); };
  const filterFields = () => {
    const query = search.value.trim().toLocaleLowerCase(), filter = typeFilter.value;
    fieldIndexes = profile.fields.flatMap((field, index) => field.name.toLocaleLowerCase().includes(query) &&
      (filter === 'all' || filter === 'selected' && selectionFields(currentSelection).includes(field.name) || filter === field.type) ? [index] : []);
    count.textContent = query || filter !== 'all' ? `${fieldIndexes.length} fields` : '';
    table.style.setProperty('--data-column-count', Math.max(1, fieldIndexes.length));
    scroll.scrollLeft = 0; previousWindow = null; draw(true);
  };
  const columnAt = event => { const cell = event.target.closest('[data-column-index]'); return cell?.closest('table') === table ? Number(cell.dataset.columnIndex) : -1; };
  table.addEventListener('pointerover', event => { if (event.pointerType !== 'touch') setFeedback('hover', columnAt(event)); });
  table.addEventListener('pointerdown', event => { if (event.button === 0) setFeedback('pressed', columnAt(event)); });
  for (const type of ['pointerup', 'pointercancel']) table.addEventListener(type, () => setFeedback('pressed', -1));
  table.addEventListener('pointerleave', () => { setFeedback('hover', -1); setFeedback('pressed', -1); });
  table.addEventListener('focusin', event => { if (event.target.matches(':focus-visible')) setFeedback('focus', columnAt(event)); });
  table.addEventListener('focusout', () => setFeedback('focus', -1));
  table.addEventListener('click', event => {
    const index = columnAt(event), field = profile.fields[index]; if (!field?.usable) return;
    const changes = columnSelectionChange(currentSelection, field.name); if (!changes) return;
    setFeedback('confirmed', index); onChange(changes);
  });
  const reveal = (name, focus = false) => {
    const index = fields.get(name)?.index; if (index === undefined) return;
    if (!fieldIndexes.includes(index)) { search.value = ''; typeFilter.value = 'all'; filterFields(); }
    const n = fieldIndexes.indexOf(index), left = n * TABLE_COLUMN_WIDTH;
    if (left < scroll.scrollLeft || left + TABLE_COLUMN_WIDTH > scroll.scrollLeft + scroll.clientWidth) scroll.scrollLeft = left;
    draw(); if (focus) roles.get(index)?.button.focus({ preventScroll: true });
  };
  table.addEventListener('keydown', event => {
    if (!event.target.closest('.column-select')) return;
    const index = fieldIndexes.indexOf(columnAt(event));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? fieldIndexes.length - 1 : event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : null;
    if (next === null || !profile.fields[fieldIndexes[next]]) return;
    event.preventDefault(); reveal(profile.fields[fieldIndexes[next]].name, true);
  });
  scroll.addEventListener('scroll', schedule, { passive: true }); search.addEventListener('input', filterFields); search.addEventListener('search', filterFields); typeFilter.addEventListener('change', filterFields);
  const update = value => {
    currentSelection = value;
    if (freeSelection) {
      controls.classList.add('field-selection');
      controls.replaceChildren();
      const names = selectionFields(value);
      if (!names.length) controls.append(create('span', 'selection-hint', 'Select variables'));
      for (const name of names) {
        const chip = create('button', 'selected-field', name); chip.type = 'button';
        chip.title = name; chip.setAttribute('aria-label', `Deselect ${name}`);
        chip.append(create('span', 'selected-field-remove', '×'));
        chip.addEventListener('click', () => onChange(columnSelectionChange(currentSelection, name)));
        controls.append(chip);
      }
    }
    for (const [channel, input] of Object.entries(inputs)) {
      input.value = value[channel] ?? ''; input.hidden = !value[channel]; slots[channel].empty.hidden = Boolean(value[channel]);
      slots[channel].label.classList.toggle('next-selection', nextChannel() === channel);
      for (const option of input.options) if (option.value) option.disabled = !fields.get(option.value).field.usable || channel !== 'color' && option.value === value[channel === 'x' ? 'y' : 'x'];
    }
    if (typeFilter.value === 'selected') filterFields(); else for (const role of roles.values()) paintRole(role);
    fitLabel(roles.get(feedback.hover)); fitLabel(roles.get(feedback.focus));
  };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (!scroll.isConnected) observer.disconnect(); else schedule(); }) : null;
  const destroy = () => { disposed = true; observer?.disconnect(); if (frame !== undefined) cancelAnimationFrame(frame); };
  observer?.observe(scroll); table.dataset.totalRows = rows.length; table.dataset.totalColumns = profile.fields.length;
  filterFields(); update(selection);
  const api = { update, reveal, destroy }; mounted.set(host, api); return api;
}
