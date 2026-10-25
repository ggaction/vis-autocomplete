import { restoreSession } from '../project.js';
import { contentHash } from './documents.js';
import { createProjectThumbnail, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT } from './thumbnail.js';

// Upgrade visible low-resolution thumbnails one at a time, outside the editor's
// state. A derived local cache avoids replay/download on every menu opening.
export function projectThumbnails(account, root) {
  const owner = account.user?.id, entries = new Map(), pending = [];
  let disposed = false, running = false;
  const alive = image => !disposed && owner === account.user?.id && image.isConnected;
  const observer = new IntersectionObserver(changes => {
    for (const change of changes) {
      const entry = entries.get(change.target);
      if (!entry) continue;
      entry.visible = change.isIntersecting;
      if (entry.visible && !entry.queued) { entry.queued = true; pending.push(entry); }
    }
    run();
  }, { root });
  async function run() {
    if (running || disposed) return;
    running = true;
    try {
      while (pending.length && !disposed) {
        const entry = pending.shift(), { image, row } = entry;
        if (!entry.visible) { entry.queued = false; continue; }
        try {
          await new Promise(resolve => setTimeout(resolve, 0));
          if (!alive(image)) continue;
          const key = `thumbnail:${owner}:${row.id}`;
          const signature = await contentHash(JSON.stringify([2, row.revision, row.updated_at, row.thumbnail]));
          const cached = await account.local.get(key);
          if (!alive(image)) continue;
          let thumbnail = cached?.signature === signature ? cached.image : null;
          if (!thumbnail) {
            const record = await account.preview(row);
            if (!alive(image)) continue;
            const snapshot = record.session?.entries[record.session.index];
            if (!snapshot || snapshot.phase === 'initial') continue;
            // Only the selected history entry is needed, including when undo
            // left later entries in the saved session.
            const session = restoreSession({ index: 0, entries: [snapshot] }, record.imported.rows);
            thumbnail = createProjectThumbnail(session.entries[0].view);
            if (!alive(image)) continue;
            // A full local cache must not hide an already-rendered sharp image.
            await account.local.put(key, { signature, image: thumbnail }).catch(() => {});
          }
          if (alive(image)) image.src = thumbnail;
        } catch { /* Keep the saved image when offline or the project is unavailable. */ }
        finally { observer.unobserve(image); entries.delete(image); }
      }
    } finally { running = false; }
  }
  return {
    observe(image, row) {
      image.addEventListener('load', () => {
        if (disposed || Math.max(image.naturalWidth / THUMBNAIL_WIDTH, image.naturalHeight / THUMBNAIL_HEIGHT) >= .95) return;
        entries.set(image, { image, row, visible: false, queued: false }); observer.observe(image);
      }, { once: true });
    },
    dispose() { disposed = true; observer.disconnect(); entries.clear(); pending.length = 0; },
  };
}
