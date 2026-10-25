import { editableGuides, guideBounds, resizeGuide, moveGuide, removeGuide, guideMoveHistoryKey } from '../src/guide-manipulation.js';
import { removableChartPanels } from '../src/chart-removal.js';
import { canvasGeometry } from './canvas-geometry.js';

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
  let display, targets = [], active, overlay, gesture, stage;
  function select(key) {
    active = targets.find(target => target.key === key);
    if (active) host.dataset.guideHover = active.key; else delete host.dataset.guideHover;
    for (const node of overlay?.querySelectorAll('.guide-control') ?? []) node.classList.toggle('active', node.dataset.guideKey === active?.key);
  }
  function mount(program) {
    display = program; stage = host.querySelector('.canvas-stage');
    if (!stage || !callbacks.available()) { clear(); return; }
    const source = gesture?.source ?? callbacks.program();
    targets = [...removableChartPanels(source), ...editableGuides(source)];
    const old = active?.key;
    overlay = stage.querySelector('.guide-editor');
    if (!overlay) { overlay = document.createElement('div'); overlay.className = 'guide-editor'; stage.append(overlay); }
    const scale = stage.clientWidth / canvasGeometry(program).width;
    overlay.replaceChildren();
    for (const target of targets) {
      const bounds = guideBounds(program, target.ids); if (!bounds) continue;
      const isTitleGroup = target.kind === 'title' && !target.part;
      const pad = isTitleGroup ? 10 : 3;
      const node = document.createElement('div'); node.className = 'guide-control'; node.dataset.guideKey = target.key;
      node.classList.toggle('compact-guide', (bounds.right-bounds.left)*scale < 24 || (bounds.bottom-bounds.top)*scale < 16);
      node.style.zIndex = target.kind === 'panel' ? '0' : isTitleGroup ? '1' : target.kind === 'legend' && target.part ? '3' : '2';
      node.classList.toggle('panel-control', target.kind === 'panel');
      Object.assign(node.style, { left: `${bounds.left*scale-pad}px`, top: `${bounds.top*scale-pad}px`,
        width: `${(bounds.right-bounds.left)*scale+pad*2}px`, height: `${(bounds.bottom-bounds.top)*scale+pad*2}px` });
      const hit = document.createElement('button'); hit.type = 'button'; hit.className = 'guide-hit';
      hit.dataset.guide = target.key; hit.setAttribute('aria-label', target.movable ? `Move ${target.label}` : `Select ${target.label}`);
      hit.style.cursor = target.movable ? 'move' : 'default';
      const size = document.createElement('button'); size.type = 'button'; size.className = 'guide-size';
      size.dataset.guide = target.key; size.dataset.guideOperation = 'resize';
      size.dataset.guideEdge = 'se';
      size.setAttribute('aria-label', `Resize ${target.label}`); size.title = 'Drag to resize · arrow keys · Esc to cancel';
      if (target.kind !== 'panel') node.append(hit);
      if (target.kind !== 'panel' && target.resizable !== false) node.append(size);
      {
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
        together.addEventListener('click', event => { event.stopPropagation(); select(titleGroup.key);
          [...overlay.querySelectorAll('[data-guide-operation="resize"]')].find(button=>button.dataset.guide===titleGroup.key)?.focus({preventScroll:true}); });
        node.append(together);
      }
      overlay.append(node);
    }
    select(gesture?.target.key ?? old);
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
    const g = { target, operation, edge, source, rect, scale: rect.width/canvasGeometry(display).width,
      startX: event.clientX, startY: event.clientY, pointer: event.pointerId,
      pending: null, running: false, ended: false, final: null, key: null };
    gesture = g; g.context = callbacks.start(target, operation); host.classList.add('editing-guide');
    select(target.key); return g;
  }
  function update(g, x, y) {
    if (gesture !== g || g.ended) return;
    const dx = (x-g.startX)/g.scale, dy = (y-g.startY)/g.scale;
    if (Math.abs(dx)+Math.abs(dy)<2 && !g.final) return;
    const factor = guideResizeFactor(g.target.bounds, dx, dy, g.edge);
    const action = g.operation === 'resize' ? resizeGuide(g.target, factor)
      : moveGuide(g.source,g.target,(g.target.bounds.left+g.target.bounds.right)/2+dx,
        (g.target.bounds.top+g.target.bounds.bottom)/2+dy, { dx, dy, snapDistance: 48/g.scale });
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
            const candidate = resizeGuide(g.target, ratio);
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
    }
  }
  function cancel() {
    if (!gesture || gesture.finishing) return;
    const g = gesture; gesture = null;
    if (g.pointer !== undefined && host.hasPointerCapture(g.pointer)) host.releasePointerCapture(g.pointer);
    host.classList.remove('editing-guide'); callbacks.restore(g.context); callbacks.end(g.context); select(null);
  }
  host.addEventListener('pointerdown', event => {
    const button = event.target.closest('[data-guide]');
    if (!button || event.button!==0) return;
    if (button.dataset.guideOperation === 'delete') { event.stopPropagation(); return; }
    const target=targets.find(t=>t.key===button.dataset.guide); if(!target)return;
    const g=start(target,button.dataset.guideOperation??'move',event,button.dataset.guideEdge); if(!g)return;
    event.preventDefault();event.stopPropagation();host.setPointerCapture(event.pointerId);
  });
  host.addEventListener('pointermove', event => { if(gesture&&!gesture.ended&&gesture.pointer===event.pointerId)update(gesture,event.clientX,event.clientY); });
  host.addEventListener('pointerup', event => {
    const g=gesture;if(!g||g.pointer!==event.pointerId)return;
    update(g,event.clientX,event.clientY);g.ended=true;host.releasePointerCapture(event.pointerId);if(!g.running)finish(g);
  });
  host.addEventListener('pointercancel',cancel);
  host.addEventListener('lostpointercapture',()=>{if(gesture&&!gesture.ended)cancel();});
  window.addEventListener('blur',cancel);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&gesture){event.preventDefault();cancel();}});
  host.addEventListener('keydown',event=>{
    const button=event.target.closest('[data-guide-operation="resize"]');
    if(!button||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    const target=targets.find(t=>t.key===button.dataset.guide),rect=button.getBoundingClientRect();
    const g=start(target,'resize',{clientX:rect.x,clientY:rect.y},'se');if(!g)return;
    event.preventDefault();const amount=(event.shiftKey?20:6)*g.scale;
    update(g,g.startX+(['ArrowRight','ArrowDown'].includes(event.key)?amount:-amount),g.startY);g.ended=true;if(!g.running)finish(g);
  });
  new ResizeObserver(()=>{if(!gesture&&display&&host.classList.contains('canvas-editor'))mount(display);}).observe(host);
  function clear(){ overlay?.remove();overlay=null;targets=[];active=null;delete host.dataset.guideHover; }
  return { mount,clear,cancel };
}
