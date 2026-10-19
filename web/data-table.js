// Keep the full source table mounted while roles change, preserving scroll.
export function renderDataTable(host, { rows, profile, selection, onChange, controlsHost }) {
  host.replaceChildren(); host.classList.add('data-view');
  const controls = document.createElement('div'); controls.className = 'selection-controls';
  const inputs = {}, slots = {};
  let currentSelection = selection;
  const nextChannel = () => ['x', 'y', 'color'].find(channel => !currentSelection[channel]);
  for (const [channel, title] of [['x', 'X'], ['y', 'Y'], ['color', 'Color']]) {
    const label = document.createElement('label');
    const caption = document.createElement('span'); caption.className = 'selection-caption'; caption.textContent = title;
    label.append(caption);
    const select = document.createElement('select'); select.id = `select-${channel}`;
    select.setAttribute('aria-label', `Encode ${channel === 'color' ? channel : title}`);
    const blank = document.createElement('option'); blank.value = ''; blank.textContent = channel === 'color' ? 'None' : 'Select variable';
    select.append(blank);
    for (const field of profile.fields) {
      const option = document.createElement('option'); option.value = field.name; option.textContent = field.name;
      option.disabled = !field.usable; select.append(option);
    }
    select.value = selection[channel] ?? '';
    select.addEventListener('change', () => onChange({ [channel]: select.value }));
    const empty = document.createElement('span'); empty.className = 'selection-empty'; empty.textContent = 'Click a column';
    inputs[channel] = select; slots[channel] = { label, empty };
    label.append(empty, select); controls.append(label);
  }
  const scroll = document.createElement('div'); scroll.className = 'data-table-scroll'; scroll.tabIndex = 0;
  scroll.setAttribute('aria-label', 'Dataset table');
  const table = document.createElement('table'); table.className = 'dataset-table';
  table.style.setProperty('--data-column-count', profile.fields.length);
  const columns = document.createElement('colgroup'), head = document.createElement('thead'), header = document.createElement('tr');
  const roles = [];
  for (const field of profile.fields) {
    const col = document.createElement('col'); columns.append(col);
    const cell = document.createElement('th'); cell.scope = 'col';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'column-select';
    button.dataset.field = field.name; button.setAttribute('aria-label', `Select column ${field.name}`);
    const name = document.createElement('span'); name.className = 'column-name'; name.textContent = field.name;
    const badge = document.createElement('span'); badge.className = 'column-roles';
    const fullLabel = document.createElement('span'); fullLabel.className = 'column-full-label';
    fullLabel.setAttribute('aria-hidden', 'true');
    const fullName = document.createElement('span'); fullName.className = 'column-full-name'; fullName.textContent = field.name;
    const fullBadge = document.createElement('span'); fullBadge.className = 'column-roles';
    fullLabel.append(fullName, fullBadge);
    button.append(name, badge); cell.append(button, fullLabel); header.append(cell);
    roles.push({ field, col, cell, badge, button, fullLabel, fullBadge });
  }
  head.append(header);
  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const field of profile.fields) {
      const cell = document.createElement('td'); const value = row[field.name];
      cell.textContent = value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
      cell.title = cell.textContent;
      tr.append(cell);
    }
    body.append(tr);
  }
  table.append(columns, head, body); scroll.append(table); host.append(scroll);
  controlsHost.replaceChildren(controls); controlsHost.hidden = false;
  // Paint the column through <col>, rather than updating all of its row cells
  // on every pointer move. Sticky headers receive the same feedback separately.
  const feedback = { hover: -1, focus: -1, pressed: -1, confirmed: -1 };
  const fitLabel = role => {
    if (!role) return;
    const viewport = scroll.getBoundingClientRect(), cell = role.cell.getBoundingClientRect();
    role.fullLabel.style.setProperty('--column-label-max-width', `${scroll.clientWidth - 2}px`);
    role.fullLabel.style.removeProperty('--column-label-width');
    // Cover whole neighboring headers so clipped tails of their names do not
    // peek out beside the expanded label. This never resizes actual columns.
    const span = Math.ceil(role.fullLabel.offsetWidth / cell.width) * cell.width;
    role.fullLabel.style.setProperty('--column-label-width', `${span}px`);
    const width = role.fullLabel.offsetWidth;
    const preferred = cell.left + width <= viewport.right - 1 ? cell.left : cell.right - width;
    const left = Math.max(viewport.left + 1, Math.min(preferred, viewport.right - width - 1));
    role.fullLabel.style.setProperty('--column-label-shift', `${left - cell.left}px`);
  };
  const setFeedback = (kind, index) => {
    if (feedback[kind] === index) return;
    const previous = roles[feedback[kind]], next = roles[index];
    if (kind === 'hover' || kind === 'focus') fitLabel(next);
    for (const node of [previous?.col, previous?.cell]) node?.classList.remove(`column-${kind}`);
    for (const node of [next?.col, next?.cell]) node?.classList.add(`column-${kind}`);
    feedback[kind] = index;
  };
  const columnAt = event => {
    const cell = event.target.closest('th, td');
    return cell?.closest('table') === table ? cell.cellIndex : -1;
  };
  table.addEventListener('pointerover', event => {
    if (event.pointerType !== 'touch') setFeedback('hover', columnAt(event));
  });
  table.addEventListener('pointerdown', event => {
    if (event.button === 0) setFeedback('pressed', columnAt(event));
  });
  table.addEventListener('pointerup', () => setFeedback('pressed', -1));
  table.addEventListener('pointercancel', () => setFeedback('pressed', -1));
  table.addEventListener('pointerleave', () => {
    setFeedback('hover', -1); setFeedback('pressed', -1);
  });
  table.addEventListener('focusin', event => {
    if (event.target.matches(':focus-visible')) setFeedback('focus', columnAt(event));
  });
  table.addEventListener('focusout', () => setFeedback('focus', -1));
  scroll.addEventListener('scroll', () => {
    fitLabel(roles[feedback.hover]); fitLabel(roles[feedback.focus]);
  }, { passive: true });
  table.addEventListener('click', event => {
    const cell = event.target.closest('th, td');
    if (!cell) return;
    const field = profile.fields[cell.cellIndex];
    if (!field?.usable) return;
    const assigned = ['x', 'y', 'color'].filter(channel => currentSelection[channel] === field.name);
    if (assigned.length) {
      setFeedback('confirmed', cell.cellIndex);
      // A shared X/Color column is one selection: clear its roles together,
      // with one chart refresh rather than one refresh per role.
      onChange(Object.fromEntries(assigned.map(channel => [channel, ''])));
      return;
    }
    const channel = nextChannel();
    if (!channel) return;
    setFeedback('confirmed', cell.cellIndex);
    onChange({ [channel]: field.name });
  });
  const update = selection => {
    currentSelection = selection;
    for (const [channel, input] of Object.entries(inputs)) {
      input.value = selection[channel] ?? '';
      input.hidden = !selection[channel]; slots[channel].empty.hidden = Boolean(selection[channel]);
      slots[channel].label.classList.toggle('next-selection', nextChannel() === channel);
      for (const option of input.options) if (option.value) option.disabled =
        !profile.fields.find(field => field.name === option.value).usable ||
        channel !== 'color' && option.value === selection[channel === 'x' ? 'y' : 'x'];
    }
    for (const { field, col, cell, badge, button, fullBadge } of roles) {
      const assigned = ['x', 'y', 'color'].filter(channel => selection[channel] === field.name);
      badge.textContent = assigned.map(channel => channel === 'color' ? 'C' : channel.toUpperCase()).join(' · ');
      fullBadge.textContent = badge.textContent;
      col.classList.toggle('encoded-column', assigned.length > 0);
      cell.classList.toggle('encoded-column', assigned.length > 0);
      button.setAttribute('aria-pressed', String(assigned.length > 0));
      button.title = assigned.length ? `${field.name} · Clear ${assigned.map(channel => channel === 'color' ? 'Color' : channel.toUpperCase()).join(' / ')}`
        : nextChannel() ? `${field.name} · Encode ${nextChannel()}` : field.name;
      button.disabled = !field.usable || !assigned.length && !nextChannel();
    }
    fitLabel(roles[feedback.hover]); fitLabel(roles[feedback.focus]);
  };
  update(selection);
  return { update };
}
