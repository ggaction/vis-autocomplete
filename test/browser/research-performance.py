"""Measure real Worker gzip + IndexedDB while a 60Hz UI keeps drawing."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:5184');args=parser.parse_args()
out=Path('output/research-validation');out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True);page=browser.new_page();page.goto(args.url+'/privacy.html')
 cdp=page.context.new_cdp_session(page);results=[]
 for rate in [1,6]:
  cdp.send('Emulation.setCPUThrottlingRate',{'rate':rate})
  result=page.evaluate('''async()=>{
    const {createResearchOutbox}=await import('/web/research/outbox.js');
    const {createCloudLocal}=await import('/web/cloud/local.js');
    const local=createCloudLocal();let writes=0;const put=local.put;local.put=(...args)=>{writes++;return put(...args);};
    const box=createResearchOutbox({local,channel:false,workerFactory:()=>new Worker('/output/workers/research.js',{type:'module'}),send:async()=>({ok:true})});
    const quantile=(a,p)=>[...a].sort((a,b)=>a-b)[Math.floor((a.length-1)*p)];
    const bench=async enabled=>{
      box.configure('benchmark',{research_enabled:enabled,consent_version:'history-only-v1',consent_revision:enabled?1:0});
      const frames=[],enqueue=[];let previous=performance.now();
      for(let frame=0;frame<180;frame++)await new Promise(resolve=>requestAnimationFrame(()=>{
        const now=performance.now();frames.push(now-previous);previous=now;
        for(let i=0;i<4;i++){const start=performance.now();box.emit('preview',{method:'encodeOpacity',key:'opacity',value:(frame%100)/100,status:'requested',rank:2,duration:16});enqueue.push(performance.now()-start);}
        // A small real rendering workload, independent of logging.
        document.body.style.setProperty('--probe',String(frame));resolve();
      }));
      await box.flush();await box.drain();
      return{enqueueP50:quantile(enqueue,.5),enqueueP95:quantile(enqueue,.95),enqueueMax:Math.max(...enqueue),frameP95:quantile(frames,.95),framesOver50:frames.filter(n=>n>50).length};
    };
    await bench(false);const disabled=await bench(false),enabled=await bench(true),metrics=box.metrics();await box.destroy();
    return{disabled,enabled,metrics,writes};
  }''')
  result['cpuThrottle']=rate;results.append(result);print(json.dumps(result),flush=True)
  assert result['enabled']['enqueueP95']<2.5,result
  assert result['metrics']['dropped']==0,result
  assert result['metrics']['compressedBytes']<result['metrics']['rawBytes']*.5,result
 (out/'performance.json').write_text(json.dumps(results,indent=2));browser.close()
