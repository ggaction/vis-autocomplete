// Stable horizontal/vertical history tree. First children continue the row;
// each later branch claims the next free row. Existing nodes never move when
// a branch grows. Creation order guarantees parents have already been placed.
export function layoutHistoryGraph(nodes, { width = 75, height = 48, gapX = 32, gapY = 22, padding = 12 } = {}) {
  const positions = new Map(), rows = new Map();
  let lastRow = 0, maxDepth = 0;
  const items = nodes.map(node => {
    const parent = positions.get(node.parentId);
    const depth = parent ? parent.depth + 1 : 0;
    let row = parent?.row ?? 0;
    if (parent && rows.has(node.parentId)) row = ++lastRow;
    if (parent) rows.set(node.parentId, true);
    const item = { ...node, depth, row, x: padding + depth * (width + gapX), y: padding + row * (height + gapY) };
    maxDepth = Math.max(maxDepth, depth); positions.set(node.id, item); return item;
  });
  return { items, positions, width: padding * 2 + (nodes.length ? (maxDepth + 1) * (width + gapX) - gapX : 0),
    height: padding * 2 + (nodes.length ? (lastRow + 1) * (height + gapY) - gapY : 0), nodeWidth: width, nodeHeight: height, gapY, padding };
}

// Node geometry is measured once at half Linear View size. Fitting changes only
// the uniform camera scale, never a node's width/height or its aspect ratio.
export function historyGraphRowZoom(layout, viewportHeight, rows = 2) {
  return viewportHeight / (rows * layout.nodeHeight + (rows - 1) * layout.gapY + 2 * layout.padding);
}
