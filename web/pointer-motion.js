// Screen coordinates describe physical pointer travel. Client coordinates and
// enter/leave targets can change when the viewport or animated layout moves.
// Resolve the latest physical move once per frame, including moves OUTSIDE the
// gallery, so a layout-generated leave cannot reset the movement guard.
export function createPointerMotion({ render, requestFrame, cancelFrame }) {
  let position = null, pending = null, frame = null;
  const flush = () => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
    const event = pending; pending = null;
    if (event) render(event);
  };
  return {
    move(event) {
      if (event.pointerType === 'touch') return;
      const x = event.screenX, y = event.screenY;
      if (position?.x === x && position?.y === y) return;
      position = { x, y };
      pending = event;
      if (frame === null) frame = requestFrame(flush);
    },
    flush,
    reset() {
      if (frame !== null) cancelFrame(frame);
      frame = null; pending = null; position = null;
    },
  };
}
