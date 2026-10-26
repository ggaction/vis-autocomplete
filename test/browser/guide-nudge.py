"""Arrow-key taps/repeats, grouped moves, focus isolation and history replay.

Start scripts/open-audit-browser.js against a local server, then pass --cdp.
Uses an isolated mock account; no production requests or account writes.
"""
import argparse
import json
import re
import subprocess
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from saved_project import read_saved_project

parser = argparse.ArgumentParser()
parser.add_argument('--cdp', required=True)
args = parser.parse_args()
out = Path('output/guide-nudge')
out.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', r'''
import {writeFileSync} from 'node:fs';
import {createProject} from './web/project.js';
import {importDataset} from './src/data-import.js';
const rows=Array.from({length:24},(_,i)=>({X:i+1,Y:i*2+5,Group:['A','B','C'][i%3]}));
const imported=importDataset(JSON.stringify(rows),{format:'json',name:'Keyboard moves'});
const c=(method,args)=>({method,args});
for(const kind of ['unit','facet','concat']){
 const setupCalls=[c('createCanvas',{plot:{width:314,height:314},margin:160}),c('createData',{id:'dataset',values:'__LOADED_DATA__'})];
 const calls=[c('createScatterPlot',{id:'plot',data:'dataset',x:'X',y:'Y',color:{field:'Group',fieldType:'nominal'}}),c('encodeSize',{target:'plot',field:'Y'}),c('createGuides',{})];
 if(kind==='facet')calls.push(c('facet',{field:'Group',columns:3,guides:{axes:'outer',legend:'shared'}}));
 if(kind==='concat')calls.push(c('createAdjacentPlot',{id:'other',source:'plot',position:'right',plot:{action:'createScatterPlot',options:{data:'dataset',x:'X',y:'Y',color:{field:'Group',fieldType:'nominal'}}},share:{color:true}}));
 calls.push(c('createTitle',{text:'Overview',subtitle:'Keyboard movement',titleStyle:{fontFamily:'Arial',fontSize:23}}));
 const snapshot={setupCalls,calls,guideCall:c('createGuides',kind==='concat'?{target:[{childPath:['plot']},{childPath:['other']}]}:{}),steps:calls.length,phase:'recommendations',selection:{fields:['X','Y','Group']},currentNote:'Overview',context:{target:'plot'},plotData:'dataset',optionGroup:'style'};
 writeFileSync(`output/guide-nudge/${kind}.json`,JSON.stringify(createProject([{id:`nudge-${kind}`,name:`Nudge ${kind}`,imported,session:{entries:[snapshot],index:0}}],`nudge-${kind}`)));
}
'''], check=True)

SUMMARY = r'''
import {readFileSync} from 'node:fs';
import {restoreSession} from './web/project.js';
import {selectableGuides} from './src/guide-manipulation.js';
const p=JSON.parse(readFileSync(0,'utf8')), d=p.datasets.find(d=>d.id===p.activeId);
const s=restoreSession(d.session,d.imported.rows), e=s.entries[s.index];
console.log(JSON.stringify({index:s.index,entries:s.entries.length,calls:e.calls,
 guides:Object.fromEntries(selectableGuides(e.view).map(t=>[t.key,{kind:t.kind,bounds:t.bounds,
 position:t.config?.position,offset:t.config?.offset,along:t.config?.alongOffset??0}]))}));
