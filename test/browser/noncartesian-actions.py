"""Annotation cards in both view modes, after long arc edits and in compositions.

Start scripts/open-audit-browser.js against the local development server,
then run this file with --cdp http://127.0.0.1:9333.
No production requests or account writes are made.
"""
import argparse, json, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from saved_project import read_saved_project

parser = argparse.ArgumentParser()
parser.add_argument('--cdp', required=True)
args = parser.parse_args()
out = Path('output/noncartesian-actions')
out.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', r'''
import {readFileSync,writeFileSync} from 'node:fs';
import {createProject} from './web/project.js';
import {importDataset} from './src/data-import.js';
const original=JSON.parse(readFileSync('test/fixtures/edited-rose-annotation.json'));
// Original data were not attached. Retain all authoring calls with region data.
const rows=['Asia','Europe','Americas'].flatMap((region,i)=>Array.from({length:(i+1)*2},(_,j)=>({region,cohort:j%2?'A':'B'})));
const imported=importDataset(JSON.stringify(rows),{format:'json',name:'Region annotation'});
const c=(method,args)=>({method,args});
for(const scope of ['unit','facet','adjacent']){
 const setupCalls=original.slice(0,3),calls=scope==='unit'?original.slice(3,-1):[original[3]];
 if(scope==='facet')calls.push(c('facet',{field:'cohort',data:'dataset',columns:2,guides:{axes:'each',legend:'shared'}}));
 if(scope==='adjacent')calls.push(c('createAdjacentPlot',{id:'other',source:'plot',position:'right',plot:{action:'createRosePlot',options:{category:'region',aggregate:'count'}},share:{color:true}}));
 const guideCall=c('createGuides',scope==='adjacent'?{target:[{childPath:['plot']},{childPath:['other']}]}:{});
 const snapshot={setupCalls,calls,guideCall,steps:calls.length,phase:'recommendations',selection:{fields:['region'],color:'region'},currentNote:'Before annotation',context:{target:'plot',...(scope==='adjacent'?{childPath:['plot']}:{})},plotData:'dataset',optionGroup:'style'};
 writeFileSync(`output/noncartesian-actions/${scope}.json`,JSON.stringify(createProject([{id:`note-${scope}`,name:`Annotation ${scope}`,imported,session:{entries:[snapshot],index:0}}],`note-${scope}`)));
}
'''], check=True)

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(args.cdp)
    page = browser.contexts[0].pages[0]
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.wait_for_load_state('networkidle')
    for mode in ['transition', 'preview']:
        for scope in ['unit', 'facet', 'adjacent']:
            page.locator('#project-file').set_input_files(str(out / f'{scope}.json'))
            expect(page.locator('#current-note')).to_have_text('Before annotation', timeout=60000)
            expect(page.locator('#reset')).to_be_enabled(timeout=60000)
            page.locator(f'#view-mode [data-mode="{mode}"]').click()
            page.locator('#group-style').click()
            page.locator('#action-search').fill('annotation')
            card = page.locator('#cards .card').filter(has=page.get_by_role('heading', name='Add annotation', exact=True)).first
            expect(card).to_be_visible(timeout=60000)
            card.locator('.card-top').hover(position={'x': 30, 'y': 15})
            expect(card.locator('.apply-button')).to_be_enabled(timeout=60000)
            before = page.locator('#current').get_attribute('data-steps')
            expect(card).to_have_attribute('data-preview-state', 'ready', timeout=60000)
            # Switching modes also switches the default workspace layout; move
            # onto the settled card rather than its previous screen position.
            page.mouse.move(0, 0)
            card.locator('.card-top').hover()
            expect(card.locator('.apply-button')).to_be_visible(timeout=60000)
            note_text = card.get_by_role('textbox', name='Add annotation: Text', exact=True)
            expect(note_text).to_be_visible(timeout=60000)
            note_text.fill('Callout')
            note_text.press('Tab')
            expect(card).to_have_attribute('data-preview-state', 'ready', timeout=60000)
            expect(page.locator('#current-note')).to_have_text('Before annotation')
            page.screenshot(path=str(out / f'{mode}-{scope}-preview.png'))
            card.locator('.card-top').hover()
            card.locator('.apply-button').click()
            expect(page.locator('#current-note')).to_have_text('Add annotation', timeout=60000)
            expect(page.locator('#reset')).to_be_enabled(timeout=60000)
            page.mouse.move(0, 0)
            page.keyboard.press('Meta+z')
            expect(page.locator('#current')).to_have_attribute('data-steps', before, timeout=60000)
            page.keyboard.press('Meta+Shift+z')
            expect(page.locator('#current-note')).to_have_text('Add annotation', timeout=60000)
            saved = read_saved_project(page)
            record = next(d for d in saved['datasets'] if d['id'] == saved['activeId'])
            entry = record['session']['entries'][record['session']['index']]
            assert 'createAnnotation' in json.dumps(entry['calls'])
            assert 'Callout' in json.dumps(entry['calls'])
            saved_path = out / f'{mode}-{scope}-saved.json'
            saved_path.write_text(json.dumps(saved))
            page.locator('#project-file').set_input_files(str(saved_path))
            expect(page.locator('#current-note')).to_have_text('Add annotation', timeout=60000)
            expect(page.locator('#reset')).to_be_enabled(timeout=60000)
            page.locator('#current').screenshot(path=str(out / f'{mode}-{scope}-result.png'))
            print(mode, scope, 'PASS: card, preview, Apply, Undo/Redo, saved-project replay', flush=True)
    assert not errors, errors
    browser.close()
