"""Consecutive guide moves replace history, authoring code and native traces."""
import json, subprocess
from pathlib import Path
from itertools import product
from playwright.sync_api import sync_playwright, expect
OUT=Path('output/guide-move-history');OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','--input-type=module','-e',r'''
import {writeFileSync} from 'node:fs';import {createProject} from './web/project.js';import {importDataset} from './src/data-import.js';
const rows=Array.from({length:18},(_,i)=>({X:i+1,Y:i*2+5,Group:['A','B','C'][i%3]}));
const c=(method,args)=>({method,args});
for(const facet of [false,true]){
 const setupCalls=[c('createCanvas',{plot:{width:314,height:314},margin:160}),c('createData',{id:'dataset',values:'__LOADED_DATA__'})];
 const calls=[c('createScatterPlot',{id:'plot',data:'dataset',x:'X',y:'Y',color:{field:'Group',fieldType:'nominal'}}),c('createTitle',{text:'Overview',subtitle:'Three regions'})];
 if(facet)calls.push(c('facet',{field:'Group',columns:3,guides:{axes:'outer',legend:'shared'}}));
 const snapshot={setupCalls,calls,guideCall:c('createGuides',{legend:{target:'plot',channels:['color']}}),steps:calls.length,phase:'recommendations',selection:{x:'X',y:'Y',color:'Group'},currentNote:'Overview',context:{target:'plot'},plotData:'dataset',optionGroup:'style'};
 const imported=importDataset(JSON.stringify(rows),{format:'json',name:'Moves'});
 writeFileSync(`output/guide-move-history/${facet}.json`,JSON.stringify(createProject([{id:'moves',name:'Moves',imported,session:{entries:[snapshot],index:0}}],'moves')));
}
'''],check=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
 for mode,facet in product(['preview','transition'],[False,True]):
  context=browser.new_context(viewport={'width':1800,'height':1200});page=context.new_page();errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
  page.locator('#project-file').set_input_files(str(OUT/f'{str(facet).lower()}.json'))
  initial=3 if facet else 2
  expect(page.locator('#current')).to_have_attribute('data-steps',str(initial),timeout=60000)
  page.locator(f'#view-mode [data-mode={mode}]').click();page.locator('h1').hover()
  def session():
   page.locator('.project-menu summary').click()
   with page.expect_download() as download:page.locator('#save-project').click()
   page.locator('.project-menu summary').click()
   doc=json.loads(Path(download.value.path()).read_text());return next(d['session'] for d in doc['datasets'] if d['id']==doc['activeId'])
  def move(key,edge,steps,cancel=False):
   expect(page.locator('#reset')).to_be_enabled(timeout=60000)
   page.locator('h1').hover()
   hit=page.locator(f'.guide-hit[data-guide="{key}"]');hit.hover();r=hit.bounding_box()
   plot=page.locator('.plot-boundary').bounding_box()
   x=plot['x']+plot['width']/2;y=plot['y']+plot['height']/2
   if edge=='bottom':y=plot['y']+plot['height']+35
   if edge=='top':y=plot['y']-35
   if edge=='left':x=plot['x']-35
   if edge=='right':x=plot['x']+plot['width']+35
   page.mouse.move(r['x']+r['width']/2,r['y']+r['height']/2);page.mouse.down();page.mouse.move(x,y,steps=8)
   expect(page.locator('#code-mode')).to_contain_text('Move',timeout=60000)
   # Live proposed code must also replace the previous move, not append it.
   if cancel:page.keyboard.press('Escape')
   page.mouse.up()
   page.wait_for_function('!document.querySelector("#current").classList.contains("editing-guide")')
   expect(page.locator('#current')).to_have_attribute('data-steps',str(steps),timeout=60000)
   page.locator('h1').hover()
  base=session()['entries'][0]['calls']
  for edge in ['bottom','left','top','right']:
   move('legend:color',edge,initial+1)
   saved=session();assert len(saved['entries'])==2
   calls=saved['entries'][-1]['calls'];assert calls[:len(base)]==base
   edits=[c for c in calls[len(base):] if c['method']=='editLegend']
   assert len(edits)==1 and edits[0]['args']['position']==edge,edits
   assert len(calls)-len(base)<=4,calls
  before=session()
  move('legend:color','bottom',initial+1,cancel=True)
  assert session()==before
  page.locator('#undo').click();expect(page.locator('#current')).to_have_attribute('data-steps',str(initial),timeout=60000)
  page.locator('#redo').click();expect(page.locator('#current')).to_have_attribute('data-steps',str(initial+1),timeout=60000)
  # Navigation starts a new run. Title and subtitle move the same title resource.
  move('title','bottom',initial+2)
  move('subtitle','right',initial+2)
  saved=session();assert len(saved['entries'])==3
  assert len([c for c in saved['entries'][-1]['calls'] if c['method']=='editTitle'])==1
  move('legend:color','bottom',initial+3)
  assert len(session()['entries'])==4
  page.locator('#undo').click();expect(page.locator('#current')).to_have_attribute('data-steps',str(initial+2),timeout=60000)
  move('legend:color','left',initial+3)
  expect(page.locator('#redo')).to_be_disabled()
  saved=session();assert len(saved['entries'])==4
  page.reload();expect(page.locator('#current')).to_have_attribute('data-steps',str(initial+3),timeout=60000)
  assert session()==saved
  page.screenshot(path=str(OUT/f'{mode}-{facet}.png'))
  assert not errors,errors
  print('PASS',mode,facet,'coalesced moves, bounded code, cancel, resource boundaries, Undo/Redo, branch and reload',flush=True)
  context.close()
 browser.close()
