import { pickEditableText, editableTextBlock, textAlignmentCall } from '../src/text-editing.js';
import { canvasGeometry } from './canvas-geometry.js';
import { hideChartText } from './chart-canvas.js';

export function createTextEditor(host, callbacks) {
  let active;
  const measure=document.createElement('canvas').getContext('2d');
  function close() {
    const current=active;if(!current)return;
    active=null;current.cancelled=true;current.observer.disconnect();current.restore();current.panel.remove();
    host.classList.remove('text-editing');callbacks.end(current.context);
  }
  function pick(event) {
    const stage=host.querySelector('.canvas-stage'),program=callbacks.program();if(!stage||!program)return;
    const rect=stage.getBoundingClientRect(),scale=rect.width/canvasGeometry(program).width;
    const target=pickEditableText(program,(event.clientX-rect.left)/scale,(event.clientY-rect.top)/scale);
    if(target)return {stage,program,target:editableTextBlock(program,target)};
  }
  // Small fitted labels can overlap resize edges. A double-click edits text.
  host.addEventListener('pointerdown',event=>{
    if(event.button===0&&event.target.closest('[data-resize]')&&callbacks.available()&&pick(event))event.stopPropagation();
  },true);
  host.addEventListener('dblclick',event=>{
    if(active?.panel.contains(event.target)||event.target.closest('.guide-size,.guide-delete,.canvas-resize-handle'))return;
    if(active)close();
    if(!callbacks.available())return;
    let hit;try{hit=pick(event);}catch(error){callbacks.error(error.message);return;}
    if(!hit)return;
    event.preventDefault();event.stopPropagation();
    const {stage,program,target}=hit,p=target.properties;
    const context=callbacks.start(target),panel=document.createElement('form');panel.className='canvas-text-editor';
    panel.setAttribute('aria-label',`Edit ${target.label.toLowerCase()}`);
    const textarea=document.createElement('textarea');textarea.setAttribute('aria-label','Text');textarea.value=target.text;
    textarea.spellcheck=false;textarea.rows=1;
    const hint=document.createElement('small');hint.textContent='Enter to apply · Shift/⌘/Ctrl+Enter for a new line · Esc to cancel';
    const error=document.createElement('div');error.className='text-edit-error';error.setAttribute('role','alert');
    panel.append(textarea,hint,error);stage.append(panel);
    const nativeLines=p.lines??[{text:p.text,x:0,y:0}];
    const wraps=nativeLines.length>target.text.split(/\r\n|\r|\n/).length;
    textarea.wrap=wraps?'soft':'off';
    let pendingAlign,composing=false,compositionEnd=0,saving=false;
    function layout() {
      const scale=stage.clientWidth/canvasGeometry(program).width,fontSize=p.fontSize??12;
      const lineHeight=target.lineHeight??(nativeLines.length>1?Math.abs(nativeLines[1].y-nativeLines[0].y)||fontSize*1.2:fontSize*1.2);
      measure.font=`${p.fontStyle??'normal'} ${p.fontWeight??'normal'} ${fontSize}px ${p.fontFamily??'sans-serif'}`;
      const metrics=measure.measureText('Mg');
      const ascent=metrics.fontBoundingBoxAscent??fontSize*.8,descent=metrics.fontBoundingBoxDescent??fontSize*.2;
      const baseline=(lineHeight-ascent-descent)/2+ascent;
      // Canvas baseline -> CSS line-box baseline, in logical chart pixels.
      const canvasBaseline=p.textBaseline??'alphabetic';
      const baseShift=canvasBaseline==='middle'?(ascent-descent)/2:['top','hanging'].includes(canvasBaseline)?ascent:['bottom','ideographic'].includes(canvasBaseline)?-descent:0;
      const initialWidth=Math.max(...nativeLines.map(line=>measure.measureText(line.text).width));
      const width=Math.max(fontSize,initialWidth,...(wraps?[]:textarea.value.split('\n').map(line=>measure.measureText(line).width)))+2;
      const align=pendingAlign??p.textAlign??'left',fraction=['right','end'].includes(align)?1:align==='center'?.5:0;
      Object.assign(panel.style,{left:`${(target.offset.x+p.x)*scale}px`,top:`${(target.offset.y+p.y)*scale}px`,transform:`rotate(${p.rotation??0}rad)`,width:`${width*scale}px`});
      Object.assign(textarea.style,{fontFamily:p.fontFamily??'sans-serif',fontSize:`${fontSize*scale}px`,fontWeight:p.fontWeight??'normal',fontStyle:p.fontStyle??'normal',color:typeof p.fill==='string'?p.fill:'#111827',lineHeight:`${lineHeight*scale}px`,textAlign:align,
        left:`${(nativeLines[0].x-width*fraction)*scale}px`,top:`${(nativeLines[0].y+baseShift-baseline)*scale}px`,width:`${width*scale}px`,height:`${lineHeight*scale}px`});
      textarea.style.height=`${Math.max(lineHeight*scale,textarea.scrollHeight)}px`;
    }
    const observer=new ResizeObserver(layout);observer.observe(stage);
    active={panel,context,cancelled:false,observer,restore:hideChartText(stage.querySelector('canvas[data-chart]'),target.ids),
      target,setAlign(value){pendingAlign=value;layout();textarea.focus();callbacks.changed?.();},get align(){return pendingAlign??p.textAlign??'left';}};
    const session=active;host.classList.add('text-editing');layout();callbacks.changed?.();
    textarea.addEventListener('input',layout);
    textarea.addEventListener('compositionstart',()=>{composing=true;});
    textarea.addEventListener('compositionend',()=>{composing=false;compositionEnd=performance.now();layout();});
    textarea.addEventListener('keydown',event=>{
      event.stopPropagation();
      if(event.isComposing||composing||event.keyCode===229)return;
      if(event.key==='Escape'){event.preventDefault();close();return;}
      if(event.key!=='Enter')return;
      event.preventDefault();
      if(event.shiftKey||event.metaKey||event.ctrlKey){textarea.setRangeText('\n',textarea.selectionStart,textarea.selectionEnd,'end');layout();return;}
      if(performance.now()-compositionEnd<40)return;
      panel.requestSubmit();
    });
    panel.addEventListener('pointerdown',event=>event.stopPropagation());
    session.submit=()=>panel.requestSubmit();
    panel.addEventListener('submit',async event=>{
      event.preventDefault();if(saving||composing)return;
      const calls=[];
      if(textarea.value!==target.text)calls.push(target.build(textarea.value));
      if(pendingAlign!==undefined&&pendingAlign!==p.textAlign)calls.push(textAlignmentCall(target,pendingAlign));
      if(!calls.length){close();return;}
      saving=true;textarea.readOnly=true;error.textContent='';
      try{await callbacks.apply(context,calls,()=>!session.cancelled);if(active===session)close();}
      catch(failure){if(active===session){error.textContent=failure.message;textarea.focus();}}
      finally{saving=false;textarea.readOnly=false;}
    });
    textarea.focus();textarea.select();
  },true);
  document.addEventListener('pointerdown',event=>{
    if(active&&!active.panel.contains(event.target)&&!event.target.closest('[data-text-align]'))active.submit();
  },true);
  document.addEventListener('keydown',event=>{if(active&&event.key==='Escape'&&!event.isComposing){event.preventDefault();close();}});
  return {cancel:close,get active(){return Boolean(active);},get selection(){return active?{label:active.target.label,align:active.align}:null;},align(value){active?.setAlign(value);}};
}
