// One active pass and one latest intent. Paint completed cards progressively,
// never enqueue every pointer event or let obsolete results repaint after Esc.
export function createResizeThumbnails({ prepare, render, onError = () => {} }) {
  let session = null;
  async function pump(current) {
    if (current.running) return;
    current.running = true;
    try {
      while (session === current && current.pending) {
        const { resize, cards } = current.pending; current.pending = null;
        for (const card of cards) {
          if (session !== current) break;
          try {
            const prepared = await prepare(current.context, resize, card);
            if (session === current) render(card, prepared.preview, current.context);
          } catch (error) { if (session === current) onError(card, error); }
        }
      }
    } finally { current.running = false; }
  }
  return {
    start(context) { if (session?.context !== context) session = { context, running: false, pending: null }; },
    update(resize, cards) {
      if (!session) return;
      session.pending = { resize, cards };
      void pump(session);
    },
    stop() { session = null; },
  };
}
