import { canvasGeometry, resizeCanvasAction } from './canvas-geometry.js';

export function centerCanvasContent(program, view, guideCall) {
  // Native margins sometimes retain large guide reservations after faceting.
  // Redistribute empty space through public calls, keeping exports/history
  // identical to the displayed Canvas and createGuides as the final call.
  const geometry = canvasGeometry(view), b = geometry?.content;
  if (b && (!geometry.composition || geometry.facet && geometry.spacing === 'plot') &&
    (Math.abs(geometry.width - b.left - b.right) > 1 || Math.abs(geometry.height - b.top - b.bottom) > 1)) {
    const centered = resizeCanvasAction(geometry, 'canvas-se', 0, 0);
    try {
      let next = program;
      const calls = [...(centered.setupCalls ?? []), { method: centered.method, args: centered.args }];
      for (const entry of calls) next = next[entry.method](entry.args);
      const fitted = next.createGuides(guideCall.args);
      const after = canvasGeometry(fitted), a = after.content;
      const imbalance = g => Math.abs(g.width - g.content.left - g.content.right) + Math.abs(g.height - g.content.top - g.content.bottom);
      // Explicit titles/annotations may be anchored to the outer Canvas.
      // Preserve them if moving the plot would worsen their arrangement.
      if (a && imbalance(after) < imbalance(geometry) - .5 &&
        Math.abs(after.width - geometry.width) < 1 && Math.abs(after.height - geometry.height) < 1) {
        return { program: next, view: fitted, calls };
      }
    } catch {
      // Centering may not violate a native explicitly positioned guide.
      // The user's actual action remains valid and is never discarded.
    }
  }
  return { program, view, calls: [] };
}
