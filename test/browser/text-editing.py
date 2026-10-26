"""Direct Canvas text editing in an isolated authenticated local browser."""
import argparse, json, subprocess, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from saved_project import read_saved_project
parser=argparse.ArgumentParser();parser.add_argument('--cdp',required=True);args=parser.parse_args()
out=Path('output/text-editing');out.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','--input-type=module','-e',r'''
import {writeFileSync} from 'node:fs';import {createProject,restoreSession} from './web/project.js';import {importDataset} from './src/data-import.js';import {editableTextTargets} from './src/text-editing.js';
import {resolvePrimitiveGraphicBounds,resolveGraphicParentOffset} from './vendor/ggaction/src/grammar/schemas/graphicBounds.js';
const c=(method,args)=>({method,args}), imported=importDataset(JSON.stringify([{x:1,y:2,g:'A'},{x:2,y:4,g:'B'},{x:3,y:6,g:'A'}]),{format:'json',name:'Text editing'});
for(const kind of ['unit','facet','adjacent','parallel','polar','bar','continuous','annotation','multiline']){
 const setupCalls=[c('createCanvas',{plot:{width:314,height:314},margin:180}),c('createData',{id:'dataset',values:'__LOADED_DATA__'})];
 const constructor=kind==='parallel'?c('createParallelCoordinates',{id:'plot',data:'dataset',dimensions:['g','x','y'],color:'g'}):kind==='polar'?c('createRosePlot',{id:'plot',data:'dataset',category:'g',value:'y'}):kind==='bar'?c('createBarPlot',{id:'plot',data:'dataset',x:'g',y:{field:'y',aggregate:'sum'},color:'g'}):c('createScatterPlot',{id:'plot',data:'dataset',x:'x',y:'y',color:'g'});
 const calls=[constructor,c('createTitle',{text:kind==='multiline'?'\nFirst\n\nLast':'Title',subtitle:'Subtitle',...(kind==='multiline'?{maxWidth:300,lineHeight:34,titleStyle:{fontSize:22,fontFamily:'Georgia'}}:{})})];
 if(kind==='annotation')calls.push(c('createAnnotation',{id:'note',anchor:'plot-center',data:'dataset',coordinate:'main',text:'A note',fontSize:20,rotation:0.2}));
 if(kind==='continuous')calls.push(c('encodeColor',{target:'plot',field:'x',fieldType:'quantitative'}),c('encodeSize',{target:'plot',field:'y',fieldType:'quantitative'}));
 if(['unit','facet','adjacent'].includes(kind))calls.splice(1,0,c('createLegend',{target:'plot',channels:['color']}));
 if(['unit','facet','adjacent'].includes(kind))calls.push(c('createMarkLabels',{id:'labels',source:'plot',field:'g'}));
 if(kind==='facet')calls.push(c('facet',{field:'g',columns:2,guides:{axes:'outer',legend:'shared'}}));
 if(kind==='adjacent')calls.push(c('createAdjacentPlot',{id:'right',source:'plot',position:'right',plot:{action:'createScatterPlot',options:{x:'x',y:'y'}},share:{color:true}}));
 const guideCall=c('createGuides',kind==='adjacent'?{target:[{childPath:['plot']},{childPath:['right']}]}:kind==='continuous'?{legend:{target:'plot',channels:['color','size']}}:{}),snapshot={setupCalls,calls,guideCall,steps:calls.length,phase:'recommendations',selection:{x:'x',y:'y',color:'g'},currentNote:kind,context:{target:'plot'},plotData:'dataset',optionGroup:'style'};
 const session={entries:[snapshot],index:0},project=createProject([{id:`text-${kind}`,name:'Text editing',imported,session}],`text-${kind}`);
 writeFileSync(`output/text-editing/${kind}.json`,JSON.stringify(project));
 const view=restoreSession(session,imported.rows).entries[0].view;
 const blocked=kind!=='continuous'?[]:['xAxisLabels','yAxisLabels','colorGradientLabels','sizeLegendLabels'].map(id=>{
  const object=view.graphicSpec.objects[id],item=object.items[0],b=resolvePrimitiveGraphicBounds('text',item.properties,view.materializationConfigs.textMetrics),[dx,dy]=resolveGraphicParentOffset(view.graphicSpec,id);
  return {id,bounds:{left:b.left+dx,right:b.right+dx,top:b.top+dy,bottom:b.bottom+dy}};
 });
 writeFileSync(`output/text-editing/${kind}-targets.json`,JSON.stringify({width:view.graphicSpec.objects.canvas.properties.width,targets:editableTextTargets(view).map(({id,text,label,bounds})=>({id,text,label,bounds})),blocked}));
}
'''],check=True)
with sync_playwright() as p:
 browser=p.chromium.connect_over_cdp(args.cdp);page=browser.contexts[0].pages[0];errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.wait_for_load_state('networkidle');expect(page.locator('#dataset')).to_be_enabled(timeout=60000)
 def load(kind,mode):
  if page.locator('#current canvas').count(): expect(page.locator('#reset')).to_be_enabled(timeout=60000)
  page.locator('#project-file').set_input_files(str(out/f'{kind}.json'))
  expect(page.locator('#current-note')).to_have_text(kind,timeout=60000)
  expect(page.locator('#reset')).to_be_enabled(timeout=60000)
  page.locator(f'#view-mode [data-mode="{mode}"]').click()
  page.mouse.move(0,0)
  page.evaluate('''()=>new Promise(resolve=>{let last='',stable=0;function frame(){const r=document.querySelector('#current .canvas-stage').getBoundingClientRect(),value=[r.x,r.y,r.width,r.height].join();stable=value===last?stable+1:0;last=value;if(stable>=4)resolve();else requestAnimationFrame(frame);}requestAnimationFrame(frame);})''')
 def open_target(kind,label,text=None):
  page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  data=json.loads((out/f'{kind}-targets.json').read_text());target=next(t for t in data['targets'] if t['label']==label and (text is None or t['text']==text))
  stage=page.locator('#current .canvas-stage');r=stage.bounding_box();b=target['bounds'];scale=r['width']/data['width']
  x=r['x']+(b['left']+b['right'])/2*scale;y=r['y']+(b['top']+b['bottom'])/2*scale
  page.mouse.dblclick(x,y,delay=100)
  try:
   expect(page.locator('.canvas-text-editor')).to_be_visible(timeout=5000)
  except Exception:
   page.screenshot(path=str(out/'failure.png'));print('Failed target',kind,label,target,r,x,y,flush=True);raise
  expect(page.locator('.canvas-text-editor textarea')).to_have_value(target['text'])
  return page.locator('.canvas-text-editor textarea')
 for mode in ['transition','preview']:
  for kind,label,text in [('unit','Title',None),('unit','Legend item','A'),('unit','Mark label','B'),('facet','Facet heading','A'),('adjacent','Legend item','A'),('parallel','Category label','A'),('polar','Category label','A'),('bar','Category label','A'),('annotation','Annotation',None),('unit','Axis title','y'),('multiline','Title',None)]:
   if os.environ.get('TEXT_CASE') and os.environ['TEXT_CASE']!=f'{mode}-{kind}': continue
   load(kind,mode)
   area=open_target(kind,label,text)
   assert area.evaluate("e=>e.closest('.canvas-stage')!==null && getComputedStyle(e).backgroundColor==='rgba(0, 0, 0, 0)'")
   assert page.locator('.canvas-text-editor button').count()==0
   page.locator('#current').screenshot(path=str(out/f'{mode}-{kind}-{label.replace(" ","-")}-editing.png'))
   area.fill('Edited')
   area.press('Meta+Enter');area.press('X');expect(area).to_have_value('Edited\nX')
   area.press('Control+Enter');area.press('Y');expect(area).to_have_value('Edited\nX\nY')
   area.press('Shift+Enter');area.press('Z');expect(area).to_have_value('Edited\nX\nY\nZ')
   area.press('Escape');expect(page.locator('.canvas-text-editor')).to_have_count(0)
   area=open_target(kind,label,text)
   assert area.evaluate("e=>e.closest('.canvas-stage')!==null && getComputedStyle(e).backgroundColor==='rgba(0, 0, 0, 0)'")
   assert page.locator('.canvas-text-editor button').count()==0
   page.locator('#current').screenshot(path=str(out/f'{mode}-{kind}-{label.replace(" ","-")}-editing.png'))
   area.fill('Edited');area.press('Shift+Enter');area.press('X');page.get_by_role('button',name='Align text right',exact=True).click();expect(area).to_be_visible();area.press('Enter')
   expect(page.locator('.canvas-text-editor')).to_have_count(0,timeout=60000)
   expect(page.locator('#current-note')).to_have_text(f'Edit {label.lower()}',timeout=60000)
   page.locator('#current').screenshot(path=str(out/f'{mode}-{kind}-{label.replace(" ","-")}.png'))
   page.keyboard.press('Meta+z');expect(page.locator('#current-note')).to_have_text(kind,timeout=60000)
   page.keyboard.press('Meta+Shift+z');expect(page.locator('#current-note')).to_have_text(f'Edit {label.lower()}',timeout=60000)
   print(mode,kind,label,'OK',flush=True)
 # Header scope controls also work outside text editing, in both modes.
 for mode in ['transition','preview']:
  load('annotation',mode)
  page.get_by_label('Choose text groups',exact=True).click()
  page.get_by_label('All text',exact=True).check()
  page.get_by_label('Choose text groups',exact=True).click()
  page.get_by_role('button',name='Align text left',exact=True).click()
  expect(page.locator('#current-note')).to_have_text('Align text left',timeout=60000)
  saved=read_saved_project(page)
  entry=next(d['session'] for d in saved['datasets'] if d['id']==saved['activeId'])
  calls=entry['entries'][entry['index']]['calls']
  assert any(c['method']=='editTextMark' and c['args'].get('align')=='left' for c in calls),calls
  page.keyboard.press('Meta+z');expect(page.locator('#current-note')).to_have_text('annotation',timeout=60000)
  # Zoom and resizing move the in-place editor with its existing chart stage.
  page.get_by_role('button',name='Zoom in',exact=True).first.click()
  area=open_target('annotation','Annotation');area.fill('Outside apply')
  page.set_viewport_size({'width':1500,'height':1050})
  expect(area).to_be_visible()
  page.wait_for_function("()=>{const e=document.querySelector('.canvas-text-editor textarea');return Math.abs(parseFloat(getComputedStyle(e).fontSize)-20*e.closest('.canvas-stage').clientWidth/674)<.01}")
  page.locator('#current').screenshot(path=str(out/f'{mode}-zoomed-annotation-editing.png'))
  page.locator('.app-header h1').click()
  expect(page.locator('.canvas-text-editor')).to_have_count(0,timeout=60000)
  expect(page.locator('#current-note')).to_have_text('Edit annotation',timeout=60000)
  page.set_viewport_size({'width':1800,'height':1200})
  page.get_by_role('button',name='Fit chart to view',exact=True).first.click()
  print(mode,'header alignment, zoom, resize and outside apply OK',flush=True)
 # Continuous axis and legend numbers are not text-edit targets in either mode.
 for mode in ['transition','preview']:
  load('continuous',mode)
  data=json.loads((out/'continuous-targets.json').read_text())
  for target in data['blocked']:
   r=page.locator('#current .canvas-stage').bounding_box();b=target['bounds'];scale=r['width']/data['width']
   page.mouse.dblclick(r['x']+(b['left']+b['right'])/2*scale,r['y']+(b['top']+b['bottom'])/2*scale,delay=100)
   expect(page.locator('.canvas-text-editor')).to_have_count(0)
  print(mode,'continuous numeric text stays read-only',flush=True)
 # IME Enter must not apply or add a newline.
 load('unit','transition');area=open_target('unit','Title');area.fill('한글')
 area.evaluate("e=>e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))")
 # Synthetic composition does not engage the OS IME. Dispatch its composing
 # keydown directly, without Playwright inserting a normal textarea newline.
 area.dispatch_event('keydown',{'key':'Enter','isComposing':True});expect(area).to_be_visible()
 area.dispatch_event('keydown',{'key':'Enter','shiftKey':True,'isComposing':True});expect(area).to_have_value('한글')
 area.evaluate("e=>e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))")
 area.press('Escape');expect(page.locator('.canvas-text-editor')).to_have_count(0)
 # Accepted text survives autosave and a complete application reload.
 area=open_target('unit','Title');area.fill('Persisted title');area.press('Enter')
 expect(page.locator('.canvas-text-editor')).to_have_count(0,timeout=60000)
 expect(page.locator('#cloud-status')).to_have_text('Saved',timeout=60000)
 expect(page.locator('#reset')).to_be_enabled(timeout=60000)
 page.reload();page.wait_for_load_state('networkidle')
 expect(page.locator('#reset')).to_be_enabled(timeout=60000)
 expect(page.locator('#current-note')).to_have_text('Edit title',timeout=60000)
 page.locator('#code-content .code-call[data-method="editTitle"]').last.locator('summary').click()
 expect(page.locator('#code-content')).to_contain_text('Persisted title',timeout=10000)
 assert not errors,errors
 print('PASS: requested mode/chart cases plus IME, Enter, Shift/Cmd/Ctrl+Enter, Escape, Undo/Redo',flush=True)
 browser.close()
