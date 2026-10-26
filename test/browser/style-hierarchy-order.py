"""Style families rotate together after Apply, through real UI pagination.

Start a local server and an isolated mock session using
scripts/audit-browser-session-2026-10-25.mjs, with Chromium CDP enabled.
Run: python test/browser/style-hierarchy-order.py --cdp http://127.0.0.1:9333
"""
import argparse, re, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--cdp', required=True)
args = parser.parse_args()
out = Path('output/style-hierarchy-order')
out.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', r'''
import {writeFileSync} from 'node:fs';
import {createProject} from './web/project.js';
import {importDataset} from './src/data-import.js';
import {defaultCanvasOptions} from './src/prepare.js';
const c=(method,args)=>({method,args});
const imported=importDataset(JSON.stringify(Array.from({length:12},(_,i)=>({X:i+1,Y:i%4+2,G:i%2?'A':'B'}))),{format:'json',name:'Style order'});
const snapshot={setupCalls:[c('createCanvas',defaultCanvasOptions()),c('createData',{id:'dataset',values:'__LOADED_DATA__'})],
 calls:[c('createScatterPlot',{id:'plot',data:'dataset',x:'X',y:'Y',color:'G'})],
 guideCall:c('createGuides',{}),steps:1,phase:'recommendations',selection:{x:'X',y:'Y',color:'G'},
 currentNote:'Before axes',context:{target:'plot'},plotData:'dataset',optionGroup:'style'};
writeFileSync('output/style-hierarchy-order/project.json',JSON.stringify(createProject([{id:'style-order',name:'Style order',imported,session:{entries:[snapshot],index:0}}],'style-order')));
'''], check=True)

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(args.cdp)
    page = browser.contexts[0].pages[0]
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.wait_for_load_state('networkidle')
    expect(page.locator('#dataset')).to_be_enabled(timeout=60000)

    def settled():
        number = int(page.locator('#cards-page').inner_text().split('/')[0])
        row = page.locator(f'.card-row[data-page="{number}"]')
        expect(row).to_have_attribute('aria-busy', 'false', timeout=60000)
        return row

    def tail():
        page.locator('#action-search').fill('')
        expect(page.locator('#cards')).to_have_attribute('data-search-query', '', timeout=60000)
        for _ in range(30):
            row = settled()
            if page.locator('#cards-next').is_disabled():
                break
            assert row.locator('.card').count() == 5, 'Only the last page may be partial'
            number = int(page.locator('#cards-page').inner_text().split('/')[0])
            page.locator('#cards-next').click()
            expect(page.locator('#cards-page')).to_have_text(re.compile(rf'^{number + 1} /'), timeout=60000)
        else:
            raise AssertionError('Pagination did not finish')
        methods = page.locator('.card-row .card').evaluate_all('cards => cards.map(c => c.dataset.method)')
        assert methods[-1] == 'editAxes', methods
        assert set(methods[-3:-1]) == {'editXAxis', 'editYAxis'}, methods
        assert len(methods) == len(set(methods)), methods
        return methods

    for mode in ['transition', 'preview']:
        page.locator('#project-file').set_input_files(str(out / 'project.json'))
        expect(page.locator('#current')).to_have_attribute('data-steps', '1', timeout=60000)
        expect(page.locator('#reset')).to_be_enabled(timeout=60000)
        page.locator(f'#view-mode [data-mode="{mode}"]').click()
        page.locator('#group-style').click()
        page.locator('#action-search').fill('editAxes')
        expect(page.locator('#cards')).to_have_attribute('data-search-query', 'editaxes', timeout=60000)
        settled()
        card = page.locator('.card[data-method="editAxes"]')
        card.locator('.card-top').hover()
        expect(card.locator('.apply-button')).to_be_enabled(timeout=60000)
        expect(page.locator('#current')).to_have_attribute('data-steps', '1')
        card.locator('.apply-button').click()
        expect(page.locator('#current')).to_have_attribute('data-steps', '2', timeout=60000)
        methods = tail()
        page.locator('#cards').screenshot(path=str(out / f'{mode}-tail.png'))
        page.locator('#undo').click()
        expect(page.locator('#current')).to_have_attribute('data-steps', '1', timeout=60000)
        settled()
        assert 'editAxes' in page.locator('.card-row').first.locator('.card').evaluate_all('cards => cards.map(c => c.dataset.method)')
        page.locator('#redo').click()
        expect(page.locator('#current')).to_have_attribute('data-steps', '2', timeout=60000)
        assert tail() == methods
        print('PASS', mode, 'new actions → X/Y axes → Axes; pagination, hover, Undo/Redo', flush=True)
    assert not errors, errors
