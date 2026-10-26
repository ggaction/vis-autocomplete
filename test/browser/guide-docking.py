"""Real pointer docking, row reflow and title movement in an isolated account.

Start a local server and the mock session from
scripts/audit-browser-session-2026-10-25.mjs with Chromium's CDP port enabled.
Run: python test/browser/guide-docking.py --cdp http://127.0.0.1:9333
The mock account makes no external account writes.
"""
import argparse, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
parser=argparse.ArgumentParser(); parser.add_argument('--cdp',required=True); args=parser.parse_args()
out=Path('output/guide-docking');out.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','--input-type=module','-e',r'''
import {writeFileSync} from 'node:fs';import {createProject} from './web/project.js';import {importDataset} from './src/data-import.js';
const c=(method,args)=>({method,args});
const imported=importDataset(JSON.stringify(Array.from({length:18},(_,i)=>({x:i+1,y:2*i+3,g:['Alpha','Beta','Gamma'][i%3]}))),{format:'json',name:'Docking'});
for(const kind of ['unit','facet','concat','multiple']){
 const setupCalls=[c('createCanvas',{plot:{width:314,height:314},margin:180}),c('createData',{id:'dataset',values:'__LOADED_DATA__'})];
 const calls=[c('createScatterPlot',{id:'plot',data:'dataset',x:'x',y:'y',color:{field:'g',fieldType:'nominal'}}),c('createLegend',{target:'plot',channels:['color'],columns:1})];
 if(kind==='multiple')calls.push(c('encodeSize',{target:'plot',field:'x'}),c('createLegend',{target:'plot',channels:['size']}));
 if(kind==='facet') calls.push(c('facet',{field:'g',columns:3,guides:{legend:'shared',axes:'outer'}}));
 if(kind==='concat')calls.push(c('createAdjacentPlot',{id:'second',source:'plot',position:'right',plot:{action:'createScatterPlot',options:{data:'dataset',x:'x',y:'y',color:{field:'g',fieldType:'nominal'}}},share:{color:true},align:'plot'}));
 calls.push(c('createTitle',{text:'Drag to dock',subtitle:'Keep labels readable'}));
 const snapshot={setupCalls,calls,guideCall:c('createGuides',{...(kind==='concat'?{target:[{childPath:['plot']},{childPath:['second']}]}:{})}),steps:calls.length,phase:'recommendations',selection:{x:'x',y:'y',color:'g'},currentNote:'Before docking',context:{target:'plot'},plotData:'dataset',optionGroup:'encoding'};
 writeFileSync(`output/guide-docking/${kind}.json`,JSON.stringify(createProject([{id:`dock-${kind}`,name:'Docking',imported,session:{entries:[snapshot],index:0}}],`dock-${kind}`)));
}
'''],check=True)
with sync_playwright() as p:
 browser=p.chromium.connect_over_cdp(args.cdp);page=browser.contexts[0].pages[0];errors=[]
 page.on('pageerror',lambda error:errors.append(str(error)))
 page.wait_for_load_state('networkidle');expect(page.locator('#dataset')).to_be_enabled(timeout=60000)
 def ready():
  expect(page.locator('#reset')).to_be_enabled(timeout=60000)
  page.wait_for_function('!document.querySelector("#current").classList.contains("editing-guide")')
 def drag(hit,x,y):
  r=hit.bounding_box();sx=r['x']+r['width']/2;sy=r['y']+r['height']/2
  page.mouse.move(sx,sy);page.mouse.down();page.mouse.move(x,y,steps=12);page.mouse.up();ready()
 def guide(part):
  return page.locator('#current .guide-control').filter(has=page.locator(f'.guide-hit[data-guide$="{part}"]')).first
 for mode in ['transition','preview']:
  for kind,steps in [('unit',3),('facet',4),('concat',4),('multiple',5)]:
   page.locator('#project-file').set_input_files(str(out/f'{kind}.json'))
   expect(page.locator('#current')).to_have_attribute('data-steps',str(steps),timeout=60000);ready()
   page.locator(f'#view-mode [data-mode="{mode}"]').click();ready()
   page.mouse.move(0,0)
   body=page.locator('#current .guide-hit[data-guide$=":items"]').first
   if kind=='multiple':
    body.click()
    page.get_by_label('Choose text groups',exact=True).click()
    page.get_by_role('button',name='Select all legends',exact=True).click()
    page.get_by_label('Choose text groups',exact=True).click()
   stage=page.locator('#current .canvas-stage').bounding_box()
   # Drop below the plot near its center, far enough for a screen-space snap.
   drag(body,stage['x']+stage['width']*.48,stage['y']+stage['height']*.86)
   expect(page.locator('#current')).to_have_attribute('data-steps',str(steps+1),timeout=60000);ready()
   expect(page.locator('#code-content')).to_contain_text('"position": "bottom"')
   expect(page.locator('#code-content')).to_contain_text('"columns": 3')
   after=body.bounding_box();assert after['width']>after['height'],(mode,kind,after)
   drag(body,after['x']+after['width']/2+5,after['y']+after['height']/2+3)
   expect(page.locator('#current')).to_have_attribute('data-steps',str(steps+1),timeout=60000);ready()
   after=body.bounding_box();assert after['width']>after['height'],(mode,kind,'nudge reverted layout',after)
   page.locator('#current').screenshot(path=str(out/f'{mode}-{kind}-bottom.png'))
   page.keyboard.press('Control+z');expect(page.locator('#current')).to_have_attribute('data-steps',str(steps),timeout=60000);ready()
   page.keyboard.press('Control+Shift+z');expect(page.locator('#current')).to_have_attribute('data-steps',str(steps+1),timeout=60000);ready()
   # A title must dock too, rather than accumulating an arbitrary offset.
   title=page.locator('#current .guide-hit[data-guide="title"]')
   stage=page.locator('#current .canvas-stage').bounding_box()
   drag(title,stage['x']+stage['width']*.1,stage['y']+stage['height']*.5)
   expect(page.locator('#current')).to_have_attribute('data-steps',str(steps+2),timeout=60000);ready()
   expect(page.locator('#code-content')).to_contain_text('"position": "left"')
   expect(page.locator('#code-content')).to_contain_text('"alongOffset": 0')
   page.locator('#current').screenshot(path=str(out/f'{mode}-{kind}-title.png'))
   print('PASS',mode,kind,'natural legend drag, horizontal reflow, title docking, Undo/Redo',flush=True)
 assert not errors,errors
