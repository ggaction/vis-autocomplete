const storageKey = 'vis-autocomplete.workspace-layout';

// Layout is a view preference, independent of chart history and recommendations.
// Keep the same mounted cards/Canvas surfaces when the workspace changes shape.
export function initializeWorkspaceLayout({ workspace, toggle, header, busy, beforeChange, afterChange }) {
  const choices = { preview: 'horizontal', transition: 'vertical' };
  let mode = 'preview';
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    for (const key of Object.keys(choices)) {
      if (['horizontal', 'vertical'].includes(saved?.[key])) choices[key] = saved[key];
    }
  } catch { /* Layout works without local storage. */ }
  function paint() {
    workspace.dataset.layout = choices[mode];
    for (const button of toggle.querySelectorAll('[data-layout]')) {
      button.setAttribute('aria-pressed', String(button.dataset.layout === choices[mode]));
    }
  }
  function change(update) {
    beforeChange?.();
    update();
    paint();
    afterChange?.();
  }
  toggle.addEventListener('click', event => {
    const button = event.target.closest('[data-layout]');
    if (!button || busy() || choices[mode] === button.dataset.layout) return;
    change(() => { choices[mode] = button.dataset.layout; });
    try { localStorage.setItem(storageKey, JSON.stringify(choices)); } catch { /* Optional preference. */ }
  });
  // Header controls wrap on smaller screens; reserve their actual height rather
  // than subtracting a fixed toolbar size from the viewport.
  const fitHeight = () => workspace.style.setProperty('--workspace-height', `calc(100dvh - ${header.getBoundingClientRect().height + 30}px)`);
  new ResizeObserver(fitHeight).observe(header);
  fitHeight();
  paint();
  return {
    setMode(next) {
      if (next === mode) return;
      change(() => { mode = next; });
    },
  };
}
