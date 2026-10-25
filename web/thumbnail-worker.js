import { createProjectThumbnailAsync } from './cloud/thumbnail.js';

self.addEventListener('message', async ({ data: { id, graphicSpec } }) => {
  try { self.postMessage({ id, image: await createProjectThumbnailAsync({ graphicSpec }) }); }
  catch (error) { self.postMessage({ id, error: error.message }); }
});
