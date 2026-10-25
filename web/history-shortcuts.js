// Leave native text Undo intact while editing a title, search, or other input.
export function historyShortcut(event) {
  if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return null;
  const target = event.target;
  if (target?.closest?.('dialog[open]')) return null;
  if (target?.isContentEditable || target?.closest?.('textarea')) return null;
  const input = target?.closest?.('input');
  if (input && !['range', 'button', 'submit', 'checkbox', 'radio', 'color'].includes(input.type)) return null;
  const key = event.code === 'KeyZ' ? 'z' : event.code === 'KeyY' ? 'y' : event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return null;
}

export function initializeHistoryShortcuts({ run, busy, cancelGesture, dataset }) {
  let pending = Promise.resolve();
  document.addEventListener('keydown', event => {
    const direction = historyShortcut(event);
    if (!direction || !dataset()) return;
    event.preventDefault();
    const requestedDataset = dataset();
    if (cancelGesture()) return;
    // A key pressed during Apply waits for that commit. Rapid key presses keep
    // their order instead of being dropped while recommendations are loading.
    pending = pending.then(async () => {
      while (busy() && dataset() === requestedDataset) await new Promise(resolve => requestAnimationFrame(resolve));
      if (dataset() === requestedDataset) await run(direction);
    }).catch(error => console.error(error));
  });
}
