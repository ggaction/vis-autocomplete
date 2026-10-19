// Pointer and keyboard previews are independent of pinned parameters. Resolve
// their combined intent once per frame, after leave/blur/enter/focus settle.
export function createPreviewInteraction({ readPinned, render, requestFrame, cancelFrame }) {
  let pointer = null, keyboard = null, frame = null, modality = 'pointer';
  const current = () => modality === 'keyboard' && keyboard ? keyboard : pointer ?? keyboard;
  const values = () => current()?.values ?? readPinned();
  const flush = () => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
    render(values());
  };
  const schedule = () => {
    if (frame === null) frame = requestFrame(() => { frame = null; render(values()); });
  };
  return {
    hover(owner, draft) { pointer = { owner, values: draft }; modality = 'pointer'; schedule(); },
    unhover(owner) { if (pointer?.owner === owner) { pointer = null; schedule(); } },
    focus(owner, draft, fromKeyboard = true) { keyboard = { owner, values: draft }; if (fromKeyboard) modality = 'keyboard'; schedule(); },
    blur(owner) { if (keyboard?.owner === owner) { keyboard = null; schedule(); } },
    leavePointer() { if (pointer) { pointer = null; schedule(); } },
    movePointer() { if (modality !== 'pointer') { modality = 'pointer'; schedule(); } },
    reset() { pointer = null; keyboard = null; schedule(); },
    flush,
    get owner() { return current()?.owner ?? null; },
  };
}
