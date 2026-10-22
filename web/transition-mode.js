import { createCanvasTransitionPlayer } from '@ggaction/transition';
import { createTransitionScene, renderTransitionScene } from 'ggaction/scene';
import { createLRU } from '../src/cache.js';

export function createTransitionMode({host,layout,toggle,getBaseline,getCandidate,busy,onChange,onError}) {
  let enabled=false,player=null,surface=null,version=0,returning=false;
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
      player=createCanvasTransitionPlayer(surface,{duration:300,render:renderTransitionScene});
      player.set(createTransitionScene(current,{format:'canvas'}));
    }else if(!surface.isConnected)host.append(surface);
    host.classList.add('transition-active');return true;
  }
  async function show(card,{program}={}) {
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
      await player.transitionTo(scene);
      if(request!==version||!enabled)return;
      if(returning)rest();
    }catch(error){if(request===version){if(card?.prepared)cache.delete(card.prepared);clear();onError(error);}}
  }
  toggle.addEventListener('click',event=>{
    const button=event.target.closest('[data-mode]');if(!button||busy())return;
    clear();enabled=button.dataset.mode==='transition';layout.classList.toggle('transition-mode',enabled);
    for(const b of toggle.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b===button));
    onChange();
  });
  return {get enabled(){return enabled;},get active(){return Boolean(surface?.isConnected);},show,clear,
    // Current's native renderer may replace its subtree on Apply/Undo/resize.
    reset(){clear();},get stats(){return player?.stats??null;}};
}
