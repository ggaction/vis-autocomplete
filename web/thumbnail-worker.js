import { createProjectThumbnailAsync } from './cloud/thumbnail.js';
import { restoreSession } from './project.js';

self.addEventListener('message', async ({ data: { id, graphicSpec, snapshot, rows } }) => {
  try {
    // Legacy gallery images need only the active saved entry. Later branches
    // are neither transferred nor replayed, and no editor state is touched.
    const program = snapshot ? restoreSession({ entries: [snapshot], index: 0 }, rows).entries[0].view : { graphicSpec };
    self.postMessage({ id, image: await createProjectThumbnailAsync(program) });
  }
  catch (error) { self.postMessage({ id, error: error.message }); }
});
