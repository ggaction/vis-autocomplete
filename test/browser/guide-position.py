"""Small guide drags, edge docking and history replay in both display modes."""
from saved_project import read_saved_project
import json, subprocess, os
from pathlib import Path
from itertools import product
from playwright.sync_api import sync_playwright, expect

OUT=Path('output/guide-position'); OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','--input-type=module','-e',r'''
import {writeFileSync} from 'node:fs';import {createProject} from './web/project.js';import {importDataset} from './src/data-import.js';
const rows=Array.from({length:18},(_,i)=>({X:i+1,Y:i*2+5,Group:['A','B','C'][i%3]}));
const c=(method,args)=>({method,args});
for(const kind of ['unit','facet','concat']){
 const setupCalls=[c('createCanvas',{plot:{width:314,height:314},margin:160}),c('createData',{id:'dataset',values:'__LOADED_DATA__'})];
 const calls=[c('createScatterPlot',{id:'plot',data:'dataset',x:'X',y:'Y',color:{field:'Group',fieldType:'nominal'}}),c('createLegend',{target:'plot',channels:['color']}),c('createTitle',{text:'Overview',subtitle:'Three regions'})];
 if(kind==='facet')calls.push(c('facet',{field:'Group',columns:3,guides:{axes:'outer',legend:'shared'}}));
 if(kind==='concat')calls.push(c('createAdjacentPlot',{id:'other',source:'plot',position:'right',plot:{action:'createScatterPlot',options:{data:'dataset',x:'X',y:'Y',color:{field:'Group',fieldType:'nominal'}}},share:{color:true}}));
 const snapshot={setupCalls,calls,guideCall:c('createGuides',kind==='concat'?{target:[{childPath:['plot']},{childPath:['other']}]}:{}),steps:calls.length,phase:'recommendations',selection:{x:'X',y:'Y',color:'Group'},currentNote:'Overview',context:{target:'plot'},plotData:'dataset',optionGroup:'style'};
 const imported=importDataset(JSON.stringify(rows),{format:'json',name:'Moves'});
 writeFileSync(`output/guide-position/${kind}.json`,JSON.stringify(createProject([{id:'moves',name:'Moves',imported,session:{entries:[snapshot],index:0}}],'moves')));
}
'''],check=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
 for mode,kind in product(['preview','transition'],['unit','facet','concat']):
  if os.environ.get('GUIDE_CASE') and os.environ['GUIDE_CASE'] not in {mode,kind,f'{mode}-{kind}'}:continue
  context=browser.new_context(viewport={'width':1800,'height':1200});page=context.new_page();errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
  page.evaluate('''() => { window.guideNotices=[]; const node=document.querySelector('#notice'); new MutationObserver(()=>{if(node.textContent)window.guideNotices.push(node.textContent)}).observe(node,{childList:true,subtree:true,characterData:true}); }''')
  page.locator('#project-file').set_input_files(str(OUT/f'{kind}.json'))
  initial=3 if kind=='unit' else 4
  expect(page.locator('#current')).to_have_attribute('data-steps',str(initial),timeout=60000)
  page.locator(f'#view-mode [data-mode={mode}]').click();page.locator('h1').hover()
  def session():
   doc=read_saved_project(page);return next(d['session'] for d in doc['datasets'] if d['id']==doc['activeId'])
  def drag(key,dx,dy,steps):
   expect(page.locator('#reset')).to_be_enabled(timeout=60000)
   page.locator('h1').hover()
   hit=page.locator(f'.guide-hit[data-guide="{key}"]');r=hit.bounding_box()
   # Grab off-center; pointer location must not make the guide jump.
   for _ in range(2):
    point=hit.evaluate('''el => { const r=el.getBoundingClientRect(); for(const fx of [.35,.65,.5,.2,.8]) for(const fy of [.5,.35,.7]) { const x=r.x+r.width*fx,y=r.y+r.height*fy; if(document.elementFromPoint(x,y)===el)return {x,y}; } return null; }''')
    assert point, f'Guide has no reachable move surface: {key}'
    x=point['x'];y=point['y'];page.mouse.move(x,y)
   page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+dx,y+dy,steps=5)
   try:expect(page.locator('#code-mode')).to_contain_text('Move',timeout=10000)
   except Exception:
    page.screenshot(path=str(OUT/f'failure-{mode}-{kind}.png'))
    print(page.locator('#notice').text_content() if page.locator('#notice').count() else page.locator('body').inner_text()[-2000:],flush=True)
    raise
   page.mouse.up();page.wait_for_function('!document.querySelector("#current").classList.contains("editing-guide")')
   try:expect(page.locator('#current')).to_have_attribute('data-steps',str(steps),timeout=10000)
   except Exception:
    print(mode,kind,key,dx,dy,page.evaluate('window.guideNotices'),flush=True)
    page.screenshot(path=str(OUT/f'failure-{mode}-{kind}.png'))
    raise
   page.locator('h1').hover()
  key='legend:shared-color' if kind=='concat' else 'legend:color'
  for dx,dy in [(-6,4),(4,7),(-3,-2)]:drag(key,dx,dy,initial+1)
  saved=session();assert len(saved['entries'])==2
  calls=saved['entries'][-1]['calls'];edits=[c for c in calls if c['method']=='editLegend']
  assert len(edits)==1 and edits[0]['args']['position']=='right' and edits[0]['args']['alongOffset']!=0,edits
  hit=page.locator(f'.guide-hit[data-guide="{key}"]');r=hit.bounding_box();plot=(page.locator('.plot-boundary').first if page.locator('.plot-boundary').count() else page.locator('#current .canvas-stage')).bounding_box()
  # With the same off-center grab point, drag the group's center beneath the plot.
  drag(key,plot['x']+plot['width']/2-(r['x']+r['width']/2),plot['y']+plot['height']+50-(r['y']+r['height']/2),initial+1)
  drag(key,-8,3,initial+1)
  saved=session();edits=[c for c in saved['entries'][-1]['calls'] if c['method']=='editLegend']
  assert len(saved['entries'])==2 and len(edits)==1 and edits[0]['args']['position']=='bottom',edits
  assert edits[0]['args']['alongOffset']!=0,edits
  page.locator('#undo').click();expect(page.locator('#current')).to_have_attribute('data-steps',str(initial),timeout=60000)
  page.locator('#redo').click();expect(page.locator('#current')).to_have_attribute('data-steps',str(initial+1),timeout=60000)
  title=page.locator('.guide-hit[data-guide$="/title"]').first.get_attribute('data-guide') if kind=='concat' else 'title'
  drag(title,8,4,initial+2)
  axis=page.locator('.guide-hit[data-guide*="axis:"]').first.get_attribute('data-guide')
  drag(axis,7,4,initial+3)
  saved=session();assert len(saved['entries'])==4
  page.reload();expect(page.locator('#current')).to_have_attribute('data-steps',str(initial+3),timeout=60000)
  restored=session()
  if restored!=saved:
   (OUT/"before.json").write_text(json.dumps(saved,indent=2))
   (OUT/"after.json").write_text(json.dumps(restored,indent=2))
  assert restored==saved
  page.screenshot(path=str(OUT/f'{mode}-{kind}.png'))
  assert not errors,errors
  print('PASS',mode,kind,'fine moves, docking, coalesced history, title/axis moves, Undo/Redo, reload',flush=True)
  context.close()
 browser.close()
