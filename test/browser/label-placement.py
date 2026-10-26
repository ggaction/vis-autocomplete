"""Gapminder rose label placement: real controls, hover/pin/Apply, persisted native options."""
from saved_project import read_saved_project
import subprocess,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
subprocess.run(['node','--input-type=module','-e',r'''
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {importDataset} from './src/data-import.js';
import {createProject} from './web/project.js';
import {defaultCanvasOptions,prepareGuidedAction} from './src/prepare.js';
import {chart} from 'ggaction';
const imported=importDataset(readFileSync('web/data/gapminder.json','utf8'),{format:'json',name:'Gapminder'});
const summary={method:'createSummaryData',args:{id:'summary',source:'dataset',groupBy:['region'],aggregates:[{op:'mean',field:'gdpPercap',as:'gdpPercap'}],missing:'drop'}};
const calls=[{method:'createRosePlot',args:{id:'plot',data:'summary',category:'region',value:'gdpPercap',aggregate:'sum',color:'region',guides:{axes:{radius:{ticksAndLabels:{count:3}}}}}},
 {method:'createMarkLabels',args:{id:'labels',source:'plot',content:'value',fontFamily:'Arial',fontSize:11,placement:{anchor:'outsideEnd',gap:4}}}];
let program=chart().createCanvas(defaultCanvasOptions()).createData({id:'dataset',values:imported.rows}).createSummaryData(summary.args),view=program,guideCall;
const emitted=[];
for(const call of calls){const prepared=prepareGuidedAction(program,call,view);emitted.push(...prepared.prerequisiteCalls,{method:prepared.recommendation.method,args:prepared.recommendation.args},...prepared.postActionCalls);program=prepared.authoringPreview;view=prepared.preview;guideCall=prepared.guideCall;}
const snapshot={setupCalls:[{method:'createCanvas',args:defaultCanvasOptions()},{method:'createData',args:{id:'dataset',values:'__LOADED_DATA__'}},summary],calls:emitted,
 guideCall,steps:2,phase:'recommendations',selection:{x:'region',y:'gdpPercap',color:'region'},currentNote:'Add value labels',context:{target:'plot'},plotData:'summary',optionGroup:'style'};
mkdirSync('output/label-placement',{recursive:true});
writeFileSync('output/label-placement/rose.visauto.json',JSON.stringify(createProject([{id:'labels',name:'Gapminder',imported,session:{entries:[snapshot],index:0}}],'labels')));
'''],check=True)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
 page=b.new_page(viewport={'width':1800,'height':1200});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
 page.locator('#project-file').set_input_files('output/label-placement/rose.visauto.json')
 expect(page.locator('#current')).to_have_attribute('data-steps','2',timeout=60000)
 page.locator('#action-search').fill('editMarkLabelPlacement')
 expect(page.locator('#cards')).to_have_attribute('data-search-query','editmarklabelplacement',timeout=60000)
 expect(page.locator('.card-row').first).to_have_attribute('aria-busy','false',timeout=60000)
 card=page.locator('.card[data-method=editMarkLabelPlacement]');expect(card).to_be_visible()
 card.locator('.card-top').hover(position={'x':35,'y':16})
 for name in ['Position','Overflow','Leader line']:expect(card.get_by_text(name,exact=True)).to_be_visible()
 expect(card.get_by_role('slider',name='Edit label placement: Gap slider',exact=True)).to_be_visible()
 expect(card.get_by_role('button',name='placement',exact=True)).to_have_count(0)
 inside=card.get_by_role('button',name='Inside end',exact=True);inside.hover()
 expect(card).to_have_attribute('data-preview-state','ready',timeout=60000)
 expect(page.locator('#current')).to_have_attribute('data-steps','2')
 inside.click();card.get_by_role('button',name='Show',exact=True).click()
 slider=card.locator('input[type=range]');slider.focus();slider.press('ArrowRight')
 expect(card).to_have_attribute('data-preview-state','ready',timeout=60000)
 page.screenshot(path='output/label-placement/card.png')
 card.locator('.apply-button').click()
 expect(page.locator('#current')).to_have_attribute('data-steps','3',timeout=60000)

 project=read_saved_project(page);session=next(ds for ds in project['datasets'] if ds['id']==project['activeId'])['session']
 call=next(c for c in reversed(session['entries'][session['index']]['calls']) if c['method']=='editMarkLabelPlacement')
 assert call['args']['placement']['anchor']=='insideEnd',call
 assert call['args']['placement']['gap']==5,call
 assert call['args']['placement']['leader']['strokeWidth']==1,call
 assert not errors,errors
 print('PASS Gapminder rose: four meaningful controls, hover without commit, pinned placement + leader + gap, Apply and saved public call',flush=True)
 b.close()
