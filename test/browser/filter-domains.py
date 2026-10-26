"""Threshold cards fit binned chart domains in both display modes.

Start scripts/open-audit-browser.js against a local development server, then
pass --cdp. Generated projects/screenshots remain under ignored output/.
"""
import argparse
import json
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from saved_project import read_saved_project

parser = argparse.ArgumentParser()
parser.add_argument('--cdp', required=True)
args = parser.parse_args()
out = Path('output/filter-domains')
out.mkdir(parents=True, exist_ok=True)

subprocess.run(['node', '--input-type=module', '-e', r'''
import {writeFileSync} from 'node:fs';
import {createProject} from './web/project.js';
import {importDataset} from './src/data-import.js';
const rows=[2,12,22,32,42].flatMap((x,i)=>['A','B'].map(group=>({x,y:50-i*10,group})));
const imported=importDataset(JSON.stringify(rows),{format:'json',name:'Threshold bins'});
const c=(method,args)=>({method,args});
for (const scope of ['bar','histogram','facet']) {
 const setupCalls=[c('createCanvas',{plot:{width:314,height:314},margin:80}),c('createData',{id:'dataset',values:'__LOADED_DATA__'})];
 const calls=[scope==='histogram'?c('createHistogram',{id:'plot',data:'dataset',field:'x',binBoundaries:[0,10,20,30,40,50]}):c('createBarPlot',{id:'plot',data:'dataset',x:{field:'x',bin:{boundaries:[0,10,20,30,40,50]}},y:{field:'y',aggregate:'sum'}})];
 if(scope==='facet')calls.push(c('facet',{field:'group',data:'dataset',columns:2,guides:{axes:'each',legend:false}}));
 const snapshot={setupCalls,calls,guideCall:c('createGuides',{}),steps:calls.length,phase:'recommendations',selection:{fields:['x','y']},currentNote:'Before threshold',context:{target:'plot'},plotData:'dataset',optionGroup:'transform'};
 writeFileSync(`output/filter-domains/${scope}.json`,JSON.stringify(createProject([{id:`threshold-${scope}`,name:`Threshold ${scope}`,imported,session:{entries:[snapshot],index:0}}],`threshold-${scope}`)));
}
'''], check=True)

CHECK_SAVED = r'''
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {restoreSession} from './web/project.js';
const project=JSON.parse(readFileSync(process.argv[1]));
const d=project.datasets.find(d=>d.id===project.activeId), session=restoreSession(d.session,d.imported.rows);
const entry=session.entries[session.index], p=entry.view;
const children=p.compositionSpec ? Object.values(p.children) : [p];
for(const child of children){
 assert.deepEqual(child.resolvedScales.x.domain,[30,50]);
 assert.equal(child.graphicSpec.objects.plot.items.length,2);
 assert.ok(child.guideConfigs.axis.x.ticks.values.every(v=>v>=30&&v<=50));
}
assert.match(JSON.stringify(entry.calls),/filterMarks/);
console.log('Saved native replay: fitted domain, two complete bins, fitted ticks');
'''

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(args.cdp)
    page = browser.contexts[0].pages[0]
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.wait_for_load_state('networkidle')
    for mode in ['transition', 'preview']:
        for scope in ['bar', 'histogram', 'facet']:
            page.locator('#project-file').set_input_files(str(out / f'{scope}.json'))
            expect(page.locator('#current-note')).to_have_text('Before threshold', timeout=60000)
            expect(page.locator('#reset')).to_be_enabled(timeout=60000)
            page.locator(f'#view-mode [data-mode="{mode}"]').click()
            page.locator('#group-transform').click()
            page.locator('#action-search').fill('filter values')
            card = page.locator('#cards .card').filter(has=page.get_by_role('heading', name='Filter values', exact=True)).first
            expect(card).to_be_visible(timeout=60000)
            expect(card).to_have_attribute('data-preview-state', 'ready', timeout=60000)
            page.mouse.move(0, 0)
            card.locator('.card-top').hover()
            # Card expansion moves its contents; settle before moving to the
            # slider so the pointer doesn't cross a transient empty card gap.
            page.wait_for_timeout(500)
            card.locator('.card-top').hover()
            slider = card.get_by_role('slider', name='Filter values: Threshold slider', exact=True)
            expect(slider).to_be_visible(timeout=60000)
            # Keyboard interaction pins a precise threshold, with no synthetic
            # state mutation or direct access to the application's internals.
            slider.hover()
            slider.press('Home')
            for _ in range(7):
                slider.press('PageUp')
            for _ in range(5):
                slider.press('ArrowRight')
            expect(slider).to_have_value('30')
            expect(card).to_have_attribute('data-preview-state', 'ready', timeout=60000)
            expect(page.locator('#current-note')).to_have_text('Before threshold')
            page.screenshot(path=str(out / f'{mode}-{scope}-preview.png'))
            before = page.locator('#current').get_attribute('data-steps')
            card.locator('.apply-button').click()
            expect(page.locator('#current-note')).to_have_text('Filter values', timeout=60000)
            expect(page.locator('#reset')).to_be_enabled(timeout=60000)
            page.mouse.move(0, 0)
            page.keyboard.press('Meta+z')
            expect(page.locator('#current')).to_have_attribute('data-steps', before, timeout=60000)
            page.keyboard.press('Meta+Shift+z')
            expect(page.locator('#current-note')).to_have_text('Filter values', timeout=60000)
            saved = read_saved_project(page)
            path = out / f'{mode}-{scope}-saved.json'
            path.write_text(json.dumps(saved))
            subprocess.run(['node', '--input-type=module', '-e', CHECK_SAVED, str(path)], check=True)
            page.locator('#project-file').set_input_files(str(path))
            expect(page.locator('#current-note')).to_have_text('Filter values', timeout=60000)
            expect(page.locator('#reset')).to_be_enabled(timeout=60000)
            page.mouse.move(0, 0)
            page.locator('#current').screenshot(path=str(out / f'{mode}-{scope}-result.png'))
            print(mode, scope, 'PASS: threshold preview, Apply, Undo/Redo, saved replay', flush=True)
    assert not errors, errors
    browser.close()
