"""Guide scope switches in an isolated authenticated local browser.

Use scripts/audit-browser-session-2026-10-25.mjs to open the mock session
with a CDP port, then run with --cdp http://127.0.0.1:9333.
"""
import argparse
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--cdp', required=True)
args = parser.parse_args()
out = Path('output/guide-toggle-scopes')
out.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', r'''
import {writeFileSync} from 'node:fs';
import {createProject} from './web/project.js';
import {importDataset} from './src/data-import.js';
const c=(method,args)=>({method,args});
const imported=importDataset(JSON.stringify(Array.from({length:18},(_,i)=>({x:i+1,y:i%4+2,g:i%2?'B':'A'}))),{format:'json',name:'Guide scopes'});
for(const kind of ['scatter','polar','parallel']) {
 const setupCalls=[c('createCanvas',{plot:{width:314,height:314},margin:180}),c('createData',{id:'dataset',values:'__LOADED_DATA__'})];
 const call=kind==='scatter'?c('createScatterPlot',{id:'plot',data:'dataset',x:'x',y:'y',color:'g'}):
   kind==='polar'?c('createPolarScatterPlot',{id:'plot',data:'dataset',theta:'x',radius:'y',color:'g'}):
   c('createParallelCoordinates',{id:'plot',data:'dataset',dimensions:['x','y',{field:'g',fieldType:'ordinal'}],color:'g'});
 const guideArgs=kind==='parallel'?{}:{legend:{target:'plot',channels:['color']}};
 const snapshot={setupCalls,calls:[call],guideCall:c('createGuides',guideArgs),steps:1,phase:'recommendations',selection:{x:'x',y:'y',color:'g'},currentNote:kind,context:{target:'plot'},plotData:'dataset',optionGroup:'style'};
 writeFileSync(`output/guide-toggle-scopes/${kind}.json`,JSON.stringify(createProject([{id:`guide-${kind}`,name:'Guide scopes',imported,session:{entries:[snapshot],index:0}}],`guide-${kind}`)));
}
'''], check=True)

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(args.cdp)
    page = browser.contexts[0].pages[0]
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.wait_for_load_state('networkidle')
    expect(page.locator('#dataset')).to_be_enabled(timeout=60000)
    print('Workspace:', page.title(), flush=True)

    def ready():
        expect(page.locator('#reset')).to_be_enabled(timeout=60000)

    def find_card(method):
        page.locator('#action-search').fill(method)
        page.locator('#action-search').press('Enter')
        expect(page.locator('#cards')).to_have_attribute('data-search-query',method.lower())
        for _ in range(30):
            page.wait_for_function('''()=>{
              const n=Number(document.querySelector('#cards-page').textContent.split('/')[0]);
              return document.querySelector(`.card-row[data-page="${n}"][aria-busy="false"]`);
            }''',timeout=60000)
            card = page.locator(f'#cards .card[data-method="{method}"]').first
            if card.count():
                card.scroll_into_view_if_needed()
                card.locator('.card-top').hover()
                expect(card.locator('.parameter-toggle').first).to_be_visible()
                return card
            assert page.locator('#cards-next').is_enabled(), method
            before = page.locator('#cards-page').inner_text()
            page.locator('#cards-next').click()
            expect(page.locator('#cards-page')).not_to_have_text(before)
        raise AssertionError(f'Card unavailable: {method}')

    def check_owners(card):
        owners = card.locator('.parameter-toggle').evaluate_all('''buttons=>buttons.map(b=>{
          const owner=b.closest('.control'), heading=owner.querySelector(':scope > span').cloneNode(true);
          heading.querySelector('.parameter-toggles').remove();
          return {key:b.dataset.parameter, label:heading.textContent.trim(), numeric:owner.classList.contains('slider-control')};
        })''')
        assert len({x['key'] for x in owners}) == len(owners), owners
        assert not any(x['numeric'] or x['key']=='lineVisible' for x in owners), owners
        labels = {'labelsVisible':'Labels','ticksVisible':'Ticks'}
        for owner in owners:
            if owner['key'] in labels:
                assert owner['label'] == labels[owner['key']], owners
            else:
                assert owner['label'] in ['Axes','Legend','Grid','Title','Titles'], owners
        return owners

    cases = {
        'scatter':['editAxes','editXAxis','editYAxis','editLegend','editHorizontalGrid'],
        'polar':['editThetaAxis','editRadialAxis'],
        'parallel':['editParallelAxis'],
    }
    for mode in ['transition','preview']:
        page.locator(f'#view-mode [data-mode="{mode}"]').click()
        for kind, methods in cases.items():
            page.locator('#project-file').set_input_files(str(out / f'{kind}.json'))
            expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
            ready()
            page.locator('#group-style').click()
            for method in methods:
                card = find_card(method)
                owners = check_owners(card)
                numeric = card.locator('.slider-control input[type="range"]').first
                if numeric.count():
                    # Keyboard input exercises the same parameter update pipeline
                    # without relying on the hover-intent timer.
                    numeric.focus()
                    numeric.press('ArrowRight')
                    numeric.press('ArrowRight')
                    assert check_owners(card) == owners
                if method == 'editXAxis':
                    card.locator('.card-top').hover()
                    toggle = card.locator('.parameter-toggle[data-parameter="guideVisible"]')
                    toggle.click()
                    expect(toggle).to_have_attribute('aria-checked','false')
                    card.locator('.apply-button').click()
                    expect(page.locator('#current')).to_have_attribute('data-steps','2',timeout=60000)
                    ready()
                    card = find_card(method)
                    expect(card.locator('.parameter-toggle[data-parameter="guideVisible"]')).to_have_attribute('aria-checked','false')
                    page.locator('#undo').click()
                    expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
                    ready()
                    # Undo restores the chart; cached cards intentionally retain
                    # the user's draft choices for a possible re-apply.
                    page.locator('#options-heading').hover()
                    expect(page.locator('#code-content')).not_to_contain_text('editXAxis')
                    card = find_card(method)
                card.locator('.card-top').hover()
                card.screenshot(path=str(out / f'{mode}-{method}.png'))
                print('PASS',mode,kind,method,owners,flush=True)
    assert not errors, errors
