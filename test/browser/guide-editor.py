"""Direct title, subtitle, legend and axis-title manipulation in both modes."""
import json, subprocess
from itertools import product
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
OUT=Path('output/guide-editor');OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','--input-type=module','-e',r'''
import {writeFileSync} from 'node:fs';import {createProject} from './web/project.js';import {importDataset} from './src/data-import.js';
const rows=Array.from({length:18},(_,i)=>({X:i+1,Y:i*2+5,Group:['A','B','C'][i%3]}));
const c=(method,args)=>({method,args});const setupCalls=[c('createCanvas',{plot:{width:314,height:314},margin:160}),c('createData',{id:'dataset',values:'__LOADED_DATA__'})];
const calls=[c('createScatterPlot',{id:'plot',data:'dataset',x:{field:'X',fieldType:'quantitative'},y:{field:'Y',fieldType:'quantitative'},color:{field:'Group',fieldType:'nominal'}}),c('createTitle',{text:'Sales overview',subtitle:'Three regions',titleStyle:{fontSize:23},subtitleStyle:{fontSize:15}})];
const snapshot={setupCalls,calls,guideCall:c('createGuides',{legend:{target:'plot',channels:['color']}}),steps:2,phase:'recommendations',selection:{x:'X',y:'Y',color:'Group'},currentNote:'Add title',context:{target:'plot'},plotData:'dataset',optionGroup:'style'};
const imported=importDataset(JSON.stringify(rows),{format:'json',name:'Guide example'});
writeFileSync('output/guide-editor/project.json',JSON.stringify(createProject([{id:'guides',name:'Guide example',imported,session:{entries:[snapshot],index:0}}],'guides')));
'''],check=True)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
 for mode,faceted in product(['preview','transition'],[False,True]):
  page=b.new_page(viewport={'width':1800,'height':1200});errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
  fixture=json.loads((OUT/'project.json').read_text())
  if faceted:
   # The project schema stores snapshots inside each dataset session.
   for dataset in fixture['datasets']:
    for snapshot in dataset['session']['entries']:
     snapshot['calls'].append({'method':'facet','args':{'field':'Group','columns':3,'guides':{'axes':'outer','legend':'shared'}}})
     snapshot['steps']=3
  target=OUT/f'project-{faceted}.json';target.write_text(json.dumps(fixture))
  page.locator('#project-file').set_input_files(str(target))
  step=3 if faceted else 2
  expect(page.locator('#current')).to_have_attribute('data-steps',str(step),timeout=60000)
  page.locator(f'#view-mode [data-mode={mode}]').click();page.locator('h1').hover()
  axis_keys=page.locator('.guide-hit[data-guide^="axis:"]').evaluate_all('(nodes)=>nodes.map(n=>n.dataset.guide)')
  axis_keys=[next(key for key in axis_keys if key.endswith(suffix)) for suffix in ['xAxisTitle','yAxisTitle']]
  for key in ['title','subtitle','title-group',*axis_keys,'legend:color']:
   hit=page.locator(f'.guide-hit[data-guide="{key}"]');expect(hit).to_be_visible(timeout=60000)
   if key=='title-group':
    page.locator('.guide-hit[data-guide=title]').hover()
    page.locator('[data-guide-key=title] .guide-together').click()
   else:
    hb=hit.bounding_box();page.mouse.move(hb['x']+hb['width']/2,hb['y']+hb['height']/2)
   expect(page.locator('.guide-control.active')).to_have_count(1)
   handle=page.locator(f'.guide-size[data-guide="{key}"]');expect(handle).to_be_visible()
   rect=handle.bounding_box();x=rect['x']+5;y=rect['y']+5
   page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+25,y+15,steps=5)
   try: expect(page.locator('#code-mode')).to_contain_text('Resize',timeout=30000)
   except Exception:
    page.screenshot(path=str(OUT/'failure.png'))
    print('FAILED',mode,faceted,key,page.locator('#current').get_attribute('class'),page.locator('#notice').text_content(),flush=True)
    raise
   page.mouse.up();step+=1
   expect(page.locator('#current')).to_have_attribute('data-steps',str(step),timeout=60000)
   page.wait_for_function('!document.querySelector("#current").classList.contains("editing-guide")')
   print('PASS',mode,'facet' if faceted else 'unit','resize',key,flush=True)
  for key in ['title-group','legend:color']:
   # Move to the bottom center of the plot, using its visible plot rectangle.
   if key=='title-group':
    page.locator('.guide-hit[data-guide=title]').hover();page.locator('[data-guide-key=title] .guide-together').click()
    start=page.locator('[data-guide-key=title-group]').bounding_box();x=start['x']+3;y=start['y']+start['height']/2
   else:
    hit=page.locator(f'.guide-hit[data-guide="{key}"]');hit.hover();start=hit.bounding_box();x=start['x']+start['width']/2;y=start['y']+start['height']/2
   plot=page.locator('.plot-boundary').bounding_box()
   page.mouse.move(x,y);page.mouse.down();page.mouse.move(plot['x']+plot['width']/2,plot['y']+plot['height']+40,steps=8);page.mouse.up();step+=1
   expect(page.locator('#current')).to_have_attribute('data-steps',str(step),timeout=60000)
   page.wait_for_function('!document.querySelector("#current").classList.contains("editing-guide")')
   print('PASS',mode,'facet' if faceted else 'unit','move',key,flush=True)
  page.locator('h1').hover();expect(page.locator('.guide-control.active')).to_have_count(0)
  page.screenshot(path=str(OUT/f'{mode}-{faceted}.png'))
  # Cancel must not append a history step.
  hit=page.locator('.guide-hit[data-guide=title]');hit.hover();h=page.locator('.guide-size[data-guide=title]').bounding_box()
  page.mouse.move(h['x']+5,h['y']+5);page.mouse.down();page.mouse.move(h['x']+35,h['y']+15,steps=4);page.keyboard.press('Escape');page.mouse.up()
  expect(page.locator('#current')).to_have_attribute('data-steps',str(step))
  page.locator('#undo').click();expect(page.locator('#current')).to_have_attribute('data-steps',str(step-1),timeout=60000)
  page.locator('#redo').click();expect(page.locator('#current')).to_have_attribute('data-steps',str(step),timeout=60000)
  assert not errors,errors
  page.close()
 b.close()
