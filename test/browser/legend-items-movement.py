"""Pointer regression in an isolated authenticated browser.

Start a local server and the mock session from
scripts/audit-browser-session-2026-10-25.mjs with Chromium's CDP port enabled.
Run: python test/browser/legend-items-movement.py --cdp http://127.0.0.1:9333
The mock account makes no external account writes.
"""
import argparse
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--cdp', required=True)
args = parser.parse_args()
out = Path('output/legend-items-movement')
out.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', r'''
import { writeFileSync } from 'node:fs';
import { createProject } from './web/project.js';
import { importDataset } from './src/data-import.js';
const c=(method,args)=>({method,args});
const imported=importDataset(JSON.stringify(Array.from({length:18},(_,i)=>({x:i+1,y:i*2+5,g:['A','B','C'][i%3]}))),{format:'json',name:'Legend items'});
for(const kind of ['unit','facet']) {
 const setupCalls=[c('createCanvas',{plot:{width:314,height:314},margin:180}),c('createData',{id:'dataset',values:'__LOADED_DATA__'})];
 const calls=[c('createScatterPlot',{id:'plot',data:'dataset',x:'x',y:'y',color:{field:'g',fieldType:'nominal'}}),c('encodeSize',{target:'plot',field:'x'})];
 if(kind==='facet')calls.push(c('facet',{field:'g',columns:3,guides:{axes:'outer',legend:'shared'}}));
 const snapshot={setupCalls,calls,guideCall:c('createGuides',{}),steps:calls.length,phase:'recommendations',selection:{x:'x',y:'y',color:'g'},currentNote:'Legend items',context:{target:'plot'},plotData:'dataset',optionGroup:'encoding'};
 writeFileSync(`output/legend-items-movement/pointer-${kind}.json`,JSON.stringify(createProject([{id:`legend-items-${kind}`,name:'Legend items',imported,session:{entries:[snapshot],index:0}}],`legend-items-${kind}`)));
}
'''], check=True)

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(args.cdp)
    page = browser.contexts[0].pages[0]
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def ready():
        expect(page.locator('#reset')).to_be_enabled(timeout=60000)
        page.wait_for_function('!document.querySelector("#current").classList.contains("editing-guide")')

    def bounds():
        return page.locator('#current .guide-control').evaluate_all('''ns=>Object.fromEntries(ns
          .filter(n=>n.dataset.guideKey.includes('legend'))
          .map(n=>[n.dataset.guideKey,n.getBoundingClientRect().toJSON()]))''')

    def check(original, current, dx, dy):
        for channel in ['color', 'size']:
            for suffix, delta in [(f'legend-title:{channel}', (0, 0)), (f'legend:{channel}:items', (dx, dy))]:
                for axis, expected in zip(['x', 'y'], delta):
                    assert abs(current[suffix][axis] - original[suffix][axis] - expected) < .3, (suffix, axis, expected)

    def drag(dx, dy):
        hit = page.locator('#current .guide-hit[data-guide="legend:color:items"]')
        r = hit.bounding_box()
        x, y = r['x'] + r['width']/2, r['y'] + r['height']/2
        page.mouse.move(x, y)
        # A neighboring legend's resize handle must not steal the body hit.
        assert page.evaluate('''([x,y])=>document.elementFromPoint(x,y).dataset.guide''', [x,y]) == 'legend:color:items'
        page.mouse.down()
        page.mouse.move(x+dx, y+dy, steps=8)
        page.mouse.up()
        ready()

    page.reload()
    page.wait_for_load_state('networkidle')
    ready()
    for mode in ['preview', 'transition']:
        page.locator(f'#view-mode [data-mode="{mode}"]').click()
        for kind, steps in [('unit', 2), ('facet', 3)]:
            ready()
            page.locator('#project-file').set_input_files(str(out / f'pointer-{kind}.json'))
            expect(page.locator('#current')).to_have_attribute('data-steps', str(steps), timeout=60000)
            ready()
            for channel in ['color', 'size']:
                page.locator(f'#current .guide-hit[data-guide="legend:{channel}:items"]').click(modifiers=['Shift'] if channel=='size' else [])
            expect(page.locator('#current .guide-control.selected')).to_have_count(2)
            original = bounds()
            drag(16, 6)
            expect(page.locator('#current')).to_have_attribute('data-steps', str(steps+1), timeout=60000)
            check(original, bounds(), 16, 6)
            drag(8, 4)
            expect(page.locator('#current')).to_have_attribute('data-steps', str(steps+1))
            check(original, bounds(), 24, 10)
            page.keyboard.press('Control+z')
            expect(page.locator('#current')).to_have_attribute('data-steps', str(steps), timeout=60000)
            ready()
            check(original, bounds(), 0, 0)
            page.keyboard.press('Control+Shift+z')
            expect(page.locator('#current')).to_have_attribute('data-steps', str(steps+1), timeout=60000)
            ready()
            check(original, bounds(), 24, 10)
            page.screenshot(path=str(out / f'pointer-{mode}-{kind}.png'))
            print('PASS', mode, kind, 'Shift drag, coalescing, Undo/Redo', flush=True)
    expect(page.locator('#cloud-status')).to_have_text('Saved', timeout=60000)
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(page.locator('#current')).to_have_attribute('data-steps', str(steps+1), timeout=60000)
    ready()
    check(original, bounds(), 24, 10)
    print('PASS saved facet item offsets after reload', flush=True)
    assert not errors, errors
