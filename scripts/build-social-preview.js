import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile, writeFile } from 'node:fs/promises';

// Keep the editable vector source and the crawler-compatible PNG together.
// This is a public runtime asset, not a screenshot of a user's saved chart.
const image = await loadImage(await readFile('web/social/link-preview.svg'));
const canvas = createCanvas(1200, 630);
canvas.getContext('2d').drawImage(image, 0, 0, 1200, 630);
await writeFile('web/social/link-preview-v1.png', canvas.toBuffer('image/png'));
