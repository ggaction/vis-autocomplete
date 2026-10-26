import { OPTION_GROUPS } from './option-groups.js';
import { historyLabel, historyPreview } from './history.js';
import { prepareHistorySnapshot } from './project.js';
import { layoutHistoryGraph, historyGraphRowZoom } from './history-graph-layout.js';
import { createLRU } from '../src/cache.js';

export function createHistoryGraphView(host, { renderChart, onPreview, onLeave, onJump, meta, controls }) {
  const stage = document.createElement('div'); stage.className = 'history-graph-stage';
  const edges = document.createElement('canvas'); edges.className = 'history-graph-edges'; edges.setAttribute('aria-hidden', 'true');
  const layer = document.createElement('div'); layer.className = 'history-graph-nodes';
  host.append(stage, edges, layer);
  const mounted = new Map(), thumbnails = createLRU(80);
  let layout = layoutHistoryGraph([]), current = null, activePath = new Set(), zoom = 1, busy = false;
  let shown = false, history = null, revision = -1, frame = null, hovered = null, serial = 0, painting = false, drag = null;
  let suppressedClick = false, graphRoot = null, pointer = null;
  let nodeHeight = null, automaticZoom = true, leaveTimer = null;
  const toolbar = document.createElement('span'); toolbar.className = 'history-graph-tools'; toolbar.hidden = true;
  const tool = (label, text, run) => {
    const button = document.createElement('button'); button.type = 'button'; button.title = label; button.setAttribute('aria-label', label);
    button.textContent = text; button.addEventListener('click', run); toolbar.append(button); return button;
  };
  const zoomOut = tool('Zoom out history graph', '−', () => setZoom(zoom / 1.25));
  const percentage = tool('Reset history graph zoom', '100%', () => { automaticZoom = true; refreshLayout(); centerCurrent(); });
  const zoomIn = tool('Zoom in history graph', '+', () => setZoom(zoom * 1.25));
  tool('Fit history graph', 'Fit', () => { setZoom(Math.min((host.clientWidth - 8) / layout.width, (host.clientHeight - 8) / layout.height)); host.scrollTo(0, 0); });
  tool('Center current history state', 'Current', () => centerCurrent());
  controls.append(toolbar);

  function schedule() { if (shown && frame === null) frame = requestAnimationFrame(() => { frame = null; draw(); }); }
  function extent() { stage.style.width = `${layout.width * zoom}px`; stage.style.height = `${layout.height * zoom}px`; }
  function setZoom(value, anchor = { x: host.clientWidth / 2, y: host.clientHeight / 2 }, automatic = false) {
    automaticZoom = automatic;
    const next = Math.max(.001, Math.min(16, value));
    const x = (host.scrollLeft + anchor.x) / zoom, y = (host.scrollTop + anchor.y) / zoom;
    zoom = next; extent(); host.scrollLeft = x * zoom - anchor.x; host.scrollTop = y * zoom - anchor.y;
    percentage.textContent = `${Number((zoom * 100).toFixed(1))}%`; zoomOut.disabled = zoom <= .001; zoomIn.disabled = zoom >= 16;
    clear(); schedule();
  }
  function centerCurrent() {
    const node = layout.positions.get(current); if (!node) return;
    host.scrollTo(Math.max(0, (node.x + layout.nodeWidth / 2) * zoom - host.clientWidth / 2),
      automaticZoom ? Math.max(0, node.row - 1) * (layout.nodeHeight + layout.gapY) * zoom
        : Math.max(0, (node.y + layout.nodeHeight / 2) * zoom - host.clientHeight / 2)); schedule();
  }
  function cancelLeave() {
    if (leaveTimer !== null) clearTimeout(leaveTimer);
    leaveTimer = null;
  }
  function leaveBetweenNodes() {
    // Match option-card gaps: hold the last preview while crossing an edge.
    // Repeated movement in blank space must not postpone leaving indefinitely.
    if (hovered === null || leaveTimer !== null) return;
    leaveTimer = setTimeout(() => { leaveTimer = null; clear(); }, 180);
  }
  function clear({ restore = true } = {}) {
    cancelLeave();
    const previous = hovered; hovered = null; serial++; meta.textContent = '';
    for (const button of mounted.values()) button.classList.remove('inspecting');
    if (previous && restore) onLeave();
  }
  async function preview(id) {
    if (busy || drag) return;
    const node = layout.positions.get(id); if (!node) return;
    cancelLeave();
    if (hovered === id) return;
    clear({ restore: false }); hovered = id; const token = serial;
    mounted.get(id)?.classList.add('inspecting');
    meta.textContent = `#${node.ordinal} ${historyLabel(node.snapshot)}`;
    try {
      await prepareHistorySnapshot(node.snapshot);
      if (serial === token && hovered === id && shown && !busy) onPreview(node.snapshot, node.ordinal);
    } catch { /* The committed chart remains available. */ }
  }
  function queuePaint() {
    if (painting || !shown) return;
    const button = [...mounted.values()].find(button => !button.dataset.painted && button.dataset.nodeId === current)
      ?? [...mounted.values()].find(button => !button.dataset.painted);
    if (!button) return;
    painting = true;
    const node = layout.positions.get(button.dataset.nodeId), snapshot = node.snapshot;
    const paint = async () => {
      try {
        if (!shown || !button.isConnected) return;
        let thumb = thumbnails.get(snapshot);
        if (thumb?.querySelector('canvas') && !thumb.querySelector('canvas').dataset.paint) thumb = null;
        if (!thumb) {
          await prepareHistorySnapshot(snapshot);
          if (!shown || !button.isConnected || layout.positions.get(node.id)?.snapshot !== snapshot) return;
          thumb = button.querySelector('.history-thumbnail');
          await renderChart(thumb, historyPreview(snapshot), historyLabel(snapshot));
          thumbnails.set(snapshot, thumb);
        } else {
          // Cached raster pixels may serve several states with the same snapshot;
          // never move a live thumbnail out of another node.
          const copy = thumb.cloneNode(true);
          const source = thumb.querySelector('canvas'), canvas = copy.querySelector('canvas');
          if (source && canvas) canvas.getContext('2d').drawImage(source, 0, 0);
          button.querySelector('.history-thumbnail').replaceWith(copy);
        }
        button.dataset.painted = 'true';
      } catch (error) {
        button.dataset.painted = 'error'; button.title += ` — ${error.message}`;
      } finally { painting = false; queuePaint(); }
    };
    if (globalThis.requestIdleCallback) requestIdleCallback(paint, { timeout: 300 }); else setTimeout(paint, 20);
  }
  function makeNode(node) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'history-item history-graph-node';
    button.dataset.nodeId = node.id;
    const group = OPTION_GROUPS.find(group => group.id === node.snapshot.optionGroup) ?? OPTION_GROUPS[0];
    button.style.setProperty('--history-accent', group.color); button.style.setProperty('--history-rgb', group.rgb);
    const thumb = document.createElement('span'); thumb.className = 'history-thumbnail'; thumb.dataset.chartZoom = '3';
    const caption = document.createElement('span'); caption.className = 'history-caption';
    caption.textContent = `${node.ordinal}. ${historyLabel(node.snapshot)}`;
    button.title = caption.textContent; button.setAttribute('aria-label', `History #${node.ordinal}: ${historyLabel(node.snapshot)}`);
    button.append(thumb, caption);
    button.addEventListener('pointerenter', event => { pointer = { x: event.clientX, y: event.clientY }; preview(node.id); });
    button.addEventListener('pointerleave', () => { if (hovered === node.id) leaveBetweenNodes(); });
    button.addEventListener('focus', () => preview(node.id));
    button.addEventListener('click', () => { if (!busy && !suppressedClick) { clear({ restore: false }); onJump(node.id); } });
    mounted.set(node.id, button); layer.append(button); return button;
  }
  function draw() {
    if (!shown || !host.clientWidth || !host.clientHeight) return;
    const sx = host.scrollLeft, sy = host.scrollTop, w = host.clientWidth, h = host.clientHeight, ratio = devicePixelRatio || 1;
    // Only viewport pixels are allocated, even for a very long history.
    edges.style.width = `${w}px`; edges.style.height = `${h}px`; edges.style.left = `${sx}px`; edges.style.top = `${sy}px`;
    if (edges.width !== Math.ceil(w * ratio) || edges.height !== Math.ceil(h * ratio)) { edges.width = Math.ceil(w * ratio); edges.height = Math.ceil(h * ratio); }
    const ctx = edges.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, w, h);
    ctx.translate(-sx, -sy); ctx.scale(zoom, zoom);
    const visible = new Set();
    for (const node of layout.items) {
      const parent = layout.positions.get(node.parentId);
      if (parent) {
        const x1 = parent.x + layout.nodeWidth, y1 = parent.y + layout.nodeHeight / 2, x2 = node.x, y2 = node.y + layout.nodeHeight / 2;
        if (x2 * zoom >= sx && x1 * zoom <= sx + w && Math.max(y1, y2) * zoom >= sy && Math.min(y1, y2) * zoom <= sy + h) {
          ctx.strokeStyle = activePath.has(node.id) ? '#607e98' : '#c5cdd5'; ctx.lineWidth = activePath.has(node.id) ? 1.5 : 1;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + 16, y1); ctx.lineTo(x1 + 16, y2); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x2 - 4, y2 - 2.5); ctx.lineTo(x2, y2); ctx.lineTo(x2 - 4, y2 + 2.5); ctx.stroke();
        }
      }
      if ((node.x + layout.nodeWidth) * zoom < sx - 40 || node.x * zoom > sx + w + 40 ||
          (node.y + layout.nodeHeight) * zoom < sy - 40 || node.y * zoom > sy + h + 40) continue;
      if (zoom < .5) {
        ctx.fillStyle = node.id === current ? '#0a6fc2' : activePath.has(node.id) ? '#d5e6f5' : '#eef1f4';
        ctx.strokeStyle = node.id === current ? '#0a6fc2' : '#859aaf'; ctx.lineWidth = 1 / zoom;
        ctx.fillRect(node.x, node.y, layout.nodeWidth, layout.nodeHeight);
        ctx.strokeRect(node.x, node.y, layout.nodeWidth, layout.nodeHeight);
        continue;
      }
      visible.add(node.id);
      const button = mounted.get(node.id) ?? makeNode(node);
      button.style.left = `${node.x * zoom}px`; button.style.top = `${node.y * zoom}px`;
      button.style.width = `${layout.nodeWidth}px`; button.style.height = `${layout.nodeHeight}px`; button.style.transform = `scale(${zoom})`;
      button.disabled = busy; button.classList.toggle('on-path', activePath.has(node.id));
      button.classList.toggle('inspecting', hovered === node.id);
      if (node.id === current) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    }
    for (const [id, button] of mounted) if (!visible.has(id)) { button.remove(); mounted.delete(id); }
    host.classList.toggle('history-overview', zoom < .5);
    host.title = zoom < .5 ? 'Overview · double-click to zoom in' : 'Drag empty space or scroll to pan · Ctrl/Cmd + wheel to zoom';
    host.dataset.zoom = zoom; host.dataset.automaticZoom = String(automaticZoom); host.dataset.nodeCount = layout.items.length;
    queuePaint();
    if (pointer && !drag) {
      const target = document.elementFromPoint(pointer.x, pointer.y)?.closest('.history-graph-node');
      if (target && host.contains(target)) preview(target.dataset.nodeId); else if (zoom >= .5) leaveBetweenNodes();
    }
  }
  host.addEventListener('scroll', () => { if (pointer && !drag) leaveBetweenNodes(); schedule(); }, { passive: true });
  host.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault(); const rect = host.getBoundingClientRect();
    setZoom(zoom * Math.exp(-event.deltaY * .008), { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }, { passive: false });
  host.addEventListener('dblclick', event => {
    if (zoom >= .5) return;
    const rect = host.getBoundingClientRect();
    setZoom(1, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  });
  host.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    clear(); drag = { x: event.clientX, y: event.clientY, left: host.scrollLeft, top: host.scrollTop, id: event.pointerId };
    host.setPointerCapture(event.pointerId); host.classList.add('is-panning'); event.preventDefault();
  });
  host.addEventListener('pointermove', event => {
    if (!drag) return;
    host.scrollLeft = drag.left + drag.x - event.clientX; host.scrollTop = drag.top + drag.y - event.clientY;
  });
  const stopDrag = () => { if (drag) { suppressedClick = true; setTimeout(() => { suppressedClick = false; }, 0); } drag = null; host.classList.remove('is-panning'); };
  host.addEventListener('pointerup', stopDrag); host.addEventListener('pointercancel', stopDrag); host.addEventListener('lostpointercapture', stopDrag);
  host.addEventListener('pointerleave', () => { pointer = null; if (!drag) clear(); });
  host.addEventListener('focusout', event => { if (!host.contains(event.relatedTarget)) clear(); });
  host.addEventListener('keydown', event => {
    if (event.key === 'Escape') { pointer = null; clear(); return; }
    const node = layout.positions.get(event.target.dataset.nodeId); if (!node) return;
    const siblings = layout.items.filter(item => item.parentId === node.parentId), at = siblings.findIndex(item => item.id === node.id);
    const id = event.key === 'ArrowLeft' ? node.parentId : event.key === 'ArrowRight' ? node.preferredChildId ?? node.children[0]
      : event.key === 'ArrowDown' ? siblings[at + 1]?.id : event.key === 'ArrowUp' ? siblings[at - 1]?.id
      : event.key === 'Home' ? layout.items[0]?.id : event.key === 'End' ? current : null;
    if (!id) return;
    event.preventDefault(); pointer = null; const target = layout.positions.get(id);
    host.scrollTo(Math.max(0, target.x * zoom - host.clientWidth / 2), Math.max(0, target.y * zoom - host.clientHeight / 2));
    draw(); mounted.get(id)?.focus({ preventScroll: true });
  });
  new ResizeObserver(() => { if (shown) refreshLayout(); }).observe(host);
  function refreshLayout() {
    if (!history || !shown || !host.clientHeight) return;
    // Freeze the half-size geometry on first reveal. Scrollbars and panel
    // resizing can change viewport height; they must never stretch the nodes.
    nodeHeight ??= Math.max(1, host.clientHeight - 14) / 2;
    if (revision !== history.revision || layout.nodeHeight !== nodeHeight) {
      const records = history.nodes.map((node, ordinal) => ({ ...node, ordinal }));
      layout = layoutHistoryGraph(records, { width: 75, height: nodeHeight }); revision = history.revision; extent();
    }
    if (automaticZoom) {
      const fitted = historyGraphRowZoom(layout, host.clientHeight);
      if (Math.abs(fitted - zoom) > 1e-6) {
        setZoom(fitted, undefined, true); centerCurrent();
      }
    }
    schedule();
  }
  return {
    clear, release() {}, move(event) {
      pointer = { x: event.clientX, y: event.clientY };
      const node = event.target.closest('.history-graph-node');
      if (node && host.contains(node)) preview(node.dataset.nodeId);
      else if (!drag) leaveBetweenNodes();
    },
    refreshLayout,
    setVisible(value) { shown = value; toolbar.hidden = !value; host.hidden = !value; if (!value) { pointer = null; clear(); } else { refreshLayout(); centerCurrent(); } },
    update(next, locked) {
      history = next; busy = locked; host.setAttribute('aria-busy', String(busy));
      const changed = current !== history.activeId; current = history.activeId;
      const ids = history.pathIds; activePath = new Set(ids.slice(0, history.index + 1));
      const root = history.nodes[0]?.id;
      if (graphRoot !== root) { clear(); graphRoot = root; thumbnails.clear(); revision = -1; }
      if (revision !== history.revision) { for (const button of mounted.values()) button.remove(); mounted.clear(); }
      refreshLayout(); if (shown && changed) centerCurrent(); schedule();
    },
  };
}
