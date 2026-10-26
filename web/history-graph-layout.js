// Ordered horizontal/vertical tree: each subtree occupies contiguous rows.
// First children continue their parent's row; later branches follow the whole
// preceding subtree, so unrelated connectors cannot cross. Adding a branch
// inserts one row and shifts only the rows below it. Extending a leaf moves no
// existing nodes. Creation order guarantees parents precede their children.
export function layoutHistoryGraph(nodes, { width = 75, height = 48, gapX = 32, gapY = 22, padding = 12 } = {}) {
  const positions = new Map(), subtreeRows = new Map(), nextRows = new Map();
  let rowCount = 0, maxDepth = 0;
  const items = nodes.map(node => {
    const parent = positions.get(node.parentId);
    const depth = parent ? parent.depth + 1 : 0;
    const item = { ...node, depth, x: padding + depth * (width + gapX) };
    maxDepth = Math.max(maxDepth, depth); positions.set(node.id, item); return item;
  });
  // Count leaves bottom-up, then allocate sibling bands in creation order.
  // Both passes are linear and iterative, including very deep histories.
  for (let i = items.length - 1; i >= 0; i--) {
    const node = items[i], span = Math.max(1, subtreeRows.get(node.id) ?? 0);
    subtreeRows.set(node.id, span);
    if (positions.has(node.parentId)) subtreeRows.set(node.parentId, (subtreeRows.get(node.parentId) ?? 0) + span);
  }
  for (const node of items) {
    const parent = positions.get(node.parentId), span = subtreeRows.get(node.id);
    node.row = parent ? nextRows.get(parent.id) ?? parent.row : rowCount;
    node.y = padding + node.row * (height + gapY);
    if (parent) nextRows.set(parent.id, node.row + span);
    else rowCount += span;
  }
  return { items, positions, width: padding * 2 + (nodes.length ? (maxDepth + 1) * (width + gapX) - gapX : 0),
    height: padding * 2 + (nodes.length ? rowCount * (height + gapY) - gapY : 0), nodeWidth: width, nodeHeight: height, gapY, padding };
}

// Node geometry is measured once at half Linear View size. Fitting changes only
// the uniform camera scale, never a node's width/height or its aspect ratio.
export function historyGraphRowZoom(layout, viewportHeight, rows = 2) {
  return viewportHeight / (rows * layout.nodeHeight + (rows - 1) * layout.gapY + 2 * layout.padding);
}
