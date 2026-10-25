import { render } from 'ggaction';
import { chartViewport } from '../chart-viewport.js';

export const THUMBNAIL_WIDTH = 1120, THUMBNAIL_HEIGHT = 720;

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
