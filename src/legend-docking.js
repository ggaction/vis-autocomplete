import { findGraphic } from '../vendor/ggaction/src/grammar/schemas/graphicTree.js';
import { resolveConcreteGraphicBounds } from '../vendor/ggaction/src/grammar/schemas/graphicBounds.js';

const measurements = new WeakMap();

// Docking is a layout choice, separate from a pixel nudge. Measure the painted
// entries (including mapped/multiline labels and compound glyphs), not raw data.
export function legendDockMetrics(program, target, width) {
  let cached = measurements.get(program);
  if (!cached) measurements.set(program, cached = new Map());
  const key = JSON.stringify([target.ids, width]);
  if (cached.has(key)) return cached.get(key);
  const leaves = id => {
    const object = findGraphic(program.graphicSpec, id)?.object;
    return object?.children?.length ? object.children.flatMap(leaves) : object ? [{ id, object }] : [];
  };
  const graphics = target.ids.flatMap(leaves).filter(({ id }) => !/(Title|Border|Background)$/.test(id));
  const labels = graphics.filter(({ object }) => object.type === 'text').flatMap(({ object }) => object.items ?? []);
  const bounds = id => resolveConcreteGraphicBounds(program.graphicSpec, id, program.materializationConfigs.textMetrics);
  const symbols = graphics.filter(({ object }) => object.type !== 'text').flatMap(({ object }) => object.items ?? []);
  const sampleWidth = Math.max(target.representation === 'categorical' ? 0 : 32,
    ...symbols.map(item => { const b = bounds(item.id); return b ? b.right - b.left : 0; }));
  const result = { representation: target.representation, family: target.family, width, itemGap: target.config.itemGap ?? 18,
    itemWidths: labels.map(item => { const b = bounds(item.id);
      return sampleWidth + (target.config.labels?.offset ?? 8) + (b ? b.right - b.left : 0); }) };
  cached.set(key, result);
  return result;
}

export function legendDockLayout(metrics, position, itemGap = metrics?.itemGap) {
  if (!metrics) return {};
  const horizontal = ['top', 'bottom'].includes(position);
  // Opacity's native samples derive their orientation from the edge; that
  // family intentionally has no public grid/direction controls.
  if (metrics.family === 'opacity') return { titlePosition: 'top' };
  if (metrics.representation === 'gradient') return { direction: horizontal ? 'horizontal' : 'vertical' };
  const widths = metrics.itemWidths, gap = itemGap ?? 18;
  let columns = 1;
  if (horizontal && widths.length) {
    columns = Math.min(widths.length, Math.max(1, Math.floor((metrics.width + gap) / (Math.min(...widths) + gap))));
    for (; columns > 1; columns--) {
      const slots = Array(columns).fill(0);
      widths.forEach((width, index) => { slots[index % columns] = Math.max(slots[index % columns], width); });
      if (slots.reduce((a, b) => a + b, 0) + gap * (columns - 1) <= metrics.width) break;
    }
  }
  return { layout: 'edge', direction: horizontal ? 'horizontal' : 'vertical', columns, titlePosition: 'top' };
}
