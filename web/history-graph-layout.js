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
    height: padding * 2 + (nodes.length ? rowCount * (height + gapY) - gapY : 0), nodeWidth: width, nodeHeight: height, gapX, gapY, padding };
}

// Node geometry is measured once at half Linear View size. Fitting changes only
// the uniform camera scale, never a node's width/height or its aspect ratio.
export function historyGraphRowZoom(layout, viewportHeight, rows = 2) {
  return viewportHeight / (rows * layout.nodeHeight + (rows - 1) * layout.gapY + 2 * layout.padding);
}

const viewportIndexes = new WeakMap();

// A viewport can intersect a connector whose endpoints are both offscreen.
// Index nodes by depth/row and connector intervals by their maximum bottom;
// scrolling then visits visible geometry instead of scanning the whole tree.
export function queryHistoryGraph(layout, { left, top, right, bottom }, stats = null) {
  let index = viewportIndexes.get(layout);
  if (!index) {
    const columns = [];
    for (let i = 0; i < layout.items.length; i++) {
      const node = layout.items[i], parent = layout.positions.get(node.parentId);
      const column = columns[node.depth] ??= { nodes: [], edges: [] };
      column.nodes.push({ node, i });
      if (parent) column.edges.push({ i, top: Math.min(parent.y, node.y) + layout.nodeHeight / 2,
        bottom: Math.max(parent.y, node.y) + layout.nodeHeight / 2 });
    }
    for (const column of columns) {
      if (!column) continue;
      column.nodes.sort((a, b) => a.node.y - b.node.y);
      column.edges.sort((a, b) => a.top - b.top);
      const size = 2 ** Math.ceil(Math.log2(Math.max(1, column.edges.length)));
      const maxBottom = new Float64Array(2 * size).fill(-Infinity);
      for (let i = 0; i < column.edges.length; i++) maxBottom[size + i] = column.edges[i].bottom;
      for (let i = size - 1; i > 0; i--) maxBottom[i] = Math.max(maxBottom[2 * i], maxBottom[2 * i + 1]);
      column.size = size; column.maxBottom = maxBottom;
    }
    index = { columns, stride: layout.nodeWidth + layout.gapX };
    viewportIndexes.set(layout, index);
  }
  const matches = new Set(), { columns, stride } = index;
  const gapX = stride - layout.nodeWidth;
  const first = Math.max(0, Math.ceil((left - layout.padding - layout.nodeWidth) / stride));
  const last = Math.min(columns.length - 1, Math.floor((right - layout.padding + gapX) / stride));
  for (let depth = first; depth <= last; depth++) {
    const column = columns[depth]; if (!column) continue;
    const x = layout.padding + depth * stride;
    if (x <= right && x + layout.nodeWidth >= left) {
      let lo = 0, hi = column.nodes.length;
      while (lo < hi) {
        if (stats) stats.visited = (stats.visited ?? 0) + 1;
        const mid = (lo + hi) >>> 1;
        if (column.nodes[mid].node.y + layout.nodeHeight < top) lo = mid + 1; else hi = mid;
      }
      for (let i = lo; i < column.nodes.length && column.nodes[i].node.y <= bottom; i++) {
        if (stats) stats.visited = (stats.visited ?? 0) + 1;
        matches.add(column.nodes[i].i);
      }
    }
    if (x >= left && x - gapX <= right) {
      const visit = (at, start, end) => {
        if (stats) stats.visited = (stats.visited ?? 0) + 1;
        if (start >= column.edges.length || column.edges[start].top > bottom || column.maxBottom[at] < top) return;
        if (end - start === 1) { matches.add(column.edges[start].i); return; }
        const middle = (start + end) >>> 1;
        visit(at * 2, start, middle); visit(at * 2 + 1, middle, end);
      };
      visit(1, 0, column.size);
    }
  }
  // Preserve the original chronological paint order where connectors overlap.
  return [...matches].sort((a, b) => a - b).map(i => layout.items[i]);
}
