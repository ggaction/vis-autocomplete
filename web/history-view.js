import { createHistoryGraphView } from './history-graph-view.js';
import { readViewPreference, writeViewPreference } from './view-preferences.js';
import { OPTION_GROUPS } from './option-groups.js';
import { historyLabel, historyPreview } from './history.js';
import { prepareHistorySnapshot } from './project.js';

// Mount each immutable snapshot once. Hovering and navigation only change the
// cursor/highlight; they never rebuild thumbnails or run recommendation work.
function createLinearHistoryView(host, { renderChart, onPreview, onLeave, onJump, meta }) {
  const nodes = new Map();
  const pending = new Map(), visible = new Set();
  let paintQueued = false;
  function queuePaint() {
    if (paintQueued || !visible.size) return;
    paintQueued = true;
    const paintOne = async () => {
      const ready = [...visible].filter(button => pending.has(button) && button.isConnected);
      const button = ready.find(button => button.hasAttribute('aria-current')) ?? ready[0];
      if (!button) { paintQueued = false; return; }
      const { snapshot, thumb, label } = pending.get(button);
      pending.delete(button);
      try {
        await prepareHistorySnapshot(snapshot);
        if (button.isConnected) renderChart(thumb, historyPreview(snapshot), label);
      }
      catch (error) { thumb.textContent = 'Preview unavailable'; thumb.title = error.message; }
      observer.unobserve(button); visible.delete(button);
      paintQueued = false;
      queuePaint();
    };
    // Only the visible strip needs thumbnails. Yield between native restores
    // so current-chart painting and arriving option cards can take priority.
    if (globalThis.requestIdleCallback) requestIdleCallback(paintOne, { timeout: 1000 });
    else setTimeout(paintOne, 20);
  }
  const observer = new IntersectionObserver(changes => {
    for (const { target, isIntersecting } of changes) {
      if (isIntersecting) visible.add(target); else visible.delete(target);
    }
    queuePaint();
  }, { root: host });
  const scrub = document.createElement('span');
  scrub.className = 'history-scrub-bar'; scrub.setAttribute('aria-hidden', 'true');
  let entries = [], hovered = null, current = -1, locked = false, pointerX = null, pinned = null, needsScroll = false;

  function paintPinned() {
    const button = pinned && nodes.get(pinned.snapshot);
    if (!button) pinned = null;
    host.classList.toggle('has-pinned-history', Boolean(pinned));
    if (pinned) {
      if (host.clientWidth) scrub.style.left = `${button.offsetLeft + button.offsetWidth * pinned.fraction}px`;
      host.dataset.pinnedIndex = button.dataset.historyIndex;
    } else delete host.dataset.pinnedIndex;
  }
  function release() { pinned = null; paintPinned(); }
  function refreshLayout() {
    if (!host.clientWidth) return;
    if (needsScroll) {
      const selected = nodes.get(entries[current]);
      if (selected && (selected.offsetLeft < host.scrollLeft || selected.offsetLeft + selected.offsetWidth > host.scrollLeft + host.clientWidth)) {
        host.scrollLeft = Math.max(0, selected.offsetLeft + selected.offsetWidth - host.clientWidth);
      }
      needsScroll = false;
    }
    paintPinned();
  }

  async function preview(index) {
    if (locked || hovered === index || !entries[index]) return;
    hovered = index;
    for (const [snapshot, button] of nodes) button.classList.toggle('inspecting', snapshot === entries[index]);
    meta.textContent = `#${entries[index].steps} ${historyLabel(entries[index])}`;
    const snapshot = entries[index];
    try {
      await prepareHistorySnapshot(snapshot);
      if (hovered === index && entries[index] === snapshot && !locked) onPreview(snapshot);
    } catch { /* Keep Current if an old preview cannot be restored. */ }
  }
  function clear({ restore = true } = {}) {
    const wasInspecting = hovered !== null;
    hovered = null; pointerX = null; meta.textContent = ''; host.classList.remove('is-scrubbing');
    for (const button of nodes.values()) button.classList.remove('inspecting');
    if (wasInspecting && restore) onLeave();
  }
  function move(clientX) {
    if (locked) return;
    pointerX = clientX;
    const x = clientX - host.getBoundingClientRect().left + host.scrollLeft;
    if (!pinned) scrub.style.left = `${x}px`;
    host.classList.add('is-scrubbing');
    let nearest = null, distance = Infinity;
    for (const button of nodes.values()) {
      const delta = Math.abs(button.offsetLeft + button.offsetWidth / 2 - x);
      if (delta < distance) { distance = delta; nearest = Number(button.dataset.historyIndex); }
    }
    if (nearest !== null) preview(nearest);
  }
  host.addEventListener('scroll', () => { if (pointerX !== null) move(pointerX); }, { passive: true });
  host.addEventListener('focusin', event => {
    const button = event.target.closest('.history-item');
    if (button) preview(Number(button.dataset.historyIndex));
  });
  host.addEventListener('focusout', event => { if (!host.contains(event.relatedTarget)) clear(); });
  host.addEventListener('keydown', event => {
    if (event.key === 'Escape') { clear(); return; }
    const buttons = [...host.querySelectorAll('.history-item')];
    const index = buttons.indexOf(event.target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowRight' ? Math.min(index + 1, buttons.length - 1)
      : event.key === 'ArrowLeft' ? Math.max(index - 1, 0) : null;
    if (next === null || !buttons[next]) return;
    event.preventDefault(); buttons[next].focus();
  });

  return {
    clear,
    release,
    refreshLayout,
    move(event) { move(event.clientX); },
    update(history, busy = false) {
      entries = history.entries; locked = busy; host.setAttribute('aria-busy', String(busy));
      const retained = new Set(entries);
      for (const [snapshot, button] of nodes) if (!retained.has(snapshot)) {
        observer.unobserve(button); pending.delete(button); visible.delete(button);
        button.remove(); nodes.delete(snapshot);
      }
      for (const [index, snapshot] of entries.entries()) {
        let button = nodes.get(snapshot);
        if (!button) {
          button = document.createElement('button'); button.type = 'button'; button.className = 'history-item';
          const group = OPTION_GROUPS.find(group => group.id === snapshot.optionGroup) ?? OPTION_GROUPS[0];
          button.style.setProperty('--history-accent', group.color);
          button.style.setProperty('--history-rgb', group.rgb);
          const thumb = document.createElement('span'); thumb.className = 'history-thumbnail';
          const label = historyLabel(snapshot);
          pending.set(button, { snapshot, thumb, label: `History #${snapshot.steps}: ${label}` });
          const caption = document.createElement('span'); caption.className = 'history-caption';
          caption.textContent = `${snapshot.steps}. ${label}`;
          button.append(thumb, caption); button.title = caption.textContent;
          button.setAttribute('aria-label', `History #${snapshot.steps}: ${label}`);
          button.addEventListener('click', event => {
            if (locked) return;
            const rect = button.getBoundingClientRect();
            // Keep the clicked content position across pointer leave, history
            // restoration, scrolling and automatic recommendation selection.
            pinned = { snapshot, fraction: event.detail > 0 && rect.width
              ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : .5 };
            paintPinned();
            clear({ restore: false }); onJump(Number(button.dataset.historyIndex));
          });
          nodes.set(snapshot, button); host.append(button); observer.observe(button);
        }
        button.dataset.historyIndex = index; button.disabled = busy;
        if (index === history.index) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
        button.classList.toggle('future', index > history.index);
      }
      host.append(scrub);
      if (current !== history.index) {
        current = history.index;
        needsScroll = true;
      }
      paintPinned();
      refreshLayout();
    },
  };
}

// Both presentations operate on the same history cursor and snapshot cache.
export function createHistoryView(host, options) {
  const controls = options.controls ?? document.createElement('div');
  const linearHost = document.createElement('div'); linearHost.className = 'history-list';
  const graphHost = document.createElement('div'); graphHost.className = 'history-graph'; graphHost.hidden = true;
  graphHost.setAttribute('aria-label', 'History graph; scroll to pan, Ctrl or Command plus wheel to zoom');
  host.classList.remove('history-list'); host.classList.add('history-views'); host.append(linearHost, graphHost);
  const linear = createLinearHistoryView(linearHost, options);
  const graph = createHistoryGraphView(graphHost, { ...options, controls });
  const toggle = document.createElement('span'); toggle.className = 'history-view-toggle'; toggle.setAttribute('role', 'group'); toggle.setAttribute('aria-label', 'History view');
  controls.prepend(toggle);
  let mode = readViewPreference('vis-autocomplete.history-view') === 'graph' ? 'graph' : 'linear', history, busy = false;
  const active = () => mode === 'graph' ? graph : linear;
  function paintMode() {
    linearHost.hidden = mode !== 'linear'; graph.setVisible(mode === 'graph'); host.dataset.historyView = mode;
    for (const button of toggle.children) button.setAttribute('aria-pressed', String(button.dataset.view === mode));
    if (history) active().update(history, busy);
    active().refreshLayout();
  }
  for (const [value, label] of [['linear', 'Linear View'], ['graph', 'Graph View']]) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.view = value; button.textContent = label;
    button.addEventListener('click', () => {
      if (mode === value) return;
      active().clear(); mode = value; options.onNavigate?.({mode,action:'history'});paintMode(); writeViewPreference('vis-autocomplete.history-view', mode);
    }); toggle.append(button);
  }
  paintMode();
  return {
    clear(options) { active().clear(options); }, release() { linear.release(); graph.release(); },
    move(event) { active().move(event); }, refreshLayout() { active().refreshLayout(); },
    update(value, locked = false) { history = value; busy = locked; host.setAttribute('aria-busy', String(busy)); active().update(history, busy); },
  };
}
