"""Real option cards, long histories, pointer resize, Undo/Redo and both modes.
Requires the isolated authenticated audit browser on CDP (no external writes).
"""
import argparse
import json
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--cdp', default='http://127.0.0.1:9333')
args = parser.parse_args()
out = Path('output/realtime-optimization')
out.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', r'''
import {writeFileSync,readFileSync} from 'node:fs';
import {createProject} from './web/project.js';
import {importDataset} from './src/data-import.js';
const c=(method,args)=>({method,args});
for(const kind of ['long-scatter','facet','parallel','composition']){
 const rows=kind==='parallel'?importDataset(readFileSync('web/data/bike-sharing.csv','utf8'),{format:'csv',name:'Bike'}).rows:
  Array.from({length:kind==='long-scatter'?1500:180},(_,i)=>({x:i+1,y:2+Math.sin(i/9),g:`Group ${i%3}`}));
 const imported=importDataset(JSON.stringify(rows),{format:'json',name:kind});
 const setupCalls=[c('createCanvas',{plot:{width:400,height:314},margin:{left:100,right:180,top:70,bottom:80}}),c('createData',{id:'dataset',values:'__LOADED_DATA__'})];
 const color={field:'g',fieldType:'nominal'};
 const calls=kind==='parallel'?[c('createParallelCoordinates',{id:'plot',data:'dataset',dimensions:['temp','hum','atemp','windspeed','casual'],line:{opacity:.55}}),c('facet',{data:'dataset',field:'yr',columns:2,guides:{axes:'each',legend:false}})]:
  [c('createScatterPlot',{id:'plot',data:'dataset',x:'x',y:'y',color})];
 if(kind==='facet')calls.push(c('facet',{data:'dataset',field:'g',columns:3,guides:{axes:'outer',legend:'shared'}}));
 if(kind==='composition')calls.push(c('createAdjacentPlot',{id:'chart2',source:'plot',position:'right',plot:{action:'createLinePlot',options:{data:'dataset',x:'x',y:'y',color}},share:{x:true,y:true,color:true},gap:8}));
 const selection=kind==='parallel'?{x:'temp',y:'hum',color:''}:{x:'x',y:'y',color:'g'};
 const guideArgs=kind==='composition'?{target:[{childPath:['plot']},{childPath:['chart2']}]}:{};
 const snapshot=()=>({setupCalls,calls:[...calls],guideCall:c('createGuides',guideArgs),steps:calls.length,phase:'recommendations',selection,currentNote:kind,context:{target:'plot',...(kind==='composition'?{childPath:['plot']}:{})},plotData:'dataset',optionGroup:'encoding'});
 const entries=[snapshot()];
 if(kind==='long-scatter')for(let i=0;i<40;i++){calls.push(c('encodeOpacity',{target:'plot',value:i%2?.7:.5}));entries.push(snapshot());}
 const project=createProject([{id:kind,name:kind,imported,session:{entries,index:entries.length-1}}],kind);
 writeFileSync(`output/realtime-optimization/ui-${kind}.json`,JSON.stringify(project));
}
'''], check=True)

results = []
with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(args.cdp)
    page = browser.contexts[0].pages[0]
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    for kind in ['long-scatter', 'facet', 'parallel', 'composition']:
        if results:
            expect(page.locator('#reset')).to_be_enabled(timeout=90000)
        page.locator('#project-file').set_input_files(str(out / f'ui-{kind}.json'))
        expect(page.locator('#current-note')).to_have_text(kind, timeout=90000)
        expect(page.locator('#reset')).to_be_enabled(timeout=90000)
        page.wait_for_function('document.querySelector("#current").dataset.steps > 0', timeout=90000)
        page.wait_for_function('document.querySelector("#cards .card-row[aria-busy=false]")', timeout=90000)
        before = int(page.locator('#current').get_attribute('data-steps'))
        for mode in ['transition', 'preview']:
            page.locator(f'#view-mode [data-mode={mode}]').click()
            cards = page.locator('#cards .card:visible')
            count = min(cards.count(), 5)
            assert count > 0
            for i in range(15):
                cards.nth(i % count).locator('.card-top').hover(position={'x': 35, 'y': 16})
                page.wait_for_timeout(25)
            expect(page.locator('#current')).to_have_attribute('data-steps', str(before))
            page.locator('h1:visible').last.hover()
        page.locator('#view-mode [data-mode=transition]').click()
        page.locator('#action-search').fill('encodeOpacity')
        page.wait_for_function('document.querySelector("#cards").dataset.searchQuery === "encodeopacity"')
        card = page.locator('#cards .card').filter(has=page.locator('h3', has_text='opacity')).first
        expect(card).to_be_visible(timeout=90000)
        card.locator('.card-top').hover(position={'x': 35, 'y': 16})
        expect(card.locator('.apply-button')).to_be_enabled(timeout=90000)
        card.locator('.apply-button').click()
        expect(page.locator('#current')).to_have_attribute('data-steps', str(before + 1), timeout=90000)
        page.locator('h1:visible').last.hover()
        expect(page.locator('#undo')).to_be_enabled(timeout=90000)
        page.keyboard.press('Control+z')
        expect(page.locator('#current')).to_have_attribute('data-steps', str(before), timeout=90000)
        expect(page.locator('#redo')).to_be_enabled(timeout=90000)
        page.keyboard.press('Control+Shift+z')
        expect(page.locator('#current')).to_have_attribute('data-steps', str(before + 1), timeout=90000)
        expect(page.locator('#reset')).to_be_enabled(timeout=90000)
        if kind != 'composition':
            page.locator('h1:visible').last.hover()
            handle = page.locator('#current [data-resize=plot-se]')
            box = handle.bounding_box()
            x, y = box['x'] + box['width']/2, box['y'] + box['height']/2
            page.mouse.move(x, y); page.mouse.down()
            page.mouse.move(x + 25, y + 18, steps=12)
            page.mouse.up()
            expect(page.locator('#reset')).to_be_enabled(timeout=90000)
            page.wait_for_function('!document.querySelector("#current").classList.contains("resizing")')
        page.wait_for_function('document.querySelector("#cards .card-row[aria-busy=false]")', timeout=90000)
        page.screenshot(path=str(out / f'workflow-{kind}.png'))
        assert not errors, errors
        results.append({'chart': kind, 'initialSteps': before, 'rapidHovers': 30, 'applyUndoRedo': True})
        print(json.dumps(results[-1]), flush=True)
        page.locator('#action-search').fill('')
    browser.close()
(out / 'ui-workflows.json').write_text(json.dumps(results, indent=2))
