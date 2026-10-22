"""Initial scale/palette hover, pin, Apply, used-queue search and restoration."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUT = Path('output/initial-scales')
OUT.mkdir(parents=True, exist_ok=True)

def source(page):
    return page.evaluate("async () => (await import('/web/code-view.js')).displayedCode(document.querySelector('#code-content'))")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    for mode in ['Preview mode', 'Transition mode']:
        page = browser.new_page(viewport={'width': 1600, 'height': 1100})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto('http://127.0.0.1:5173/')
        page.wait_for_load_state('networkidle')
        for field in ['Horsepower', 'Miles_per_Gallon', 'Origin']:
            page.get_by_role('button', name='Select column ' + field, exact=True).click()
        card = page.locator('.card[data-method=createScatterPlot]')
        expect(card).to_be_visible(timeout=60000)
        page.get_by_role('button', name=mode, exact=True).click()
        card.locator('.card-top').hover(position={'x': 40, 'y': 16})
        expect(card).to_have_attribute('data-preview-state', 'ready', timeout=60000)
        xlog = card.locator('[data-parameter=xScale] [data-value=log]')
        xlog.hover()
        expect(page.locator('#code-content')).to_contain_text('"type": "log"', timeout=30000)
        expect(xlog).to_have_attribute('aria-pressed', 'false')
        card.locator('.card-top').hover(position={'x': 40, 'y': 16})
        expect(page.locator('#code-content')).not_to_contain_text('"type": "log"', timeout=30000)
        xlog.click()
        expect(card.locator('[data-parameter=xScale] [data-value=log]')).to_have_attribute('aria-pressed', 'true')
        card.locator('[data-parameter=yScale] [data-value=sqrt]').click()
        card.get_by_label('Scatter plot: More palettes', exact=True).click()
        more = card.locator('[data-parameter=palette] [data-value=set1]')
        more.hover()
        expect(page.locator('#code-content')).to_contain_text('"palette": "set1"', timeout=30000)
        expect(more).to_have_attribute('aria-pressed', 'false')
        more.click()
        card.locator('.card-top').hover(position={'x': 40, 'y': 16})
        expect(card).to_have_attribute('data-preview-state', 'ready', timeout=30000)
        preview_code = source(page)
        assert '"type": "log"' in preview_code and '"type": "sqrt"' in preview_code
        assert '"palette": "set1"' in preview_code
        page.screenshot(path=str(OUT / (mode.split()[0].lower() + '-parameters.png')))
        card.locator('.apply-button').click()
        expect(page.locator('#current')).to_have_attribute('data-steps', '1', timeout=60000)
        page.get_by_role('heading', name='Visualization Autocomplete 1.5').hover()
        expect(page.locator('#cards .card').first).to_be_visible(timeout=60000)
        assert not page.locator('#cards .card-row').first.locator('[data-method=editXScale], [data-method=editYScale], [data-method=editColorScale]').count(), 'scale editors must follow unused actions'
        for method in ['editXScale', 'editYScale', 'editColorScale']:
            page.locator('#action-search').fill(method)
            found = page.locator('.card[data-method=' + method + ']')
            expect(found).to_be_visible(timeout=60000)
            found.locator('.card-top').hover(position={'x': 40, 'y': 16})
            expect(found.locator('.apply-button')).to_be_enabled()
            page.get_by_role('heading', name='Visualization Autocomplete 1.5').hover()
        expect(page.locator('#code-content')).to_have_attribute('data-preview-method', '', timeout=10000)
        committed = source(page)
        assert '"type": "log"' in committed and '"type": "sqrt"' in committed and '"palette": "set1"' in committed
        page.get_by_role('button', name='Undo', exact=True).click()
        expect(page.get_by_role('button', name='Select column Horsepower', exact=True)).to_be_visible(timeout=60000)
        page.get_by_role('button', name='Redo', exact=True).click()
        expect(page.locator('#current')).to_have_attribute('data-steps', '1', timeout=60000)
        page.get_by_role('heading', name='Visualization Autocomplete 1.5').hover()
        expect(page.locator('#code-content')).to_have_attribute('data-preview-method', '', timeout=10000)
        page.wait_for_function("async expected => (await import('/web/code-view.js')).displayedCode(document.querySelector('#code-content')) === expected", arg=committed, timeout=30000)
        page.reload()
        page.wait_for_load_state('networkidle')
        expect(page.locator('#current')).to_have_attribute('data-steps', '1', timeout=60000)
        page.get_by_role('heading', name='Visualization Autocomplete 1.5').hover()
        expect(page.locator('#code-content')).to_have_attribute('data-preview-method', '', timeout=10000)
        page.wait_for_function("async expected => (await import('/web/code-view.js')).displayedCode(document.querySelector('#code-content')) === expected", arg=committed, timeout=30000)
        assert not errors, errors
        print('PASS', mode, 'scale/palette hover, pin, Apply, search, Undo/Redo, reload', flush=True)
        page.close()
    browser.close()
