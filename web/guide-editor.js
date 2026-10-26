import { selectableGuides, guideBounds, removeGuide, guideMoveHistoryKey } from '../src/guide-manipulation.js';
import { manipulationTargets, manipulationCalls, guideDragTarget } from '../src/guide-group.js';
import { removableChartPanels } from '../src/chart-removal.js';
import { canvasGeometry } from './canvas-geometry.js';
import { createGuideNudge } from './guide-nudge.js';

// Resize along the edge being dragged, not a projection onto the box diagonal.
// A wide horizontal legend must respond to a vertical drag just as a tall one does.
export function guideResizeFactor(bounds, dx, dy, edge = 'se') {
  const horizontal = edge.includes('e') ? dx : edge.includes('w') ? -dx : null;
  const vertical = edge.includes('s') ? dy : edge.includes('n') ? -dy : null;
  const x = horizontal === null ? null : horizontal / Math.max(1, bounds.right - bounds.left);
  const y = vertical === null ? null : vertical / Math.max(1, bounds.bottom - bounds.top);
  return 1 + (x === null ? y : y === null ? x : Math.abs(x) > Math.abs(y) ? x : y);
}

export function createGuideEditor(host, callbacks) {
  let display, targets = [], targetSource, active, overlay, gesture, stage, press;
  let selected = new Set(), scope;
  // Pointer selection must move keyboard focus out of a previous text input.
  // Keep it on the stable host while previews replace guide buttons.
  if (!host.hasAttribute('tabindex')) host.tabIndex = -1;
  const measured = new WeakMap();
  function paintSelection() {
    for (const node of overlay?.children ?? []) {
      const pinned = selected.has(node.dataset.guideKey);
      node.classList.toggle('selected', pinned);
      node.querySelector('.guide-hit')?.setAttribute('aria-pressed', String(pinned));
    }
  }
  function setSelection(keys) {
    const next = new Set(keys);
    if (JSON.stringify([...next].sort()) === JSON.stringify([...selected].sort())) return;
    nudge.cancel();
    selected = next; paintSelection(); callbacks.selectionChanged?.();
  }
  function pin(key, additive = false) {
    const next = additive ? new Set(selected) : new Set();
    if (additive && next.has(key)) next.delete(key); else next.add(key);
    setSelection(next);
  }
  function select(key, force = false) {
    if (!force && active?.key === key && host.dataset.guideHover === key) return;
    active = targets.find(target => target.key === key);
    if (active) host.dataset.guideHover = active.key; else delete host.dataset.guideHover;
    for (const node of overlay?.querySelectorAll('.guide-control') ?? []) {
      node.classList.toggle('active', node.dataset.guideKey === active?.key);
      node.classList.toggle('owner-active', active?.legendPart !== 'title' && active?.legendKey === node.dataset.guideKey);
      node.classList.toggle('owner-items-active', active?.legendPart === 'items' && active.legendKey === node.dataset.guideKey);
    }
  }
  function mount(program) {
    display = program; stage = host.querySelector('.canvas-stage');
    if (!stage || !callbacks.available()) { clear(); return; }
    if (scope !== callbacks.scope?.()) { scope = callbacks.scope?.(); setSelection([]); }
    const source = gesture?.source ?? callbacks.program();
    const changed = targetSource !== source;
    if (changed) {
      targets = [...removableChartPanels(source), ...selectableGuides(source)]; targetSource = source;
      setSelection([...selected].filter(key => targets.some(t => t.key === key)));
    }
    let boundsByKey = measured.get(program);
    if (!boundsByKey) { boundsByKey = new Map(); measured.set(program, boundsByKey); }
    const old = active?.key;
    overlay = stage.querySelector('.guide-editor');
    if (!overlay) { overlay = document.createElement('div'); overlay.className = 'guide-editor'; stage.append(overlay); }
    const scale = stage.clientWidth / canvasGeometry(program).width;
    if (changed) overlay.replaceChildren();
    const existing = new Map([...overlay.children].map(node => [node.dataset.guideKey, node]));
    for (const target of targets) {
      if (!boundsByKey.has(target.key)) boundsByKey.set(target.key, program === source ? target.bounds : guideBounds(program, target.ids));
      const bounds = boundsByKey.get(target.key);
      if (!bounds) { existing.get(target.key)?.remove(); continue; }
      const isTitleGroup = target.kind === 'title' && !target.part;
      const pad = isTitleGroup ? 10 : 3;
      const retained = existing.get(target.key);
      const node = retained ?? document.createElement('div'); node.className = 'guide-control'; node.dataset.guideKey = target.key;
      node.dataset.guideKind = target.kind;
      node.classList.toggle('legend-container', target.kind === 'legend' && !target.part);
      node.classList.toggle('compact-guide', (bounds.right-bounds.left)*scale < 24 || (bounds.bottom-bounds.top)*scale < 16);
      // Contain parent resize handles below subpart hit areas, including those
      // of neighboring legends when a chart is displayed at a small scale.
      node.style.zIndex = target.kind === 'panel' || target.kind === 'legendGroup' ? '0' : isTitleGroup ? '1' : target.kind === 'legend' && target.part ? '3' : '2';
      node.classList.toggle('panel-control', target.kind === 'panel');
      Object.assign(node.style, { left: `${bounds.left*scale-pad}px`, top: `${bounds.top*scale-pad}px`,
        width: `${(bounds.right-bounds.left)*scale+pad*2}px`, height: `${(bounds.bottom-bounds.top)*scale+pad*2}px` });
      if (retained) { node.classList.toggle('active', target.key === (gesture?.target.key ?? old)); continue; }
      const hit = document.createElement('button'); hit.type = 'button'; hit.className = 'guide-hit';
      hit.dataset.guide = target.key; hit.setAttribute('aria-label', target.movable ? `Move ${target.label}` : `Select ${target.label}`);
      hit.style.cursor = target.movable ? 'move' : 'pointer';
      hit.addEventListener('click', event => {
        if (event.detail === 0 && callbacks.canStart()) { event.stopPropagation(); pin(target.key, event.shiftKey); }
      });
      const size = document.createElement('button'); size.type = 'button'; size.className = 'guide-size';
      size.dataset.guide = target.key; size.dataset.guideOperation = 'resize';
      size.dataset.guideEdge = 'se';
      size.setAttribute('aria-label', `Resize ${target.label}`); size.title = 'Drag to resize · arrow keys · Esc to cancel';
      if (target.kind !== 'panel' && target.hitTest !== false) node.append(hit);
      if (target.kind !== 'panel' && target.resizable !== false) node.append(size);
      if (target.deletable !== false) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'guide-delete';
        remove.textContent = '×'; remove.dataset.guide = target.key; remove.dataset.guideOperation = 'delete';
        remove.setAttribute('aria-label', `Delete ${target.label}`);
        remove.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation();
          if (!gesture && callbacks.available() && callbacks.canStart()) callbacks.remove(target, removeGuide(target));
        });
        node.append(remove);
      }
      if (target.kind === 'legend' && !target.part && target.resizable !== false) for (const edge of ['n', 'e', 's', 'w', 'ne', 'nw', 'sw']) {
        const handle = document.createElement('button'); handle.type = 'button';
        handle.className = `guide-edge guide-edge-${edge}`;
        handle.dataset.guide = target.key; handle.dataset.guideOperation = 'resize'; handle.dataset.guideEdge = edge;
        handle.setAttribute('aria-label', `Resize ${target.label} (${edge})`);
        handle.title = size.title; node.append(handle);
      }
      const titleGroup = target.kind === 'title' && target.part && targets.find(t =>
        t.kind === 'title' && !t.part && guideMoveHistoryKey(t) === guideMoveHistoryKey(target));
      if (titleGroup) {
        const together = document.createElement('button'); together.className = 'guide-together'; together.type = 'button';
        together.textContent = 'Together'; together.title = 'Resize title and subtitle together';
        together.addEventListener('click', event => { event.stopPropagation(); select(titleGroup.key); pin(titleGroup.key, event.shiftKey);
          [...overlay.querySelectorAll('[data-guide-operation="resize"]')].find(button=>button.dataset.guide===titleGroup.key)?.focus({preventScroll:true}); });
        node.append(together);
      }
      overlay.append(node);
    }
    select(gesture?.target.key ?? old, true);
    paintSelection();
  }
  function pointer(event) {
    if (gesture || !callbacks.available()) return;
    const button = event.target.closest('[data-guide]');
    if (button) select(button.dataset.guide);
    else if (!event.target.closest('.guide-control')) {
      const previous = [...overlay?.children ?? []].find(node => node.dataset.guideKey === active?.key)?.getBoundingClientRect();
      // Keep the corner control reachable from a very short/rotated title.
      if (previous && event.clientX >= previous.left - 18 && event.clientX <= previous.right + 18 &&
        event.clientY >= previous.top - 18 && event.clientY <= previous.bottom + 10) return;
      const panel = targets.find(target => {
        if (target.kind !== 'panel') return false;
        const node = [...overlay?.children ?? []].find(node => node.dataset.guideKey === target.key);
        const b = node?.getBoundingClientRect();
        return b && event.clientX >= b.left - 12 && event.clientX <= b.right + 12 &&
          event.clientY >= b.top - 12 && event.clientY <= b.bottom + 12 &&
          Math.min(Math.abs(event.clientX-b.left),Math.abs(event.clientX-b.right),Math.abs(event.clientY-b.top),Math.abs(event.clientY-b.bottom)) < 12;
      });
      select(panel?.key);
    }
  }
  host.addEventListener('pointermove', pointer);
  host.addEventListener('pointerleave', () => { if (!gesture) select(null); });
  host.addEventListener('focusin', event => { if (event.target.dataset.guide) select(event.target.dataset.guide); });
  host.addEventListener('focusout', event => { if (!gesture && !overlay?.contains(event.relatedTarget)) select(null); });
  function start(target, operation, event, edge = 'se') {
    if (gesture || !callbacks.available() || !callbacks.canStart() || operation === 'move' && !target.movable) return;
    const rect = stage.getBoundingClientRect(), source = callbacks.program();
    const members = manipulationTargets(targets, selected, target, operation);
    if (!members.length) return;
    const g = { target, members, operation, edge, source, rect, scale: rect.width/canvasGeometry(display).width,
      startX: event.clientX, startY: event.clientY, pointer: event.pointerId,
      pending: null, running: false, ended: false, final: null, key: null };
    gesture = g; g.context = callbacks.start(target, operation, members); host.classList.add('editing-guide');
    select(target.key); return g;
  }
  function update(g, x, y) {
    if (gesture !== g || g.ended) return;
    const dx = (x-g.startX)/g.scale, dy = (y-g.startY)/g.scale;
    if (!g.keyboard && Math.abs(dx)+Math.abs(dy)<2 && !g.final) return;
    const factor = guideResizeFactor(g.target.bounds, dx, dy, g.edge);
    const calls = manipulationCalls(g.source, g.members, g.operation, { factor, dx, dy,
      snapDistance: g.keyboard ? Infinity : 48/g.scale });
    const action = g.members.length > 1 ? { calls } : calls[0];
    const key = JSON.stringify(action); if (g.key === key) return;
    g.key = key; g.pending = { action, factor }; pump(g);
  }
  async function pump(g) {
    if (g.running) return; g.running = true;
    while (gesture === g && g.pending) {
      const { action, factor } = g.pending; g.pending = null;
      const accept = (prepared, accepted, ratio) => {
        g.final = accepted; g.validFactor = ratio; g.error = null; callbacks.preview(g.context,prepared);
      };
      try {
        const prepared = await callbacks.prepare(g.context,action);
        if (gesture !== g) break;
        if (prepared) accept(prepared, action, factor);
      } catch(error) {
        if (gesture !== g) break;
        if (error.reason === 'no-change') { g.final = null; g.validFactor = 1; callbacks.restore(g.context); }
        else if (g.operation === 'resize' && /overlap|space|margin|bounds|fit|outside/i.test(error.message)) {
          const from = g.validFactor ?? 1;
          let low = 0, high = 1, best;
          for (let attempt = 0; attempt < 6 && gesture === g && !g.pending; attempt++) {
            const fraction = (low + high) / 2, ratio = from + (factor - from) * fraction;
            const calls = manipulationCalls(g.source, g.members, 'resize', { factor: ratio });
            const candidate = g.members.length > 1 ? { calls } : calls[0];
            try {
              const prepared = await callbacks.prepare(g.context, candidate);
              if (prepared) best = { prepared, candidate, ratio };
              low = fraction;
            } catch { high = fraction; }
          }
          if (gesture === g && !g.pending && best) accept(best.prepared, best.candidate, best.ratio);
        } else { g.error = error; callbacks.feedback?.(error.message); }
      }
    }
    g.running = false;
    if (gesture === g && g.ended) await finish(g);
  }
  async function finish(g) {
    if (g.finishing) return; g.finishing = true;
    try {
      if (g.final) await callbacks.commit(g.context,g.final);
      else callbacks.restore(g.context);
    } finally {
      if (gesture === g) { gesture = null; host.classList.remove('editing-guide'); callbacks.end(g.context); select(null); }
      g.finished?.();
    }
  }
  function cancelGesture() {
    if (press) { const pointer = press.pointerId; press = null; if (host.hasPointerCapture(pointer)) host.releasePointerCapture(pointer); }
    if (!gesture || gesture.finishing) return;
    const g = gesture; gesture = null;
    if (g.pointer !== undefined && host.hasPointerCapture(g.pointer)) host.releasePointerCapture(g.pointer);
    host.classList.remove('editing-guide'); callbacks.restore(g.context); callbacks.end(g.context); select(null);
    g.finished?.();
  }
  const nudge = createGuideNudge({
    begin() {
      const target = targets.find(target => selected.has(target.key) &&
        manipulationTargets(targets, selected, target, 'move').length);
      if (!target) return null;
      const g = start(target, 'move', { clientX: 0, clientY: 0 });
      if (g) { g.keyboard = true; host.focus({ preventScroll: true }); }
      return g;
    },
    update(g, dx, dy) { update(g, dx * g.scale, dy * g.scale); },
    end(g) {
      return new Promise(resolve => {
        g.finished = resolve; g.ended = true;
        if (gesture !== g) resolve();
        else if (!g.running) finish(g);
      });
    },
    cancel: cancelGesture,
    error: error => callbacks.feedback?.(error.message),
  });
  function cancel() { nudge.cancel(); cancelGesture(); }
  host.addEventListener('pointerdown', event => {
    const button = event.target.closest('[data-guide]');
    if (event.button!==0) return;
    if (!button) {
      if (!event.shiftKey && !event.target.closest('.guide-control, .resize-handle, [data-resize]') && callbacks.canStart()) setSelection([]);
      return;
    }
    if (button.dataset.guideOperation === 'delete') { event.stopPropagation(); return; }
    const target=targets.find(t=>t.key===button.dataset.guide); if(!target)return;
    if (!callbacks.available() || !callbacks.canStart()) return;
    if (!button.dataset.guideOperation) {
      // Clicks select without starting a resize transaction, clearing previews,
      // or repainting the chart. Movement beyond the threshold starts a drag.
      press = { target, clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, shiftKey: event.shiftKey };
      event.preventDefault(); event.stopPropagation(); host.setPointerCapture(event.pointerId); return;
    }
    const g=start(target,button.dataset.guideOperation,event,button.dataset.guideEdge); if(!g)return;
    event.preventDefault();event.stopPropagation();host.setPointerCapture(event.pointerId);
  });
  host.addEventListener('pointermove', event => {
    const moveTarget = press && guideDragTarget(targets, selected, press.target);
    if (press && press.pointerId === event.pointerId && (!press.shiftKey || selected.has(press.target.key)) && moveTarget.movable &&
        Math.hypot(event.clientX-press.clientX, event.clientY-press.clientY) >= 4) {
      const pending = press; press = null;
      start(moveTarget, 'move', pending);
    }
    if(gesture&&!gesture.ended&&gesture.pointer===event.pointerId)update(gesture,event.clientX,event.clientY);
  });
  host.addEventListener('pointerup', event => {
    if (press?.pointerId === event.pointerId) {
      const pending = press; press = null; host.releasePointerCapture(event.pointerId);
      if (Math.hypot(event.clientX-pending.clientX, event.clientY-pending.clientY) < 4) {
        pin(pending.target.key, pending.shiftKey); host.focus({ preventScroll: true });
      }
      return;
    }
    const g=gesture;if(!g||g.pointer!==event.pointerId)return;
    update(g,event.clientX,event.clientY);g.ended=true;host.releasePointerCapture(event.pointerId);if(!g.running)finish(g);
  });
  host.addEventListener('pointercancel',cancel);
  host.addEventListener('lostpointercapture',()=>{if(press || gesture&&!gesture.ended)cancel();});
  window.addEventListener('blur',cancel);
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||event.isComposing||document.querySelector('dialog[open]'))return;
    if(gesture||press){event.preventDefault();cancel();}
    else if(selected.size){event.preventDefault();setSelection([]);select(null);}
  });
  host.addEventListener('keydown',event=>{
    const button=event.target.closest('[data-guide-operation="resize"]');
    if(!button||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    const target=targets.find(t=>t.key===button.dataset.guide),rect=button.getBoundingClientRect();
    const g=start(target,'resize',{clientX:rect.x,clientY:rect.y},'se');if(!g)return;
    event.preventDefault();const amount=(event.shiftKey?20:6)*g.scale;
    update(g,g.startX+(['ArrowRight','ArrowDown'].includes(event.key)?amount:-amount),g.startY);g.ended=true;if(!g.running)finish(g);
  });
  host.addEventListener('keydown', event => {
    if (!selected.size || document.querySelector('dialog[open]') ||
        event.target.isContentEditable || event.target.closest('input,textarea,select,[contenteditable],.canvas-text-editor') ||
        event.target.closest('button:not(.guide-hit)')) return;
    if (nudge.down(event)) event.preventDefault();
  });
  document.addEventListener('keyup', event => nudge.up(event.key));
  host.addEventListener('focusout', event => {
    if (gesture?.keyboard && !host.contains(event.relatedTarget)) nudge.flush();
  });
  new ResizeObserver(()=>{if(!gesture&&display&&host.classList.contains('canvas-editor'))mount(display);}).observe(host);
  function clear({ selection = false } = {}) {
    overlay?.remove();overlay=null;targets=[];targetSource=null;active=null;delete host.dataset.guideHover;
    if (selection) setSelection([]);
  }
  function legendScopeTargets(part) {
    const chosen = targets.filter(t => selected.has(t.key));
    const legendKeys = new Set(chosen.flatMap(t => t.members?.map(m => m.key) ?? (t.legendKey ? [t.legendKey] : [])));
    return targets.filter(t => t.legendPart === part && (part === 'all' || legendKeys.has(t.legendKey)));
  }
  function selectLegendScope(part) {
    const matches = legendScopeTargets(part);
    if (!matches.length) return;
    const chosen = targets.filter(t => selected.has(t.key));
    const keys = chosen.filter(t => !t.legendPart).map(t => t.key);
    keys.push(...matches.map(t => t.key));
    setSelection(keys);
  }
  return { mount,clear,cancel, clearSelection: () => setSelection([]), selectLegendScope,
    canSelectLegendScope: part => legendScopeTargets(part).length > 0,
    selection: () => targets.filter(t => selected.has(t.key)) };
}