'''

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(args.cdp)
    page = browser.contexts[0].pages[0]
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.wait_for_load_state('networkidle')
    host = page.locator('#current')

    def ready():
        page.wait_for_function('!document.querySelector("#current").classList.contains("editing-guide")')
        expect(page.locator('#chart-font')).to_be_enabled(timeout=60000)

    def summary():
        ready()
        saved = read_saved_project(page)
        result = subprocess.run(['node', '--input-type=module', '-e', SUMMARY], input=json.dumps(saved), text=True, capture_output=True, check=True)
        return json.loads(result.stdout), saved

    def hit(key):
        return page.locator(f'.guide-control[data-guide-key="{key}"] > .guide-hit')

    def select(key, shift=False):
        node = hit(key)
        # Parent legend hit areas surround smaller title/item hit areas.
        point = node.evaluate('''el=>{const r=el.getBoundingClientRect();
          for(const fx of [.5,.2,.8,.03,.97])for(const fy of [.5,.2,.8,.03,.97]){
            const x=r.x+r.width*fx,y=r.y+r.height*fy;
            if(document.elementFromPoint(x,y)===el)return {x,y};}return null;}''')
        assert point, f'No reachable selection surface: {key}'
        if shift:
            page.keyboard.down('Shift')
        page.mouse.click(point['x'], point['y'])
        if shift:
            page.keyboard.up('Shift')
        expect(page.locator(f'.guide-control[data-guide-key="{key}"]')).to_have_class(re.compile(r'\bselected\b'))
        expect(host).to_be_focused()

    def settle():
        # Keyup coalesces nearby taps before committing; wait for that boundary.
        page.wait_for_timeout(220)
        ready()

    for mode in ['transition', 'preview']:
        for kind in ['unit', 'facet', 'concat']:
            fixture = json.loads((out / f'{kind}.json').read_text())
            dataset_id = f'nudge-{mode}-{kind}-{time.time_ns()}'
            fixture['activeId'] = fixture['datasets'][0]['id'] = dataset_id
            fixture_path = out / 'current-fixture.json'
            fixture_path.write_text(json.dumps(fixture))
            page.locator('#project-file').set_input_files(str(fixture_path))
            expect(page.locator('#dataset')).to_have_value(dataset_id, timeout=60000)
            expect(page.locator('#current-note')).to_have_text('Overview', timeout=60000)
            expect(page.locator('.history-item')).to_have_count(1, timeout=60000)
            ready()
            page.locator(f'#view-mode [data-mode="{mode}"]').click()
            for _ in range(100):
                if read_saved_project(page)['activeId'] == dataset_id:
                    break
                page.wait_for_timeout(100)
            else:
                raise AssertionError('The newly imported project was not saved')
            initial, _ = summary()
            select('title')
            scroll = page.evaluate('({x:scrollX,y:scrollY})')
            for _ in range(3):
                page.keyboard.press('ArrowRight')
            settle()
            taps, _ = summary()
            assert taps['guides']['title']['along'] == initial['guides']['title']['along'] + 3, (mode, kind, initial['guides']['title'], taps['guides']['title'])
            assert taps['entries'] == initial['entries'] + 1
            select('title')
            page.evaluate('''window.nudgeKeyLog=[];
              if(!window.nudgeKeyLogger){window.nudgeKeyLogger=true;
                document.addEventListener("keydown",e=>{if(e.key==="ArrowRight")window.nudgeKeyLog.push(e.repeat)});}''')
            # Repeated keydown while the key stays down is the browser event
            # sequence generated by holding a physical arrow key.
            for _ in range(60):
                page.keyboard.down('ArrowRight')
                page.wait_for_timeout(12)
            assert page.evaluate('window.nudgeKeyLog.length === 60 && window.nudgeKeyLog.slice(1).every(Boolean)')
            expect(page.locator('.history-item')).to_have_count(taps['entries'])
            page.keyboard.up('ArrowRight')
            settle()
            held, _ = summary()
            assert held['guides']['title']['along'] == initial['guides']['title']['along'] + 63, held
            assert held['guides']['title']['position'] == initial['guides']['title']['position']
            assert held['entries'] == taps['entries']
            assert len([c for c in held['calls'] if c['method'] == 'editTitle']) == 1
            select('title')
            page.keyboard.press('Shift+ArrowRight')
            settle()
            fast, _ = summary()
            assert fast['guides']['title']['along'] == initial['guides']['title']['along'] + 73
            assert page.evaluate('({x:scrollX,y:scrollY})') == scroll

            # Both selected native owners move in one atomic history entry.
            axis = next(key for key, guide in fast['guides'].items() if guide['kind'] == 'axis' and 'xAxisTitle' in key)
            select('title')
            select(axis, shift=True)
            page.keyboard.press('ArrowLeft')
            settle()
            grouped, _ = summary()
            assert grouped['guides']['title']['along'] == fast['guides']['title']['along'] - 1
            assert grouped['guides'][axis]['along'] == fast['guides'][axis]['along'] - 1
            page.keyboard.press('Meta+z')
            ready()
            undone, _ = summary()
            assert undone['guides']['title'] == fast['guides']['title']
            page.keyboard.press('Meta+Shift+z')
            ready()
            redone, _ = summary()
            assert redone['guides']['title'] == grouped['guides']['title']

            legend = page.locator('.guide-control.legend-container').first.get_attribute('data-guide-key')
            select(legend)
            before_legend, _ = summary()
            select(legend)
            page.keyboard.press('ArrowDown')
            settle()
            moved, _ = summary()
            old_top = before_legend['guides'][legend]['bounds']['top'] - before_legend['guides'][axis]['bounds']['top']
            new_top = moved['guides'][legend]['bounds']['top'] - moved['guides'][axis]['bounds']['top']
            assert abs(new_top - old_top - 1) < .05
            assert moved['guides'][legend]['position'] == before_legend['guides'][legend]['position']
            select(legend)
            page.keyboard.down('ArrowDown')
            page.wait_for_timeout(80)
            page.keyboard.press('Escape')
            page.keyboard.up('ArrowDown')
            settle()
            cancelled, _ = summary()
            assert cancelled['guides'][legend] == moved['guides'][legend]
            assert cancelled['index'] == moved['index']

            # Search/caret navigation must not move the selected chart element.
            page.locator('#action-search').fill('legend')
            page.locator('#action-search').press('ArrowLeft')
            settle()
            protected, saved = summary()
            assert protected['guides'] == cancelled['guides']
            page.locator('#action-search').fill('')
            path = out / f'{mode}-{kind}-saved.json'
            path.write_text(json.dumps(saved))
            page.locator('#project-file').set_input_files(str(path))
            expect(page.locator('#current-note')).to_contain_text('Move', timeout=60000)
            replayed, _ = summary()
            assert replayed['guides'] == protected['guides']
            page.screenshot(path=str(out / f'{mode}-{kind}.png'))
            print(mode, kind, 'PASS: taps, 60 held repeats, Shift, group, legend, cancellation, Undo/Redo, input isolation, replay', flush=True)
    assert not errors, errors
    browser.close()
