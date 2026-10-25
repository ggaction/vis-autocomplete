import { readViewPreference, writeViewPreference } from './view-preferences.js';
const fontStorageKey = 'vis-autocomplete.code-font-size';
const minFontSize = 8, maxFontSize = 20, defaultFontSize = 11;

function storedFontSize() {
  try {
    const value = Number.parseInt(readViewPreference(fontStorageKey), 10);
    if (Number.isInteger(value) && value >= minFontSize && value <= maxFontSize) return value;
  } catch { /* The toolbar still works when browser storage is unavailable. */ }
  return defaultFontSize;
}

function legacyCopy(panel, source) {
  const doc = panel.ownerDocument, active = doc.activeElement;
  const selection = doc.getSelection();
  const ranges = Array.from({ length: selection?.rangeCount ?? 0 }, (_, i) => selection.getRangeAt(i).cloneRange());
  const textarea = doc.createElement('textarea');
  textarea.className = 'sr-only'; textarea.value = source; textarea.readOnly = true;
  // Keep temporary focus inside the code panel so its preview stays visible.
  panel.append(textarea);
  try {
    textarea.focus({ preventScroll: true }); textarea.select();
    if (!doc.execCommand('copy')) throw new Error('Clipboard copy unavailable.');
  } finally {
    textarea.remove();
    active?.focus({ preventScroll: true });
    selection?.removeAllRanges();
    for (const range of ranges) selection.addRange(range);
  }
}

export function initializeCodeToolbar({ panel, decrease, increase, copy, status, source, onError }) {
  let fontSize = storedFontSize(), feedbackTimer, copying = false;
  const applyFontSize = () => {
    panel.style.setProperty('--code-font-size', `${fontSize}px`);
    decrease.disabled = fontSize <= minFontSize; increase.disabled = fontSize >= maxFontSize;
    decrease.title = `Decrease code font size (${fontSize}px)`;
    increase.title = `Increase code font size (${fontSize}px)`;
  };
  const resize = delta => {
    fontSize = Math.max(minFontSize, Math.min(maxFontSize, fontSize + delta));
    applyFontSize(); status.textContent = `Code font size: ${fontSize} pixels.`;
    try { writeViewPreference(fontStorageKey, String(fontSize)); } catch { /* Optional preference persistence. */ }
  };
  decrease.addEventListener('click', () => resize(-1));
  increase.addEventListener('click', () => resize(1));
  copy.addEventListener('click', async () => {
    if (copying) return;
    const code = source();
    if (!code) { status.textContent = 'No code to copy yet.'; return; }
    clearTimeout(feedbackTimer); copying = true; copy.setAttribute('aria-busy', 'true');
    try {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable.');
        await navigator.clipboard.writeText(code);
      } catch { legacyCopy(panel, code); }
      copy.textContent = 'Copied!'; status.textContent = 'Full code copied to clipboard.';
    } catch {
      copy.textContent = 'Try again';
      status.textContent = 'Could not copy code. Select and copy the code manually.';
      onError?.(status.textContent);
    } finally {
      copying = false; copy.removeAttribute('aria-busy');
      feedbackTimer = setTimeout(() => { copy.textContent = 'Copy code'; }, 1600);
    }
  });
  applyFontSize();
}
