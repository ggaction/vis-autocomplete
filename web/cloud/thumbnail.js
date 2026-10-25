import { render } from 'ggaction';
import { chartViewport } from '../chart-viewport.js';

// Preserve all painted marks/guides, but omit unused canvas margins and the
// old fixed 240×160 letterbox. CSS fits the resulting image without distortion.
export function createProjectThumbnail(program) {
  const viewport = chartViewport(program), geometry = program.graphicSpec.objects.canvas.properties;
  const ratio = Math.min(560 / viewport.width, 360 / viewport.height,
    4096 / geometry.width, 4096 / geometry.height, Math.sqrt(16_000_000 / (geometry.width * geometry.height)));
  const source = document.createElement('canvas');
  render(program, source.getContext('2d'), { pixelRatio: ratio });
  const result = document.createElement('canvas');
  result.width = Math.max(1, Math.ceil(viewport.width * ratio)); result.height = Math.max(1, Math.ceil(viewport.height * ratio));
  result.getContext('2d').drawImage(source, -viewport.x * ratio, -viewport.y * ratio);
  let image = result.toDataURL('image/png');
  while (image.length > 180_000) {
    const smaller = document.createElement('canvas');
    smaller.width = Math.max(1, Math.floor(result.width * .8)); smaller.height = Math.max(1, Math.floor(result.height * .8));
    smaller.getContext('2d').drawImage(result, 0, 0, smaller.width, smaller.height);
    result.width = smaller.width; result.height = smaller.height; result.getContext('2d').drawImage(smaller, 0, 0);
    image = result.toDataURL('image/png');
  }
  return image;
}

// Existing account thumbnails still contain baked-in padding. Fit those on
// display as well; opening a project is not required to regenerate its image.
export function fitLegacyThumbnail(image) {
  image.addEventListener('load', () => {
    if (image.naturalWidth !== 240 || image.naturalHeight !== 160) return;
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 160;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, 240, 160);
    let left = 240, top = 160, right = -1, bottom = -1;
    for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) {
      const i = (y * 240 + x) * 4;
      if (!data[i + 3] || (data[i] >= 250 && data[i + 1] >= 250 && data[i + 2] >= 250)) continue;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right < left) return;
    left = Math.max(0, left - 3); top = Math.max(0, top - 3);
    const width = Math.min(240, right + 4) - left, height = Math.min(160, bottom + 4) - top;
    const fitted = document.createElement('canvas'); fitted.width = width; fitted.height = height;
    fitted.getContext('2d').drawImage(canvas, left, top, width, height, 0, 0, width, height);
    image.src = fitted.toDataURL('image/png');
  }, { once: true });
}
