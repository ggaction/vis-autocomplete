import { render } from 'ggaction';
import { chartViewport, invalidateChartViewports } from './chart-viewport.js';
import { createPreviewRasterCache } from './preview-raster-cache.js';

const records=new WeakMap();
const heldDensities=new WeakMap();
const queued=new Set();
const rasterCaches=new WeakMap();
let frame=0,scratch,fontEpoch=0;
function paint(canvas){
  const record=records.get(canvas);if(!record||!canvas.isConnected)return;
  if(record.fontEpoch!==fontEpoch&&record.fit){
    record.viewport=chartViewport(record.program,{cache:record.cacheRaster||Object.isFrozen(record.program.graphicSpec)});
    const view=record.viewport;canvas.dataset.viewBox=[view.x,view.y,view.width,view.height].join(' ');
  }
  record.fontEpoch=fontEpoch;
  const {geometry,viewport}=record,program=record.editingSurface??record.program,host=canvas.parentElement;
  // Pointer feedback only transforms the existing layer. Hold raster density
  // across native updates as well: reading/resizing each changing stage forces
  // layout and redraws an unchanged scene between worker results.
  let density=heldDensities.get(canvas);
  if(density===undefined){
    const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;
    density=Math.min(w/viewport.width,h/viewport.height)*(devicePixelRatio||1)*Number(canvas.closest('[data-chart-zoom]')?.dataset.chartZoom??1);
  }
  const ratio=Math.max(.001,Math.min(density,4096/geometry.width,4096/geometry.height,Math.sqrt(16000000/(geometry.width*geometry.height))));
  const key=JSON.stringify([ratio,geometry.width,geometry.height,viewport.x,viewport.y,viewport.width,viewport.height,record.fit,fontEpoch]);
  if(record.painted===key){
    if(record.static){records.delete(canvas);observer.unobserve(canvas);queued.delete(canvas);}
    return;
  }
  const style=canvas.style.cssText;
  // Only the app's finalized previews opt in. Current editing surfaces and
  // mutable external programs do not enter this immutable endpoint cache.
  const cache=record.cacheRaster&&!record.editingSurface
    ? rasterCaches.get(host)??rasterCaches.set(host,createPreviewRasterCache()).get(host):null;
  const image=cache?.get(program.graphicSpec,key);
  if(image){
    canvas.width=image.width;canvas.height=image.height;
    canvas.getContext('2d').drawImage(image,0,0);
  }else if(record.fit){
    scratch??=document.createElement('canvas');render(program,scratch.getContext('2d'),{pixelRatio:ratio});
    canvas.width=Math.max(1,Math.round(viewport.width*ratio));canvas.height=Math.max(1,Math.round(viewport.height*ratio));
    canvas.getContext('2d').drawImage(scratch,-viewport.x*ratio,-viewport.y*ratio);
  }else render(program,canvas.getContext('2d'),{pixelRatio:ratio});
  if(cache&&!image)cache.remember(program.graphicSpec,key,canvas);
  record.painted=key;record.ratio=ratio;
  canvas.style.cssText=style;
  canvas.dataset.paint=String((Number(canvas.dataset.paint)||0)+1);
  if(record.static){records.delete(canvas);observer.unobserve(canvas);queued.delete(canvas);}
}
function drain(){
  frame=0;const start=performance.now();
  for(const item of queued){
    queued.delete(item);paint(item);
    // ResizeObserver can invalidate Current, previews and the whole history at
    // once. Keep pointer/animation frames moving between complete paints.
    if(performance.now()-start>=6)break;
  }
  if(queued.size)frame=requestAnimationFrame(drain);
}
function schedule(canvas){
  queued.add(canvas);if(!frame)frame=requestAnimationFrame(drain);
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
document.fonts?.addEventListener('loadingdone',()=>{fontEpoch++;invalidateChartViewports();refreshDensity();});

// cacheRaster is an internal opt-in for app-owned immutable worker previews.
// Replace graphicSpec on edits; never opt in with a mutable external graphic.
export function renderChartCanvas(host,program,label,{fit=false,retain=true,cacheRaster=false}={}){
  const geometry=program.canvasGeometry??program.graphicSpec.objects.canvas.properties;
  let canvas=host.querySelector(':scope > canvas[data-chart]');
  if(!canvas){canvas=document.createElement('canvas');canvas.dataset.chart='';}
  canvas.style.cssText='display:block;width:100%;height:100%;object-fit:contain;max-width:100%;max-height:100%';
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label',label);
  canvas.dataset.logicalWidth=geometry.width;canvas.dataset.logicalHeight=geometry.height;
  const immutable=cacheRaster||Object.isFrozen(program.graphicSpec);
  const viewport=fit?chartViewport(program,{cache:immutable}):{x:0,y:0,width:geometry.width,height:geometry.height};
  canvas.dataset.viewBox=[viewport.x,viewport.y,viewport.width,viewport.height].join(' ');
  const previous=records.get(canvas);
  const same=immutable&&previous?.program.graphicSpec===program.graphicSpec&&previous.fit===fit&&
    ['x','y','width','height'].every(key=>previous.viewport[key]===viewport[key]);
  records.set(canvas,{program,geometry,viewport,fit,cacheRaster,fontEpoch,static:!retain,
    ...(same?{painted:previous.painted,ratio:previous.ratio}:{})});
  if(canvas.parentNode!==host)host.replaceChildren(canvas);
  observer.observe(canvas);paint(canvas);if(records.has(canvas))schedule(canvas);
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

// Transient display-only mask: immutable authoring, exports and history retain
// the original glyphs until the accepted public text action is committed.
export function hideChartText(canvas, ids) {
  const record=records.get(canvas);if(!record)return()=>{};
  const selected=new Set(ids);
  function hide(object,id){
    if(selected.has(object.id??id))return {...object,properties:{...object.properties,opacity:0}};
    if(!object.items)return object;
    const items=object.items.map(item=>hide(item,item.id));
    return items.some((item,i)=>item!==object.items[i])?{...object,items}:object;
  }
  const spec=record.program.graphicSpec;
  record.editingSurface={graphicSpec:{...spec,objects:Object.fromEntries(Object.entries(spec.objects).map(([id,object])=>[id,hide(object,id)]))}};
  record.painted=undefined;paint(canvas);
  return ()=>{if(records.get(canvas)===record){delete record.editingSurface;record.painted=undefined;schedule(canvas);}};
}
