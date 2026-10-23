"""Resize each color legend representation through the actual pointer/worker path."""
import json
import subprocess
from itertools import product
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUT = Path('output/legend-resize')
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', r'''
import {writeFileSync} from 'node:fs';
import {createProject} from './web/project.js';
import {importDataset} from './src/data-import.js';
const rows=Array.from({length:18},(_,i)=>({X:i+1,Y:i*2+5,Group:['A','B','C'][i%3]}));
const c=(method,args)=>({method,args});
const setupCalls=[c('createCanvas',{plot:{width:314,height:314},margin:160}),c('createData',{id:'dataset',values:'__LOADED_DATA__'})];
for(const kind of ['categorical','gradient','strokeGradient','symbols'])for(const faceted of [false,true]){
 const channel=kind==='strokeGradient'?'stroke':'color';
 const calls=[c('createScatterPlot',{id:'plot',data:'dataset',x:'X',y:'Y'}),
  c(channel==='stroke'?'encodeStroke':'encodeColor',{target:'plot',field:kind==='categorical'?'Group':'Y',fieldType:kind==='categorical'?'nominal':'quantitative'})];
 if(kind==='symbols')calls.push(c('createLegend',{target:'plot',channels:[channel]}),c('editLegend',{target:'plot',channel,representation:'symbols'}));
 if(faceted)calls.push(c('facet',{field:'Group',columns:3,guides:{axes:'outer',legend:'shared'}}));
 const snapshot={setupCalls,calls,guideCall:c('createGuides',kind==='symbols'?{}:{legend:{target:'plot',channels:[channel]}}),steps:calls.length,phase:'recommendations',selection:{x:'X',y:'Y',color:channel==='color'?'Y':null},currentNote:'Legend resize',context:{target:'plot'},plotData:'dataset',optionGroup:'style'};
 const imported=importDataset(JSON.stringify(rows),{format:'json',name:'Legend example'});
 writeFileSync(`output/legend-resize/${kind}-${faceted}.json`,JSON.stringify(createProject([{id:'legend',name:'Legend example',imported,session:{entries:[snapshot],index:0}}],'legend')));
}
'''], check=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    for mode, faceted, kind in product(['preview', 'transition'], [False, True], ['categorical', 'gradient', 'strokeGradient', 'symbols']):
        page = browser.new_page(viewport={'width':1800,'height':1200})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto('http://127.0.0.1:5173/')
        page.wait_for_load_state('networkidle')
        fixture = OUT / f'{kind}-{str(faceted).lower()}.json'
        steps = json.loads(fixture.read_text())['datasets'][0]['session']['entries'][0]['steps']
        page.locator('#project-file').set_input_files(str(fixture))
        expect(page.locator('#current')).to_have_attribute('data-steps', str(steps), timeout=60000)
        page.locator(f'#view-mode [data-mode={mode}]').click()
        page.locator('h1').hover()
        key = 'color' if kind == 'categorical' else 'strokeGradient' if kind == 'strokeGradient' else 'gradient'
        control = page.locator(f'.guide-control[data-guide-key="legend:{key}"]')
        hit = control.locator('.guide-hit')
        expect(hit).to_be_visible()
        original = control.bounding_box()
        for direction in [1, -1]:
            hit.hover()
            handle = control.locator('.guide-size')
            expect(handle).to_be_visible()
            rect = handle.bounding_box()
            x, y = rect['x']+rect['width']/2, rect['y']+rect['height']/2
            page.mouse.move(x,y)
            page.mouse.down()
            page.mouse.move(x+15*direction,y+35*direction,steps=10)
            expect(page.locator('#code-mode')).to_contain_text('Resize',timeout=30000)
            page.mouse.up()
            steps += 1
            expect(page.locator('#current')).to_have_attribute('data-steps',str(steps),timeout=60000)
            page.wait_for_function('!document.querySelector("#current").classList.contains("editing-guide")')
            changed = control.bounding_box()
            assert direction * (changed['height']-original['height']) > 1, (mode,faceted,kind,original,changed)
            original = changed
        page.locator('h1').hover()
        if kind == 'gradient' and not faceted:
            page.screenshot(path=str(OUT / f'{mode}.png'))
        assert not errors, errors
        print('PASS',mode,faceted,kind,'grow + shrink',flush=True)
        page.close()
    browser.close()
