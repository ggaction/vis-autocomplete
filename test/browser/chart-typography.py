"""Real typography controls, selected text highlights, history and reload."""
import json, os, subprocess
from pathlib import Path
from itertools import product
from playwright.sync_api import sync_playwright, expect

OUT=Path('output/chart-typography');OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','--input-type=module','-e',r'''
import {writeFileSync} from 'node:fs';import {createProject} from './web/project.js';import {importDataset} from './src/data-import.js';
const rows=Array.from({length:18},(_,i)=>({X:i+1,Y:i*2+5,Group:['A','B','C'][i%3]}));const c=(method,args)=>({method,args});
for(const kind of ['unit','facet','concat']){
 const setupCalls=[c('createCanvas',{plot:{width:314,height:314},margin:{left:80,right:100,top:70,bottom:70}}),c('createData',{id:'dataset',values:'__LOADED_DATA__'})];
 const calls=[c('createScatterPlot',{id:'plot',data:'dataset',x:'X',y:'Y',color:{field:'Group',fieldType:'nominal'}}),c('createLegend',{target:'plot',channels:['color']}),c('createTitle',{text:'Overview',subtitle:'Three regions',titleStyle:{fontFamily:'Arial',fontSize:23}})];
 if(kind==='facet')calls.push(c('facet',{field:'Group',columns:3,guides:{axes:'outer',legend:'shared'}}));
 if(kind==='concat')calls.push(c('createAdjacentPlot',{id:'other',source:'plot',position:'right',plot:{action:'createScatterPlot',options:{data:'dataset',x:'X',y:'Y',color:{field:'Group',fieldType:'nominal'}}},share:{color:true}}));
 const snapshot={setupCalls,calls,guideCall:c('createGuides',kind==='concat'?{target:[{childPath:['plot']},{childPath:['other']}]}:{}),steps:calls.length,phase:'recommendations',selection:{fields:['X','Y','Group']},currentNote:'Overview',context:{target:'plot'},plotData:'dataset',optionGroup:'style'};
 const imported=importDataset(JSON.stringify(rows),{format:'json',name:'Typography'});
 writeFileSync(`output/chart-typography/${kind}.json`,JSON.stringify(createProject([{id:'text',name:'Typography',imported,session:{entries:[snapshot],index:0}}],'text')));
}
'''],check=True)

with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
 for mode,kind in product(['preview','transition'],['unit','facet','concat']):
  if os.environ.get('TEXT_CASE') and os.environ['TEXT_CASE'] not in {mode,kind,f'{mode}-{kind}'}:continue
  context=browser.new_context(viewport={'width':1800,'height':1200});page=context.new_page();errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
  expect(page.locator('#chart-typography')).to_be_hidden()
  page.locator('#project-file').set_input_files(str(OUT/f'{kind}.json'))
  initial=3 if kind=='unit' else 4
  expect(page.locator('#current')).to_have_attribute('data-steps',str(initial),timeout=60000)
  page.locator(f'#view-mode [data-mode={mode}]').click()
  def ready():expect(page.locator('#chart-font')).to_be_enabled(timeout=60000)
  def groups():
   if page.locator('.text-group-menu').get_attribute('open') is None:page.get_by_label('Choose text groups',exact=True).click()
  def session():
   ready();page.locator('.project-menu summary').click()
   with page.expect_download() as download:page.locator('#save-project').click()
   page.locator('.project-menu summary').click()
   doc=json.loads(Path(download.value.path()).read_text());return next(d['session'] for d in doc['datasets'] if d['id']==doc['activeId'])
  try:
   ready();page.locator('#chart-font').select_option('Georgia')
   expect(page.locator('#current')).to_have_attribute('data-steps',str(initial+1),timeout=60000);ready()
   expect(page.locator('#chart-font')).to_have_value('Georgia')
   groups();page.get_by_label('All text',exact=True).uncheck()
   page.get_by_label('Legend labels',exact=True).check();page.get_by_label('Axis tick labels',exact=True).check()
   page.locator('#chart-font-size').focus()
   assert page.locator('.text-underlines span').count()>3
   roles=page.locator('.text-underlines span').evaluate_all('(nodes)=>[...new Set(nodes.map(n=>n.dataset.textGroup))]')
   assert set(roles)=={'legendLabels','ticks'},roles
   if kind=='facet':
    page.get_by_label('Facet headers',exact=True).hover()
    assert page.locator('.text-underlines [data-text-group=facetHeaders]').count()==3
   page.locator('#chart-font-size').fill('17');page.locator('#chart-font-size').press('Enter')
   expect(page.locator('#current')).to_have_attribute('data-steps',str(initial+2),timeout=60000);ready()
   expect(page.locator('#chart-font-size')).to_have_value('17')
   for value in ['18','19']:
    page.get_by_label('Increase selected font sizes',exact=True).click()
    expect(page.locator('#chart-font-size')).to_have_value(value,timeout=60000);ready()
   saved=session();assert len(saved['entries'])==3
   page.locator('#undo').click();expect(page.locator('#current')).to_have_attribute('data-steps',str(initial+1),timeout=60000)
   expect(page.locator('#chart-font')).to_have_value('Georgia');expect(page.locator('#chart-font-size')).to_have_value('12')
   page.locator('#redo').click();expect(page.locator('#chart-font-size')).to_have_value('19',timeout=60000)
   page.reload();expect(page.locator('#current')).to_have_attribute('data-steps',str(initial+2),timeout=60000)
   expect(page.locator('#chart-font')).to_have_value('Georgia');assert session()==saved
   groups();page.get_by_label('All text',exact=True).check();page.locator('#chart-font-size').focus()
   expect(page.locator('#chart-font-size')).to_have_attribute('placeholder','Mixed')
   page.screenshot(path=str(OUT/f'{mode}-{kind}.png'))
   assert not errors,errors
   print('PASS',mode,kind,'font, multi-group highlights, exact sizes, steps, history, Undo/Redo, reload',flush=True)
  except Exception:
   page.screenshot(path=str(OUT/f'failure-{mode}-{kind}.png'));print('NOTICE',page.locator('#notice').inner_text(),errors,flush=True);raise
  context.close()
 browser.close()
