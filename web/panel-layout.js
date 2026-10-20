const storageKey = 'vis-autocomplete.panel-layout';

// Keep panel contents mounted: folding the workspace must not reset code
// disclosures, the history cursor, or cached recommendation cards.
export function initializePanelLayout({ workspace, panels, beforeChange, afterChange }) {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(storageKey)); } catch { /* Optional preference. */ }
  const collapsed = {};
  const paint = (name, value) => {
    const { panel, button, contents, label, icons } = panels[name];
    collapsed[name] = value;
    panel.dataset.collapsed = String(value);
    workspace.classList.toggle(`${name}-collapsed`, value);
    button.setAttribute('aria-expanded', String(!value));
    button.setAttribute('aria-label', `${value ? 'Expand' : 'Collapse'} ${label}`);
    button.title = button.getAttribute('aria-label');
    button.firstElementChild.textContent = icons[value ? 1 : 0];
    for (const content of contents) content.hidden = value;
  };
  for (const [name, { button, contents }] of Object.entries(panels)) {
    paint(name, saved?.[name] === true);
    button.addEventListener('click', () => {
      const value = !collapsed[name];
      beforeChange?.(name, value);
      if (value && contents.some(content => content.contains(document.activeElement))) button.focus({ preventScroll: true });
      paint(name, value);
      try { localStorage.setItem(storageKey, JSON.stringify(collapsed)); } catch { /* Still works without storage. */ }
      afterChange?.(name, value);
    });
  }
}
