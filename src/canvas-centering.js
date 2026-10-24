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

// Adjacent views inherit generous single-chart margins. Remove only empty
// horizontal canvas space once, on insertion, using replayable public edits.
export function compactAdjacentCanvases(program, view, guideCall) {
  const calls = [];
  const visit = (local, path = []) => {
    if (local.compositionSpec && !local.compositionSpec.facet) {
      for (const id of local.compositionSpec.children) visit(local.children[id], [...path, id]);
      return;
    }
    const g = canvasGeometry(local), b = g?.content;
    if (!b || g.composition) return;
    const margin = { ...g.margin,
      left: Math.min(g.margin.left, Math.max(0, g.margin.left - b.left + 8)),
      right: Math.min(g.margin.right, Math.max(0, g.margin.right - (g.width - b.right) + 8)) };
    if (g.margin.left + g.margin.right - margin.left - margin.right < 1) return;
    const call = { method: 'editCanvas', args: { target: { childPath: path }, plot: g.plot, margin } };
    try {
      const next = program.editCanvas(call.args), fitted = next.createGuides(guideCall.args);
      let child = fitted; for (const id of path) child = child.children[id];
      const after = canvasGeometry(child), bounds = after.content;
      if (!bounds || bounds.left < -0.5 || bounds.right > after.width + 0.5) return;
      program = next; view = fitted; calls.push(call);
    } catch {
      // Keep explicit guide placements that need their existing canvas space.
    }
  };
  visit(view);
  return { program, view, calls };
}
