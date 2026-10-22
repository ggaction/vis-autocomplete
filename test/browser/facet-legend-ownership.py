"""Facet partition hover/selection keeps one shared legend in both view modes."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUT = Path('output/facet-legend')
OUT.mkdir(parents=True, exist_ok=True)

def code(page):
    return page.evaluate("async () => (await import('/web/code-view.js')).displayedCode(document.querySelector('#code-content'))")

def shared(page):
    text = code(page)
    assert '"legend": "shared"' in text, text
    assert '"independent"' not in text, text

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
        page.get_by_role('button', name=mode, exact=True).click()
        card = page.locator('.card[data-method=createScatterPlot]')
        expect(card).to_be_visible(timeout=60000)
        card.locator('.card-top').hover(position={'x': 40, 'y': 16})
        card.locator('.apply-button').click()
        expect(page.locator('#current')).to_have_attribute('data-steps', '1', timeout=60000)
        page.locator('#action-search').fill('facet')
        expect(page.locator('#cards')).to_have_attribute('data-search-query', 'facet', timeout=60000)
        expect(page.locator('.card-row').first).to_have_attribute('aria-busy', 'false', timeout=60000)
        card = page.locator('.card[data-method=facet]')
        expect(card).to_be_visible(timeout=60000)
        card.locator('.card-top').hover(position={'x': 40, 'y': 16})
        for field in ['Cylinders', 'Origin']:
            card.locator('.card-top').hover(position={'x': 40, 'y': 16})
            expect(card).to_have_attribute('data-preview-state', 'ready', timeout=60000)
            page.wait_for_timeout(400)
            option = card.locator(f'[data-parameter=field] [data-value="{field}"]')
            option.hover()
            expect(card).to_have_attribute('data-preview-state', 'ready', timeout=60000)
            expect(page.locator('#code-content')).to_contain_text(f'"field": "{field}"')
            shared(page)
            option.click()
            card.locator('.card-top').hover(position={'x': 40, 'y': 16})
            expect(card).to_have_attribute('data-preview-state', 'ready', timeout=60000)
            shared(page)
        card.locator('.apply-button').click()
        expect(page.locator('#current')).to_have_attribute('data-steps', '2', timeout=60000)
        page.mouse.move(1, 1)
        expect(page.locator('#code-content')).to_have_attribute('data-preview-method', '', timeout=30000)
        shared(page)
        page.screenshot(path=str(OUT / (mode.split()[0].lower() + '.png')))
        page.locator('#undo').click()
        expect(page.locator('#current')).to_have_attribute('data-steps', '1', timeout=60000)
        page.locator('#redo').click()
        expect(page.locator('#current')).to_have_attribute('data-steps', '2', timeout=60000)
        shared(page)
        page.reload()
        page.wait_for_load_state('networkidle')
        expect(page.locator('#current')).to_have_attribute('data-steps', '2', timeout=60000)
        shared(page)
        assert not errors, errors
        print('PASS', mode, 'partition hover, pin, Apply, Undo/Redo, reload', flush=True)
        page.close()
    browser.close()
