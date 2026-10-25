"""Dense chart edits: frame gaps, native updates, stable handles and live thumbnails.
Run against npm run dev. PERF_MODE=preview|transition and PERF_DPI=1|2 select
presentation conditions. Timing is recorded, not a hardware-dependent test gate.
"""
import json, os, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUT=Path('output/direct-editing-performance'); OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','--input-type=module','-e',r'''
import {writeFileSync} from 'node:fs';import {createProject} from './web/project.js';import {importDataset} from './src/data-import.js';
const rows=Array.from({length:1200},(_,i)=>({X:i%200+1,Y:i*37%200+1,Group:['A','B','C','D','E','F'][i%6]}));const c=(method,args)=>({method,args});
for(const kind of ['unit','facet','concat']){
 const setupCalls=[c('createCanvas',{plot:{width:314,height:314},margin:{left:80,right:100,top:70,bottom:70}}),c('createData',{id:'dataset',values:'__LOADED_DATA__'})];
 const calls=[c('createScatterPlot',{id:'plot',data:'dataset',x:'X',y:'Y',color:{field:'Group',fieldType:'nominal'}}),c('createLegend',{target:'plot',channels:['color']}),c('createTitle',{text:'Overview',subtitle:'Six regions',titleStyle:{fontFamily:'Arial',fontSize:23}})];
 if(kind==='facet')calls.push(c('facet',{field:'Group',columns:3,guides:{axes:'outer',legend:'shared'}}));
 if(kind==='concat')calls.push(c('createAdjacentPlot',{id:'other',source:'plot',position:'right',plot:{action:'createScatterPlot',options:{data:'dataset',x:'X',y:'Y',color:{field:'Group',fieldType:'nominal'}}},share:{color:true}}));
 const snapshot={setupCalls,calls,guideCall:c('createGuides',kind==='concat'?{target:[{childPath:['plot']},{childPath:['other']}]}:{}),steps:calls.length,phase:'recommendations',selection:{fields:['X','Y','Group']},currentNote:'Overview',context:{target:'plot'},plotData:'dataset',optionGroup:'style'};
 writeFileSync(`output/direct-editing-performance/${kind}.json`,JSON.stringify(createProject([{id:'dense',name:'Dense',imported:importDataset(JSON.stringify(rows),{format:'json',name:'Dense'}),session:{entries:[snapshot],index:0}}],'dense')));
}
'''],check=True)

with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
 results=[];mode=os.environ.get('PERF_MODE','transition');dpi=float(os.environ.get('PERF_DPI','1'))
 for kind in ['unit','facet','concat']:
  page=browser.new_page(viewport={'width':1800,'height':1200},device_scale_factor=dpi);errors=[]
  page.on('pageerror',lambda error:errors.append(str(error)))
  page.add_init_script('''{
    window.editJobs=[];const NativeWorker=Worker;
    window.Worker=class extends NativeWorker {
      constructor(...args){super(...args);this.jobs=new Map();this.addEventListener('message',e=>{const j=this.jobs.get(e.data.id);if(j&&!e.data.progress){this.jobs.delete(e.data.id);editJobs.push({...j,ms:performance.now()-j.start});}});}
      postMessage(message,...args){this.jobs.set(message.id,{type:message.request.type,start:performance.now()});super.postMessage(message,...args);}
    };
  }''')
  page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
  page.locator('#project-file').set_input_files(str(OUT/f'{kind}.json'))
  expect(page.locator('#chart-font')).to_be_enabled(timeout=60000)
  page.locator(f'#view-mode [data-mode={mode}]').click();page.locator('h1').hover();page.wait_for_timeout(1000)
  page.evaluate('''()=>{window.frameGaps=[];window.longTasks=[];window.measure=true;let last=performance.now();
    function frame(t){frameGaps.push(t-last);last=t;if(measure)requestAnimationFrame(frame)}requestAnimationFrame(frame);
    new PerformanceObserver(l=>longTasks.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});editJobs=[];
  }''')
  for size in ['16','17','18']:
   count=page.evaluate('editJobs.filter(j=>j.type==="typography").length')
   page.locator('#chart-font-size').fill(size);page.locator('#chart-font-size').press('Enter')
   page.wait_for_function('(count)=>editJobs.filter(j=>j.type==="typography").length>count',arg=count)
   expect(page.locator('#chart-font')).to_be_enabled(timeout=60000)
   expect(page.locator('#chart-font-size')).to_have_value(size)
  # A rapid burst must preserve all clicks but require only one native batch.
  count=page.evaluate('editJobs.filter(j=>j.type==="typography").length')
  page.get_by_label('Increase selected font sizes',exact=True).click(click_count=4,delay=10)
  expect(page.locator('#chart-font-size')).to_have_value('22',timeout=60000)
  assert page.evaluate('editJobs.filter(j=>j.type==="typography").length')==count+1
  page.locator('h1').hover()
  key='legend:shared-color' if kind=='concat' else 'legend:color'
  handle=page.locator(f'.guide-size[data-guide="{key}"]');r=handle.bounding_box()
  x=r['x']+r['width']/2;y=r['y']+r['height']/2
  page.mouse.move(x-6,y-6);page.mouse.move(x,y)
  page.evaluate('''key=>{window.originalHandle=document.querySelector(`.guide-size[data-guide="${key}"]`);window.dragPaints=0;
    window.paintObserver=new MutationObserver(changes=>dragPaints+=changes.filter(c=>c.attributeName==='data-paint').length);
    paintObserver.observe(document.querySelector('#current'),{subtree:true,attributes:true,attributeFilter:['data-paint']});}''',key)
  page.mouse.down()
  for i in range(1,41):page.mouse.move(x+15*i/40,y+15*i/40);page.wait_for_timeout(16)
  assert page.evaluate('originalHandle.isConnected'),'guide handle was replaced mid-drag'
  assert page.evaluate('dragPaints')>=2,'guide must update while dragging'
  page.mouse.up();page.wait_for_function('!document.querySelector("#current").classList.contains("editing-guide")')
  expect(page.locator('#chart-font')).to_be_enabled(timeout=60000)
  page.evaluate('paintObserver.disconnect()')
  if kind!='concat':
   # Test plot resizing from its original valid typography. The large-text
   # stress case above can legitimately exhaust a facet header's layout lane.
   # Undo both the guide resize and coalesced text-size run first.
   for _ in range(2):
    page.locator('#undo').click();expect(page.locator('#chart-font')).to_be_enabled(timeout=60000)
   initial=3 if kind=='unit' else 4
   expect(page.locator('#current')).to_have_attribute('data-steps',str(initial),timeout=60000)
   page.locator('h1').hover();handle=page.locator('[data-resize="plot-se"]');handle.hover();r=handle.bounding_box();x=r['x']+r['width']/2;y=r['y']+r['height']/2
   page.evaluate('''()=>{window.thumbUpdates=0;window.thumbObserver=new MutationObserver(c=>thumbUpdates+=c.length);thumbObserver.observe(document.querySelector('#cards'),{subtree:true,attributes:true,attributeFilter:['data-paint','style']});}''')
   page.mouse.move(x,y);page.mouse.down()
   for i in range(1,41):page.mouse.move(x+35*i/40,y+20*i/40);page.wait_for_timeout(16)
   assert page.evaluate('thumbUpdates')>0,'option thumbnails must continue updating during resize'
   page.mouse.up();page.wait_for_function('!document.querySelector("#current").classList.contains("resizing")')
   page.evaluate('thumbObserver.disconnect()');expect(page.locator('#chart-font')).to_be_enabled(timeout=60000)
   expect(page.locator('#current')).to_have_attribute('data-steps',str(initial+1),timeout=60000)
  assert not page.locator('#notice').get_attribute('class') or 'error' not in page.locator('#notice').get_attribute('class'),page.locator('#notice').inner_text()
  metrics=page.evaluate('''()=>{measure=false;const a=frameGaps.sort((a,b)=>a-b);return {frameP95:a[Math.floor(a.length*.95)],frameMax:Math.max(...a),framesOver33:a.filter(x=>x>33.5).length,longTasks,guidePaints:dragPaints,typographyMs:editJobs.filter(j=>j.type==='typography').map(j=>j.ms)}}''')
  assert not errors,errors
  result={'mode':mode,'dpi':dpi,'kind':kind,**metrics};results.append(result);print(json.dumps(result),flush=True)
  page.screenshot(path=str(OUT/f'{mode}-{dpi}-{kind}.png'));page.close()
 (OUT/f'{mode}-{dpi}.json').write_text(json.dumps(results,indent=2));browser.close()
