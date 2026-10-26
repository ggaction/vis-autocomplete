// A small working set of exact native pixels, keyed by caller-owned immutable
// graphics plus the complete rendering density/viewport. A new density replaces
// the old image for that graphic instead of retaining every window resize.
export function createPreviewRasterCache({ maxEntries = 6, maxPixels = 8_000_000 } = {}) {
  const entries = new Map();
  let pixels = 0;
  const release = key => {
    const entry = entries.get(key); if (!entry) return;
    pixels -= entry.image.width * entry.image.height;
    entry.image.width = entry.image.height = 1;
    entries.delete(key);
  };
  return {
    get(graphics, variant) {
      const entry = entries.get(graphics);
      if (!entry || entry.variant !== variant) return null;
      entries.delete(graphics); entries.set(graphics, entry);
      return entry.image;
    },
    remember(graphics, variant, canvas) {
      release(graphics);
      const cost = canvas.width * canvas.height;
      if (cost <= 0 || cost > maxPixels || maxEntries < 1) return;
      while (entries.size && (entries.size >= maxEntries || pixels + cost > maxPixels)) release(entries.keys().next().value);
      const image = canvas.ownerDocument.createElement('canvas');
      image.width = canvas.width; image.height = canvas.height;
      image.getContext('2d').drawImage(canvas, 0, 0);
      entries.set(graphics, { variant, image }); pixels += cost;
    },
    clear() { for (const key of entries.keys()) release(key); },
    get retainedEntries() { return entries.size; },
    get retainedPixels() { return pixels; },
  };
}
