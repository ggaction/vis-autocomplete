"""Resize categorical color/shape legends from short-axis corners and every edge."""
import json
import subprocess
from itertools import product
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUT = Path('output/legend-resize-edges')
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', r'''
import {writeFileSync} from 'node:fs';
import {createProject} from './web/project.js';
import {importDataset} from './src/data-import.js';
const rows=Array.from({length:18},(_,i)=>({X:i+1,Y:i*2+5,Group:['A','B','C'][i%3]}));
const c=(method,args)=>({method,args});
const setupCalls=[c('createCanvas',{plot:{width:314,height:314},margin:160}),c('createData',{id:'dataset',values:'__LOADED_DATA__'})];
for(const kind of ['categorical','combined'])for(const faceted of [false,true]){
 const calls=[c('createScatterPlot',{id:'plot',data:'dataset',x:'X',y:'Y'}),
  c('encodeColor',{target:'plot',field:'Group',fieldType:'nominal'})];
 if(kind==='combined')calls.push(c('encodeShape',{target:'plot',field:'Group'}));
 calls.push(c('createLegend',{target:'plot',channels:kind==='combined'?['color','shape']:['color']}));
 if(faceted)calls.push(c('facet',{field:'Group',columns:3,guides:{axes:'outer',legend:'shared'}}));
 calls.push(c('editLegend',{target:'plot',channel:'color',position:'bottom'}));
 const snapshot={setupCalls,calls,guideCall:c('createGuides',{}),steps:calls.length,phase:'recommendations',selection:{x:'X',y:'Y',color:'Group'},currentNote:'Legend resize',context:{target:'plot'},plotData:'dataset',optionGroup:'style'};
 const imported=importDataset(JSON.stringify(rows),{format:'json',name:'Legend example'});
 writeFileSync(`output/legend-resize-edges/${kind}-${faceted}.json`,JSON.stringify(createProject([{id:'legend',name:'Legend example',imported,session:{entries:[snapshot],index:0}}],'legend')));
}
'''], check=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    for mode, faceted, kind in product(['preview', 'transition'], [False, True], ['categorical', 'combined']):
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
        key = 'color' if kind == 'categorical' else 'series'
        control = page.locator(f'.guide-control[data-guide-key="legend:{key}"]')
        hit = control.locator('.guide-hit')
        expect(hit).to_be_visible()
        # A small purely vertical corner drag used to be diluted by the long width.
        for edge in ['se','s','n','e','w','ne','nw','sw']:
            expect(page.locator('#reset')).to_be_enabled(timeout=60000)
            hit.hover()
            handle = control.locator(f'[data-guide-edge="{edge}"]')
            expect(handle).to_be_visible()
            rect = handle.bounding_box()
            x,y = rect['x']+rect['width']/2, rect['y']+rect['height']/2
            page.mouse.move(x,y,steps=12)
            assert page.evaluate('([x,y])=>document.elementFromPoint(x,y)?.dataset.guideOperation',[x,y]) == 'resize'
            before = control.bounding_box()
            # Use the short dimension for corners, and normal movement for edges.
            dx = before['width']*.25 * (-1 if edge=='w' else 1) if edge in ['e','w'] else 0
            dy = 0 if edge in ['e','w'] else before['height']*.3 * (-1 if 'n' in edge else 1)
            page.mouse.down();page.mouse.move(x+dx,y+dy,steps=8)
            expect(page.locator('#code-mode')).to_contain_text('Resize',timeout=30000)
            page.mouse.up();steps+=1
            expect(page.locator('#current')).to_have_attribute('data-steps',str(steps),timeout=60000)
            page.wait_for_function('!document.querySelector("#current").classList.contains("editing-guide")')
            after=control.bounding_box()
            assert after['height'] > before['height']*1.08,(mode,faceted,kind,edge,before,after)
            # Undo restores the fixture so all eight directions start from identical dimensions.
            page.locator('#undo').click();steps-=1
            expect(page.locator('#current')).to_have_attribute('data-steps',str(steps),timeout=60000)
            expect(page.locator('#reset')).to_be_enabled(timeout=60000)
        page.screenshot(path=str(OUT / f'{mode}-{faceted}-{kind}.png'))
        page.locator('h1').hover()
        assert not errors, errors
        print('PASS',mode,faceted,kind,'eight resize directions and Undo',flush=True)
        page.close()
    browser.close()
