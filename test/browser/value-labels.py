"""Value label format controls in an isolated local authenticated session."""
import argparse, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--cdp', required=True)
args = parser.parse_args()
out = Path('output/value-labels')
out.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', r'''
import {writeFileSync} from 'node:fs';
import {createProject} from './web/project.js';
import {importDataset} from './src/data-import.js';
const imported=importDataset(JSON.stringify([{g:'A',y:12.3456},{g:'B',y:23.4567},{g:'C',y:34.5678}]),{format:'json',name:'Label precision'});
const setupCalls=[{method:'createCanvas',args:{plot:{width:314,height:314},margin:170}},{method:'createData',args:{id:'dataset',values:'__LOADED_DATA__'}}];
const calls=[{method:'createBarPlot',args:{id:'plot',data:'dataset',x:'g',y:{field:'y',aggregate:'sum'}}}];
const snapshot={setupCalls,calls,guideCall:{method:'createGuides',args:{}},steps:1,phase:'recommendations',selection:{x:'g',y:'y'},currentNote:'Before labels',context:{target:'plot'},plotData:'dataset',optionGroup:'encoding'};
writeFileSync('output/value-labels/browser.json',JSON.stringify(createProject([{id:'labels',name:'Label precision',imported,session:{entries:[snapshot],index:0}}],'labels')));
'''], check=True)

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(args.cdp)
    page = browser.contexts[0].pages[0]
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.wait_for_load_state('networkidle')
    expect(page.locator('#dataset')).to_be_enabled(timeout=60000)
    for mode in ['transition', 'preview']:
        if page.locator('#current canvas').count():
            expect(page.locator('#reset')).to_be_enabled(timeout=60000)
        page.locator('#project-file').set_input_files(str(out/'browser.json'))
        expect(page.locator('#current-note')).to_have_text('Before labels', timeout=60000)
        expect(page.locator('#reset')).to_be_enabled(timeout=60000)
        page.locator(f'#view-mode [data-mode="{mode}"]').click()
        page.locator('#action-search').fill('createMarkLabels')
        card = page.locator('.card[data-method="createMarkLabels"]').first
        expect(card).to_be_visible(timeout=60000)
        card.locator('.card-top').hover(position={'x':30,'y':15})
        expect(card.get_by_role('button', name='Automatic', exact=True)).to_be_visible()
        card.get_by_role('button', name='Category', exact=True).click()
        expect(card.get_by_text('Number format', exact=True)).not_to_be_visible()
        card.get_by_role('button', name='Value', exact=True).click()
        card.get_by_role('button', name='Decimal', exact=True).click()
        slider = card.get_by_role('slider', name='Add value labels: Decimal places slider', exact=True)
        expect(slider).to_have_value('2')
        slider.focus(); slider.press('ArrowRight')
        expect(slider).to_have_value('3')
        expect(card).to_have_attribute('data-preview-state','ready',timeout=60000)
        expect(page.locator('#code-content')).to_contain_text('.3f',timeout=60000)
        expect(page.locator('#current-note')).to_have_text('Before labels')
        page.screenshot(path=str(out/f'{mode}-create.png'))
        card.locator('.apply-button').click()
        expect(page.locator('#current-note')).to_have_text('Add value labels',timeout=60000)
        expect(page.locator('#reset')).to_be_enabled(timeout=60000)
        page.locator('#action-search').fill('encodeText')
        edit = page.locator('.card[data-method="encodeText"]').first
        expect(edit).to_be_visible(timeout=60000)
        edit.locator('.card-top').hover(position={'x':30,'y':15})
        edit.get_by_role('button',name='Decimal',exact=True).click()
        slider = edit.get_by_role('slider',name='Edit value labels: Decimal places slider',exact=True)
        slider.focus(); slider.press('Home')
        for _ in range(4): slider.press('ArrowRight')
        expect(slider).to_have_value('4')
        expect(edit).to_have_attribute('data-preview-state','ready',timeout=60000)
        expect(page.locator('#code-content')).to_contain_text('.4f',timeout=60000)
        edit.locator('.apply-button').click()
        expect(page.locator('#current-note')).to_have_text('Edit value labels',timeout=60000)
        expect(page.locator('#reset')).to_be_enabled(timeout=60000)
        code = page.locator('#code-content .code-call[data-method="encodeText"]').last
        code.locator('summary').click()
        expect(code).to_contain_text('.4f')
        page.keyboard.press('Meta+z')
        expect(page.locator('#current-note')).to_have_text('Add value labels',timeout=60000)
        page.keyboard.press('Meta+Shift+z')
        expect(page.locator('#current-note')).to_have_text('Edit value labels',timeout=60000)
        page.mouse.move(0,0)
        page.locator('#current').screenshot(path=str(out/f'{mode}-result.png'))
        print(mode, 'PASS: precision, categories, preview, Apply, reformat, Undo/Redo', flush=True)
    assert not errors, errors
    browser.close()
