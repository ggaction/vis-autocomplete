import { OPTION_GROUPS } from './option-groups.js';

// Mount each immutable snapshot once. Hovering and navigation only change the
// cursor/highlight; they never rebuild thumbnails or run recommendation work.
export function createHistoryView(host, { renderChart, onPreview, onLeave, onJump, meta }) {
  const nodes = new Map();
  const scrub = document.createElement('span');
  scrub.className = 'history-scrub-bar'; scrub.setAttribute('aria-hidden', 'true');
  let entries = [], hovered = null, current = -1, locked = false, pointerX = null, pinned = null;

  function paintPinned() {
    const button = pinned && nodes.get(pinned.snapshot);
    if (!button) pinned = null;
    host.classList.toggle('has-pinned-history', Boolean(pinned));
    if (pinned) {
      scrub.style.left = `${button.offsetLeft + button.offsetWidth * pinned.fraction}px`;
      host.dataset.pinnedIndex = button.dataset.historyIndex;
    } else delete host.dataset.pinnedIndex;
  }
  function release() { pinned = null; paintPinned(); }

  function preview(index) {
    if (locked || hovered === index || !entries[index]) return;
    hovered = index;
    for (const [snapshot, button] of nodes) button.classList.toggle('inspecting', snapshot === entries[index]);
    meta.textContent = `#${entries[index].steps} ${entries[index].currentNote}`;
    onPreview(entries[index]);
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
    move(event) { move(event.clientX); },
    update(history, busy = false) {
      entries = history.entries; locked = busy; host.setAttribute('aria-busy', String(busy));
      const visible = entries.filter(snapshot => snapshot.steps > 0);
      for (const [snapshot, button] of nodes) if (!visible.includes(snapshot)) { button.remove(); nodes.delete(snapshot); }
      for (const snapshot of visible) {
        let button = nodes.get(snapshot);
        if (!button) {
          button = document.createElement('button'); button.type = 'button'; button.className = 'history-item';
          const group = OPTION_GROUPS.find(group => group.id === snapshot.optionGroup) ?? OPTION_GROUPS[0];
          button.style.setProperty('--history-accent', group.color);
          button.style.setProperty('--history-rgb', group.rgb);
          const thumb = document.createElement('span'); thumb.className = 'history-thumbnail';
          renderChart(thumb, snapshot.view, `History #${snapshot.steps}: ${snapshot.currentNote}`);
          const caption = document.createElement('span'); caption.className = 'history-caption';
          caption.textContent = `${snapshot.steps}. ${snapshot.currentNote}`;
          button.append(thumb, caption); button.title = caption.textContent;
          button.setAttribute('aria-label', `History #${snapshot.steps}: ${snapshot.currentNote}`);
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
          nodes.set(snapshot, button); host.append(button);
        }
        const index = entries.indexOf(snapshot);
        button.dataset.historyIndex = index; button.disabled = busy;
        if (index === history.index) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
        button.classList.toggle('future', index > history.index);
      }
      host.append(scrub);
      if (current !== history.index) {
        current = history.index;
        const selected = nodes.get(entries[current]);
        if (selected && (selected.offsetLeft < host.scrollLeft || selected.offsetLeft + selected.offsetWidth > host.scrollLeft + host.clientWidth)) {
          host.scrollLeft = Math.max(0, selected.offsetLeft + selected.offsetWidth - host.clientWidth);
        }
      }
      paintPinned();
    },
  };
}
