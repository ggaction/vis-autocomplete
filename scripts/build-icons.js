import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile, writeFile } from 'node:fs/promises';

// The SVG is the source. Commit these small runtime fallbacks with it.
const image = await loadImage(await readFile('web/icons/favicon.svg'));
for (const [size, name] of [[32, 'favicon.png'], [180, 'apple-touch-icon.png']]) {
  const canvas = createCanvas(size, size);
  canvas.getContext('2d').drawImage(image, 0, 0, size, size);
  await writeFile(`web/icons/${name}`, canvas.toBuffer('image/png'));
}
