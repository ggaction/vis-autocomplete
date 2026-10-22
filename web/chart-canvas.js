import { render } from 'ggaction';
import { chartViewport } from './chart-viewport.js';

const records=new WeakMap();
const heldDensities=new WeakMap();
const queued=new Set();
let frame=0,scratch;
function paint(canvas){
  const record=records.get(canvas);if(!record||!canvas.isConnected)return;
  const {program,geometry,viewport}=record,host=canvas.parentElement;
  // Pointer feedback only transforms the existing layer. Hold raster density
  // across native updates as well: reading/resizing each changing stage forces
  // layout and redraws an unchanged scene between worker results.
  let density=heldDensities.get(canvas);
  if(density===undefined){
    const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;
    density=Math.min(w/viewport.width,h/viewport.height)*(devicePixelRatio||1);
  }
  const ratio=Math.max(.001,Math.min(density,4096/geometry.width,4096/geometry.height,Math.sqrt(16000000/(geometry.width*geometry.height))));
  const key=`${Math.round(geometry.width*ratio)}:${Math.round(geometry.height*ratio)}`;
  if(record.painted===key)return;
  const style=canvas.style.cssText;
  if(record.fit){
    scratch??=document.createElement('canvas');render(program,scratch.getContext('2d'),{pixelRatio:ratio});
    canvas.width=Math.max(1,Math.round(viewport.width*ratio));canvas.height=Math.max(1,Math.round(viewport.height*ratio));
    canvas.getContext('2d').drawImage(scratch,-viewport.x*ratio,-viewport.y*ratio);
  }else render(program,canvas.getContext('2d'),{pixelRatio:ratio});
  record.painted=key;record.ratio=ratio;
  canvas.style.cssText=style;
  canvas.dataset.paint=String((Number(canvas.dataset.paint)||0)+1);
}
function schedule(canvas){
  queued.add(canvas);if(frame)return;
  frame=requestAnimationFrame(()=>{frame=0;for(const item of queued){queued.delete(item);paint(item);}});
}
const observer=new ResizeObserver(entries=>{for(const {target} of entries)if(records.has(target))schedule(target);});
// Galleries are cached/detached. Keep a single observer without retaining old
// cards; reattach observation only for live surfaces, using weak canvas records.
const mutations=new MutationObserver(changes=>{
  for(const change of changes)for(const node of [...change.removedNodes,...change.addedNodes]){
    if(node.nodeType!==1)continue;
    for(const canvas of [node,...node.querySelectorAll('canvas[data-chart]')])if(records.has(canvas)){
      if(canvas.isConnected){observer.observe(canvas);schedule(canvas);}else{observer.unobserve(canvas);queued.delete(canvas);}
    }
  }
});
mutations.observe(document.documentElement,{childList:true,subtree:true});
const refreshDensity=()=>{for(const canvas of document.querySelectorAll('canvas[data-chart]'))schedule(canvas);};
window.addEventListener('resize',refreshDensity);
let resolution;
function densityChanged(){resolution?.removeEventListener('change',densityChanged);resolution=matchMedia(`(resolution: ${devicePixelRatio||1}dppx)`);resolution.addEventListener('change',densityChanged);refreshDensity();}
densityChanged();

export function renderChartCanvas(host,program,label,{fit=false}={}){
  const geometry=program.canvasGeometry??program.graphicSpec.objects.canvas.properties;
  let canvas=host.querySelector(':scope > canvas[data-chart]');
  if(!canvas){canvas=document.createElement('canvas');canvas.dataset.chart='';}
  canvas.style.cssText='display:block;width:100%;height:100%;object-fit:contain;max-width:100%;max-height:100%';
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label',label);
  canvas.dataset.logicalWidth=geometry.width;canvas.dataset.logicalHeight=geometry.height;
  const viewport=fit?chartViewport(program):{x:0,y:0,width:geometry.width,height:geometry.height};
  canvas.dataset.viewBox=[viewport.x,viewport.y,viewport.width,viewport.height].join(' ');
  records.set(canvas,{program,geometry,viewport,fit});
  if(canvas.parentNode!==host)host.replaceChildren(canvas);
  paint(canvas);observer.observe(canvas);schedule(canvas);
  return canvas;
}
export function refreshChartCanvas(canvas){paint(canvas);}
export function holdChartCanvasDensity(canvas,hold=true){
  if(!canvas)return;
  if(hold){const ratio=records.get(canvas)?.ratio;if(ratio!==undefined)heldDensities.set(canvas,ratio);}
  else {heldDensities.delete(canvas);schedule(canvas);}
}
export function copyChartCanvas(source,host){
  const record=records.get(source);
  if(record)return renderChartCanvas(host,record.program,source.getAttribute('aria-label'),{fit:record.fit});
  const copy=document.createElement('canvas');copy.width=source.width;copy.height=source.height;
  copy.getContext('2d').drawImage(source,0,0);copy.style.cssText='width:100%;height:100%;object-fit:contain';
  host.replaceChildren(copy);return copy;
}
