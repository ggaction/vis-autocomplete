import { pickEditableText } from '../src/text-editing.js';
import { canvasGeometry } from './canvas-geometry.js';

export function createTextEditor(host, callbacks) {
  let active;
  function close() {
    const current=active;if(!current)return;
    active=null;current.cancelled=true;current.panel.remove();
    host.classList.remove('text-editing');callbacks.end(current.context);
  }
  // A plot resize edge may overlap tiny tick text in a fitted view. Let actual
  // text receive double-clicks without starting a resize on the first press.
  host.addEventListener('pointerdown',event=>{
    if(event.button!==0 || !event.target.closest('[data-resize]') || !callbacks.available())return;
    const stage=host.querySelector('.canvas-stage'),program=callbacks.program();if(!stage||!program)return;
    const rect=stage.getBoundingClientRect(),scale=rect.width/canvasGeometry(program).width;
    if(pickEditableText(program,(event.clientX-rect.left)/scale,(event.clientY-rect.top)/scale)) event.stopPropagation();
  },true);
  host.addEventListener('dblclick',event=>{
    if(event.target.closest('.guide-size,.guide-delete,.canvas-resize-handle'))return;
    if(active)close();
    if(!callbacks.available())return;
    const stage=host.querySelector('.canvas-stage'),program=callbacks.program();if(!stage||!program)return;
    const rect=stage.getBoundingClientRect(),scale=rect.width/canvasGeometry(program).width;
    let target;
    try{target=pickEditableText(program,(event.clientX-rect.left)/scale,(event.clientY-rect.top)/scale);}
    catch(error){callbacks.error(error.message);return;}
    if(!target)return;
    event.preventDefault();event.stopPropagation();
    const context=callbacks.start(target),panel=document.createElement('form');panel.className='canvas-text-editor';
    panel.setAttribute('role','dialog');panel.setAttribute('aria-label',`Edit ${target.label.toLowerCase()}`);
    const textarea=document.createElement('textarea');textarea.setAttribute('aria-label','Text');textarea.value=target.text;
    textarea.spellcheck=false;textarea.rows=Math.max(2,Math.min(8,target.text.split('\n').length));
    const hint=document.createElement('small');hint.textContent='Enter to apply · ⌘/Ctrl+Enter for a new line · Esc to cancel';
    const error=document.createElement('div');error.className='text-edit-error';error.setAttribute('role','alert');
    const actions=document.createElement('div');actions.className='text-edit-actions';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.addEventListener('click',close);
    const apply=document.createElement('button');apply.type='submit';apply.textContent='Apply';
    actions.append(cancel,apply);panel.append(textarea,hint,error,actions);document.body.append(panel);
    const width=Math.min(Math.max(300,(target.bounds.right-target.bounds.left)*scale+32),Math.min(600,innerWidth-24));
    panel.style.width=`${width}px`;
    const left=Math.max(12,Math.min(innerWidth-width-12,rect.left+target.bounds.left*scale-8));
    const top=Math.max(12,Math.min(innerHeight-panel.offsetHeight-12,rect.top+target.bounds.top*scale-8));
    panel.style.left=`${left}px`;panel.style.top=`${top}px`;
    active={panel,context,cancelled:false};const session=active;host.classList.add('text-editing');
    let composing=false,compositionEnd=0,saving=false;
    textarea.addEventListener('compositionstart',()=>{composing=true;});
    textarea.addEventListener('compositionend',()=>{composing=false;compositionEnd=performance.now();});
    textarea.addEventListener('keydown',event=>{
      event.stopPropagation();
      if(event.isComposing||composing||event.keyCode===229)return;
      if(event.key==='Escape'){event.preventDefault();close();return;}
      if(event.key!=='Enter')return;
      event.preventDefault();
      if(event.metaKey||event.ctrlKey){textarea.setRangeText('\n',textarea.selectionStart,textarea.selectionEnd,'end');return;}
      if(performance.now()-compositionEnd<40)return;
      panel.requestSubmit();
    });
    panel.addEventListener('submit',async event=>{
      event.preventDefault();if(saving||composing)return;
      if(textarea.value===target.text){close();return;}
      saving=true;apply.disabled=true;textarea.readOnly=true;error.textContent='';
      try{
        await callbacks.apply(context,target.build(textarea.value),()=>!session.cancelled);
        if(active===session)close();
      }catch(failure){if(active===session){error.textContent=failure.message;textarea.focus();}}
      finally{saving=false;apply.disabled=false;textarea.readOnly=false;}
    });
    textarea.focus();textarea.select();
  },true);
  document.addEventListener('pointerdown',event=>{
    if(active&&!active.panel.contains(event.target))close();
  },true);
  window.addEventListener('resize',close);
  return {cancel:close,get active(){return Boolean(active);}};
}
