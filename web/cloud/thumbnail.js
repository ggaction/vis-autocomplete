import { render } from 'ggaction';
import { chartViewport } from '../chart-viewport.js';

export const THUMBNAIL_WIDTH = 1120, THUMBNAIL_HEIGHT = 720;

// The editor runs this path in its background worker. Pixel measurement, dense
// chart rendering and PNG compression must not block hover or Apply on the UI.
export async function createProjectThumbnailAsync(program) {
  const viewport = chartViewport(program), geometry = program.graphicSpec.objects.canvas.properties;
  let ratio = Math.min(THUMBNAIL_WIDTH / viewport.width, THUMBNAIL_HEIGHT / viewport.height,
    4096 / geometry.width, 4096 / geometry.height, Math.sqrt(16_000_000 / (geometry.width * geometry.height)));
  const source = new OffscreenCanvas(1, 1), result = new OffscreenCanvas(1, 1);
  try {
    for (;;) {
      render(program, source.getContext('2d'), { pixelRatio: ratio });
      result.width = Math.max(1, Math.ceil(viewport.width * ratio)); result.height = Math.max(1, Math.ceil(viewport.height * ratio));
      result.getContext('2d').drawImage(source, -viewport.x * ratio, -viewport.y * ratio);
      const bytes = new Uint8Array(await (await result.convertToBlob({ type: 'image/png' })).arrayBuffer());
      if (4 * Math.ceil(bytes.length / 3) + 22 <= 180_000) {
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return `data:image/png;base64,${btoa(binary)}`;
      }
      ratio *= .8;
    }
  } finally { source.width = source.height = result.width = result.height = 1; }
}

// Four raster pixels per CSS pixel in the 280×180 project tile. Preserve all
// painted marks/guides, without baking unused canvas margins into the image.
export function createProjectThumbnail(program) {
  const viewport = chartViewport(program), geometry = program.graphicSpec.objects.canvas.properties;
  let ratio = Math.min(THUMBNAIL_WIDTH / viewport.width, THUMBNAIL_HEIGHT / viewport.height,
    4096 / geometry.width, 4096 / geometry.height, Math.sqrt(16_000_000 / (geometry.width * geometry.height)));
  const source = document.createElement('canvas');
  const result = document.createElement('canvas');
  try {
    for (;;) {
      // If a dense chart exceeds the storage budget, render the original
      // geometry at the new resolution instead of repeatedly blurring a PNG.
      render(program, source.getContext('2d'), { pixelRatio: ratio });
      result.width = Math.max(1, Math.ceil(viewport.width * ratio)); result.height = Math.max(1, Math.ceil(viewport.height * ratio));
      result.getContext('2d').drawImage(source, -viewport.x * ratio, -viewport.y * ratio);
      const image = result.toDataURL('image/png');
      if (image.length <= 180_000) return image;
      ratio *= .8;
    }
  } finally { source.width = source.height = result.width = result.height = 0; }
}
