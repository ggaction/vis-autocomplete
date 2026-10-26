import { selectableMarks, markSelectionCall } from '../src/mark-picking.js';
import { drawPathGraphic } from '../vendor/ggaction/src/renderers/canvas/path.js';

export function createMarkSelection(toolbar, host, callbacks) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Highlight'; button.hidden = true;
  button.title = 'Select marks or data rows to highlight'; toolbar.prepend(button);
  const panel = document.createElement('section'); panel.className = 'mark-selection-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Highlight selected marks'); host.closest('.panel').append(panel);
  let source, groups = [], group, indices = new Set(), color = '#dc2626', active = false, page = 0, query = '';
  const hitContext = document.createElement('canvas').getContext('2d');
  function end(restore = true) { active = false; panel.hidden = true; host.classList.remove('selecting-marks'); button.setAttribute('aria-pressed','false'); if (restore) callbacks.cancel(); }
  function changed() { draw(); callbacks.preview(indices.size ? markSelectionCall(group, indices, color) : null); }
  function draw() {
    const bounds = host.closest('.panel').getBoundingClientRect();
    panel.style.left = `${Math.max(12, Math.min(bounds.right + 12, window.innerWidth - 432))}px`;
    panel.style.top = `${bounds.top + 48}px`;
    panel.replaceChildren();
    const heading = document.createElement('strong'); heading.textContent = `${indices.size} rows selected`;
    const targets = document.createElement('select'); targets.setAttribute('aria-label','Highlight target');
    for (const g of groups) { const option = document.createElement('option'); option.value = g.key; option.textContent = g.label; option.selected = g.key===group.key; targets.append(option); }
    targets.onchange = () => {group=groups.find(g=>g.key===targets.value);indices.clear();page=0;changed();};
    const paint = document.createElement('input'); paint.type = 'color'; paint.value = color; paint.setAttribute('aria-label','Highlight color'); paint.onchange=()=>{color=paint.value;changed();};
    const apply = document.createElement('button'); apply.textContent='Apply highlight'; apply.disabled=!indices.size;
    apply.onclick=async()=>{const call=markSelectionCall(group,indices,color);end(false);await callbacks.apply(call);};
    const cancel=document.createElement('button');cancel.textContent='Cancel';cancel.onclick=()=>end();
    const help=document.createElement('p');help.textContent='Click a mark; Shift-click to add or remove. Aggregated marks select their contributing rows.';
    const search=document.createElement('input');search.type='search';search.placeholder='Find a row';search.value=query;search.setAttribute('aria-label','Find a row');
    search.onchange=()=>{query=search.value;page=0;draw();};
    const rows=group.selectableRows.filter(r=>r.search.includes(query.toLowerCase()));
    const all=document.createElement('button');all.textContent='Select all matching';all.onclick=()=>{for(const r of rows)indices.add(r.index);changed();};
    const clear=document.createElement('button');clear.textContent='Clear';clear.onclick=()=>{indices.clear();changed();};
    const list=document.createElement('div');list.className='mark-selection-rows';
    for(const {row,index} of rows.slice(page*50,(page+1)*50)){
      const label=document.createElement('label'),box=document.createElement('input'),text=document.createElement('span');box.type='checkbox';box.checked=indices.has(index);box.setAttribute('aria-label',`Select row ${index+1}`);
      box.onchange=()=>{if(box.checked)indices.add(index);else indices.delete(index);changed();};text.textContent=`${index+1}. ${Object.values(row).join(' · ')}`;label.append(box,text);list.append(label);
    }
    const prev=document.createElement('button');prev.textContent='Previous rows';prev.disabled=page===0;prev.onclick=()=>{page--;draw();};
    const next=document.createElement('button');next.textContent='Next rows';next.disabled=(page+1)*50>=rows.length;next.onclick=()=>{page++;draw();};
    panel.append(heading,targets,paint,apply,cancel,help,search,all,clear,list,prev,next);
  }
  function contains(item,x,y,tolerance) {
    const b=item.bounds;if(x<b.left-tolerance||x>b.right+tolerance||y<b.top-tolerance||y>b.bottom+tolerance)return false;
    x-=item.offset.x;y-=item.offset.y;
    return item.geometry.some(g=>{
      const p=g.properties;
      if(g.type==='circle')return Math.hypot(x-p.x,y-p.y)<=p.radius+tolerance;
      if(g.type==='line') { const dx=p.x2-p.x1,dy=p.y2-p.y1,t=Math.max(0,Math.min(1,((x-p.x1)*dx+(y-p.y1)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(x-p.x1-t*dx,y-p.y1-t*dy)<=tolerance+(p.strokeWidth??1)/2; }
      if(g.type==='path'){drawPathGraphic(hitContext,'pick',g);hitContext.lineWidth=Math.max(p.strokeWidth??1,tolerance*2);return p.fill&&p.fill!=='none'&&hitContext.isPointInPath(x,y)||hitContext.isPointInStroke(x,y);}
      return true;
    });
  }
  host.addEventListener('pointerdown',event=>{if(active){event.preventDefault();event.stopImmediatePropagation();}},true);
  host.addEventListener('click',event=>{
    if(!active)return;event.preventDefault();event.stopImmediatePropagation();
    const canvas=host.querySelector('canvas[data-chart]');if(!canvas)return;
    const rect=canvas.getBoundingClientRect(),[vx,vy,vw,vh]=canvas.dataset.viewBox.split(' ').map(Number);
    const x=vx+(event.clientX-rect.left)/rect.width*vw,y=vy+(event.clientY-rect.top)/rect.height*vh;
    const hits=groups.flatMap(g=>g.items.filter(item=>contains(item,x,y,5*vw/rect.width)).map(item=>({g,item})));
    hits.sort((a,b)=>(a.item.bounds.right-a.item.bounds.left)*(a.item.bounds.bottom-a.item.bounds.top)-(b.item.bounds.right-b.item.bounds.left)*(b.item.bounds.bottom-b.item.bounds.top));
    if(!hits.length)return;const hit=hits[0];
    if(!event.shiftKey||group.key!==hit.g.key)indices.clear();group=hit.g;
    const picked=hit.item.rows.filter(r=>r.data===group.data).map(r=>r.index),remove=event.shiftKey&&picked.every(i=>indices.has(i));
    for(const i of picked)if(remove)indices.delete(i);else indices.add(i);changed();
  },true);
  document.addEventListener('keydown',event=>{if(active&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();end();}},true);
  button.onclick=()=>{
    if(active)return end();if(!callbacks.available())return;
    source=callbacks.program();const raw=selectableMarks(source);const merged=new Map();
    for(const g of raw){if(merged.has(g.key))merged.get(g.key).items.push(...g.items);else merged.set(g.key,{...g,items:[...g.items]});}
    groups=[...merged.values()].map(g=>{const allowed=new Set(g.items.flatMap(item=>item.rows.filter(r=>r.data===g.data).map(r=>r.index)));return{...g,selectableRows:g.rows.flatMap((row,index)=>allowed.has(index)?[{row,index,search:JSON.stringify(row).toLowerCase()}]:[])};});if(!groups.length)return callbacks.error('No selectable marks are available.');
    group=groups[0];indices=new Set();page=0;query='';active=true;callbacks.start();host.classList.add('selecting-marks');button.setAttribute('aria-pressed','true');panel.hidden=false;draw();
  };
  return { mount(){button.hidden=!callbacks.available();if(active&&callbacks.program()!==source)end();}, get active(){return active;}, cancel:end };
}
