// The player's existing raster transition preserves every mark at both ends.
// Use it when interpolating dense path commands would monopolize each frame;
// node count alone treats a long polyline as one cheap circle.
export function transitionNodeBudget(scene, operationBudget = 3000) {
  const nodes = scene.nodes.length;
  const work = scene.nodes.reduce((sum, node) => sum + 1 + (node.properties?.commands?.length ?? 0), 0);
  return Math.max(1, Math.floor(operationBudget * nodes / Math.max(nodes, work, 1)));
}
