"""View-only zoom, pointer navigation and native editing at non-default zoom."""
import json, subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
OUT=Path('output/chart-zoom');OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','--input-type=module','-e',r'''
import {writeFileSync} from 'node:fs';import {createProject} from './web/project.js';import {importDataset} from './src/data-import.js';
const rows=Array.from({length:24},(_,i)=>({X:i+1,Y:i*2+5,Group:['A','B','C'][i%3]}));
const c=(method,args={})=>({method,args});
const setupCalls=[c('createCanvas',{plot:{width:314,height:314},margin:160}),c('createData',{id:'dataset',values:'__LOADED_DATA__'})];
const calls=[c('createScatterPlot',{id:'plot',data:'dataset',x:'X',y:'Y',color:{field:'Group',fieldType:'nominal'}}),c('createTitle',{text:'Zoom test',titleStyle:{fontSize:23}})];
const snapshot={setupCalls,calls,guideCall:c('createGuides',{legend:{target:'plot',channels:['color']}}),steps:2,phase:'recommendations',selection:{fields:['X','Y','Group']},currentNote:'Add title',context:{target:'plot'},plotData:'dataset',optionGroup:'style'};
const imported=importDataset(JSON.stringify(rows),{format:'json',name:'Zoom example'});
writeFileSync('output/chart-zoom/project.json',JSON.stringify(createProject([{id:'zoom',name:'Zoom example',imported,session:{entries:[snapshot],index:0}}],'zoom')));
'''],check=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
 for mode,kind in [('preview','unit'),('transition','unit'),('preview','facet'),('transition','concat')]:
  page=browser.new_page(viewport={'width':1700,'height':1100});page.set_default_timeout(45000);errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.add_init_script(f"localStorage.setItem('vis-autocomplete.view-mode','{mode}');")
  try:
   page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
   fixture=json.loads((OUT/'project.json').read_text());calls=fixture['datasets'][0]['session']['entries'][0]['calls']
   if kind=='facet':calls.append({'method':'facet','args':{'field':'Group','columns':3,'guides':{'axes':'outer','legend':'shared'}}})
   if kind=='concat':
    fixture['datasets'][0]['session']['entries'][0]['guideCall']={'method':'createGuides','args':{'target':[{'childPath':['plot']},{'childPath':['second']}]}}
    calls.extend([{'method':'createGuides','args':{'legend':{'target':'plot','channels':['color']}}},{'method':'createAdjacentPlot','args':{'id':'second','source':'plot','position':'right','share':{'color':True},'plot':{'action':'createScatterPlot'}}}])
   path=OUT/f'{mode}-{kind}.json';path.write_text(json.dumps(fixture));page.locator('#project-file').set_input_files(str(path))
   stage=page.locator('#current .canvas-stage');expect(stage).to_be_visible()
   tools=page.get_by_role('group',name='Current visualization zoom',exact=True);expect(tools).to_be_visible()
   clip=page.get_by_label('Current visualization viewport',exact=True);count=page.locator('.history-item').count()
   native=page.locator('#current canvas[data-chart]').get_attribute('data-logical-width');base=stage.bounding_box()
   tools.get_by_role('button',name='Zoom in',exact=True).click();expect(tools.locator('.chart-zoom-value')).to_have_text('120%')
   b=stage.bounding_box();assert abs(b['width']/base['width']-1.2)<.005
   assert page.locator('.history-item').count()==count
   assert page.locator('#current canvas[data-chart]').get_attribute('data-logical-width')==native
   if mode=='preview' and kind=='unit':
    with page.expect_download() as downloaded:
     page.get_by_role('button',name='Download current visualization as SVG',exact=True).click()
    root=ET.parse(downloaded.value.path()).getroot()
    assert abs(float(root.attrib['viewBox'].split()[2])-float(native))<.01

   tools.get_by_role('button',name='Fit chart to view').click();expect(tools.locator('.chart-zoom-value')).to_have_text('100%')
   box=clip.bounding_box();cx=box['x']+box['width']/2;cy=box['y']+box['height']*.7
   page.mouse.move(cx,cy);page.mouse.wheel(0,-200);page.wait_for_function("Number(document.querySelector('#current').dataset.chartZoom)>1.4")
   point=clip.evaluate('''el=>{const b=el.getBoundingClientRect();for(const fy of [.35,.5,.65,.8])for(const fx of [.3,.5,.7]){const x=b.x+b.width*fx,y=b.y+b.height*fy,t=document.elementFromPoint(x,y);if(t&&el.contains(t)&&!t.closest('button,input,select,textarea,a'))return {x,y};}throw new Error('No chart-space pan surface');}''')
   px=point['x'];py=point['y'];page.mouse.move(px,py);page.mouse.down();page.mouse.move(px+40,py+20,steps=6);page.mouse.up()
   page.wait_for_function("new DOMMatrix(getComputedStyle(document.querySelector('#current')).transform).e>20")
   assert page.locator('.history-item').count()==count
   tools.get_by_role('button',name='Fit chart to view').click();expect(tools.locator('.chart-zoom-value')).to_have_text('100%')
   clip.focus();page.keyboard.press('-');expect(tools.locator('.chart-zoom-value')).to_have_text('83%');page.keyboard.press('0');expect(tools.locator('.chart-zoom-value')).to_have_text('100%')
   # Keep authoring controls correctly aligned and scaled after zooming.
   if kind=='unit':
    tools.get_by_role('button',name='Zoom in',exact=True).click();expect(tools.locator('.chart-zoom-value')).to_have_text('120%')
    legend=page.locator('.guide-control[data-guide-key="legend:color"]');b=legend.bounding_box();page.mouse.move(b['x']+b['width']/2,b['y']+b['height']/2)
    h=legend.locator('.guide-size').bounding_box();page.mouse.move(h['x']+h['width']/2,h['y']+h['height']/2);page.mouse.down();page.mouse.move(h['x']+22,h['y']+14,steps=8);page.mouse.up()
    page.wait_for_function('(n)=>document.querySelectorAll(".history-item").length>n&&!document.querySelector("#undo").disabled',arg=count)
    expect(tools.locator('.chart-zoom-value')).to_have_text('120%')
    page.locator('#undo').click();page.wait_for_function('(n)=>document.querySelectorAll(".history-item").length===n||!document.querySelector("#redo").disabled',arg=count)
   if kind=='unit':
    # Native resize distances use the zoomed screen scale, not fit scale.
    page.wait_for_timeout(400)
    plot=page.locator('#current .plot-boundary');pb=plot.bounding_box();scale=pb['width']/314
    expected=314+2*round(18/scale)
    x=pb['x']+pb['width'];y=pb['y']+pb['height']/2
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+18,y,steps=6);page.mouse.up()
    page.wait_for_function('()=>!document.querySelector("#current").classList.contains("resizing")&&!document.querySelector("#undo").disabled')
    text=plot.locator('.resize-label').inner_text();actual=int(text.split()[1]);assert abs(actual-expected)<=2,(actual,expected)
    expect(tools.locator('.chart-zoom-value')).to_have_text('120%')
   # Hover candidates with the camera active; no reset or transition errors.
   card=page.locator('.card').first;expect(card).to_be_visible();card.locator('.card-top').hover()
   if mode=='transition':
    expect(page.locator('#current .transition-surface canvas')).to_be_visible()
   page.mouse.move(5,5);page.wait_for_timeout(600)
   tools.get_by_role('button',name='Zoom in',exact=True).click();page.wait_for_timeout(150);page.screenshot(path=str(OUT/f'{mode}-{kind}.png'))
   if kind=='unit':
    zoom=page.locator('#current').get_attribute('data-chart-zoom');before=page.locator('.history-item').count()
    card=page.locator('.card').first;card.locator('.card-top').hover();card.locator('.apply-button').click()
    page.wait_for_function('(n)=>document.querySelectorAll(".history-item").length>n&&!document.querySelector("#undo").disabled',arg=before)
    assert page.locator('#current').get_attribute('data-chart-zoom')==zoom
   page.locator('#reset').click();page.wait_for_function("document.querySelector('#current').dataset.chartZoom==='1'");expect(tools).to_be_hidden()
   assert errors==[],errors
   print('PASS',mode,kind,'zoom/pan/fit/keyboard/hover/editing',flush=True)
  except:
   page.screenshot(path=str(OUT/f'{mode}-{kind}-failure.png'));print(page.locator('#notice').inner_text(),flush=True);raise
  finally:page.close()
 browser.close()
