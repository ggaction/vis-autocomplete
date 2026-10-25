import { readViewPreference, writeViewPreference } from './view-preferences.js';
import { CARD_TRANSITION_MS } from './parameter-motion.js';
import { createCanvasTransitionPlayer } from '@ggaction/transition';
import { createTransitionScene, renderTransitionScene } from 'ggaction/scene';
import { createLRU } from '../src/cache.js';

const storageKey = 'vis-autocomplete.view-mode';

export function createTransitionMode({host,layout,toggle,getBaseline,getCandidate,busy,onChange,onError}) {
  let enabled=true,player=null,surface=null,version=0,returning=false;
  try { enabled=readViewPreference(storageKey)!=='preview'; } catch { /* Optional preference. */ }
  function paintMode() {
    document.documentElement.dataset.viewMode=enabled?'transition':'preview';
    layout.classList.toggle('transition-mode',enabled);
    for(const button of toggle.querySelectorAll('[data-mode]')) {
      button.setAttribute('aria-pressed',String(button.dataset.mode===(enabled?'transition':'preview')));
    }
  }
  paintMode();
  const cache=createLRU(16);
  function clear() {
    version++;player?.destroy();player=null;surface?.remove();surface=null;
    host.classList.remove('transition-active');
  }
  function rest() {
    // Keep one settled player and its bounded compiled-scene cache. Re-entering
    // the gallery should not parse and mount the entire committed chart again.
    surface?.remove();host.classList.remove('transition-active');
  }
  function ensure() {
    const current=getBaseline();if(!current)return false;
    if(!player){
      surface=document.createElement('div');surface.className='transition-surface';host.append(surface);
      surface.style.padding = 'var(--control-inset, 12px)';
      player=createCanvasTransitionPlayer(surface,{duration:CARD_TRANSITION_MS,render:(scene, context, options) => renderTransitionScene(scene, context, { pixelRatio: Math.min(
        options.pixelRatio * Number(host.dataset.chartZoom ?? 1), 4096 / scene.width, 4096 / scene.height, Math.sqrt(16000000 / (scene.width * scene.height))) })});
      player.set(createTransitionScene(current,{format:'canvas'}));
    }else if(!surface.isConnected)host.append(surface);
    host.classList.add('transition-active');return true;
  }
  async function show(card,{program,duration=CARD_TRANSITION_MS}={}) {
    const request=++version;if(!enabled)return;
    if(!card&&!program&&!surface?.isConnected)return;
    if(!ensure())return;
    returning=!card&&!program;
    try{
      let scene;
      if(program)scene=createTransitionScene(program,{format:'canvas'});
      else if(card?.prepared){
        const artifact=card.prepared;
        const pending=cache.get(artifact)??cache.set(artifact,getCandidate(card));
        scene=await pending;
        if(!scene)cache.delete(artifact);
      }else if(card)return; // Keep the current picture while a preview prepares.
      else scene=createTransitionScene(getBaseline(),{format:'canvas'});
      if(request!==version||!enabled||!scene)return;
      player.element.setAttribute('aria-label',card?.title??'Visualization');
      surface.dataset.method=card?.prepared?.recommendation?.method??'';
      surface.dataset.duration = String(duration);
      await player.transitionTo(scene, { duration });
      if(request!==version||!enabled)return;
      if(returning)rest();
    }catch(error){if(request===version){if(card?.prepared)cache.delete(card.prepared);clear();onError(error);}}
  }
  toggle.addEventListener('click',event=>{
    const button=event.target.closest('[data-mode]');if(!button||busy())return;
    if(!['preview','transition'].includes(button.dataset.mode))return;
    clear();enabled=button.dataset.mode==='transition';paintMode();
    try { writeViewPreference(storageKey,enabled?'transition':'preview'); } catch { /* Optional preference. */ }
    onChange();
  });
  return {get enabled(){return enabled;},get active(){return Boolean(surface?.isConnected);},show,clear,
    // Current's native renderer may replace its subtree on Apply/Undo/resize.
    reset(){clear();},get stats(){return player?.stats??null;}};
}
