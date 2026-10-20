// Lay out the destination once, then move the already painted cards. Animating
// flex-grow/height instead invalidates every sibling (and its SVG) each frame.
// Counter-transforms keep text, controls and thumbnails at their natural size.
export function createCardMotion() {
  const running = new Map();
  const finish = row => {
    const animations = running.get(row);
    if (!animations) return;
    running.delete(row);
    for (const animation of animations) animation.cancel();
  };
  const capture = rows => rows.flatMap(row => [...row.querySelectorAll(':scope > .card')].map(element => ({
    row, element, rect: element.getBoundingClientRect(),
    expanded: element.classList.contains('expanded'),
    children: [...element.children].map(child => ({ element: child, rect: child.getBoundingClientRect() })),
    thumbnail: element.querySelector('.thumbnail svg'),
    thumbnailRect: element.querySelector('.thumbnail svg')?.getBoundingClientRect(),
  })));
  return {
    finish() { for (const row of running.keys()) finish(row); },
    change(rows, update) {
      rows = [...new Set(rows)].filter(row => row?.isConnected);
      if (!rows.length || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        for (const row of rows) finish(row);
        update(); return;
      }
      const before = capture(rows);
      for (const row of rows) finish(row);
      update();
      const after = capture(rows);
      const style = getComputedStyle(rows[0]);
      const duration = parseFloat(style.getPropertyValue('--card-motion-duration')) || 280;
      const easing = style.getPropertyValue('--card-motion-easing').trim() || 'ease-out';
      for (const row of rows) running.set(row, []);
      const animate = (row, element, keyframes) => {
        const animation = element.animate(keyframes, { duration, easing, fill: 'both' });
        running.get(row).push(animation);
      };
      for (let i = 0; i < after.length; i++) {
        const a = before[i], b = after[i];
        if (!a.rect.width || !a.rect.height || !b.rect.width || !b.rect.height) continue;
        const children = b.children.map(() => []);
        const matrix = (sx, sy, x, y) => `matrix(${sx}, 0, 0, ${sy}, ${x}, ${y})`;
        // Sample the reciprocal scale so parent and child cancel throughout the
        // animation, not just at the endpoints. All interpolation is composited.
        for (let step = 0; step <= 16; step++) {
          const t = step / 16, u = 1 - t;
          const sx = (a.rect.width * u + b.rect.width * t) / b.rect.width;
          const sy = (a.rect.height * u + b.rect.height * t) / b.rect.height;
          for (let j = 0; j < b.children.length; j++) {
            const hidden = !a.expanded && !b.expanded && Math.abs(a.rect.height - b.rect.height) < .1;
            if (hidden && b.children[j].element.matches('.apply-button, .card-controls')) continue;
            const old = a.children[j].rect, next = b.children[j].rect;
            const x = ((old.x - a.rect.x) * u + (next.x - b.rect.x) * t) / sx - (next.x - b.rect.x);
            const y = ((old.y - a.rect.y) * u + (next.y - b.rect.y) * t) / sy - (next.y - b.rect.y);
            children[j].push({ transform: matrix(1 / sx, 1 / sy, x, y), transformOrigin: '0 0' });
          }
        }
        animate(b.row, b.element, [
          { transformOrigin: '0 0', transform: matrix(a.rect.width / b.rect.width, a.rect.height / b.rect.height, a.rect.x - b.rect.x, a.rect.y - b.rect.y) },
          { transformOrigin: '0 0', transform: 'none' },
        ]);
        for (let j = 0; j < b.children.length; j++) if (children[j].length) animate(b.row, b.children[j].element, children[j]);
        // The chart stays centered as the card changes width. It is not stretched
        // along with the card, including when an in-flight hover is interrupted.
        if (a.thumbnailRect?.width && b.thumbnailRect?.width) {
          const oldTop = a.children[0].rect, nextTop = b.children[0].rect;
          const viewBox = b.thumbnail.viewBox.baseVal;
          const oldScale = Math.min(a.thumbnailRect.width / viewBox.width, a.thumbnailRect.height / viewBox.height);
          const nextScale = Math.min(b.thumbnailRect.width / viewBox.width, b.thumbnailRect.height / viewBox.height);
          const x = a.thumbnailRect.x + a.thumbnailRect.width / 2 - oldTop.x -
            (b.thumbnailRect.x + b.thumbnailRect.width / 2 - nextTop.x);
          const y = a.thumbnailRect.y + a.thumbnailRect.height / 2 - oldTop.y -
            (b.thumbnailRect.y + b.thumbnailRect.height / 2 - nextTop.y);
          animate(b.row, b.thumbnail, [
            { transformOrigin: '50% 50%', transform: `translate(${x}px, ${y}px) scale(${oldScale / nextScale})` },
            { transformOrigin: '50% 50%', transform: 'none' },
          ]);
        }
      }
      for (const row of rows) {
        const animations = running.get(row);
        if (!animations.length) { running.delete(row); continue; }
        animations[0].onfinish = () => { if (running.get(row) === animations) finish(row); };
      }
    },
  };
}
