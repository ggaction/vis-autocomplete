"""Code proposals follow card hover; panel entry cannot revive stale proposals."""
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    for mode in ['preview', 'transition']:
        page = browser.new_page(viewport={'width':1800,'height':1200})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto('http://127.0.0.1:5173/')
        page.wait_for_load_state('networkidle')
        for field in ['Horsepower','Miles_per_Gallon','Origin']:
            page.get_by_role('button', name='Select column '+field, exact=True).click()
        page.locator(f'#view-mode [data-mode={mode}]').click()
        code = page.locator('#code-content')
        panel = page.locator('.code-panel')
        def hover(card):
            card.locator('.card-top').hover(position={'x':30,'y':16})
            expect(card).to_have_attribute('data-preview-state','ready',timeout=60000)
            expect(code).to_have_attribute('data-preview-method',card.get_attribute('data-method'))
            expect(code.locator('.code-call[data-change=added]').first).to_have_attribute('open','')
        def cleared():
            expect(code).to_have_attribute('data-preview-method','')
            expect(code.locator('.code-call[data-change=added]')).to_have_count(0)
            expect(page.locator('#code-mode')).to_have_text('Current')
        scatter = page.locator('.card[data-method=createScatterPlot]')
        expect(scatter).to_be_visible(timeout=60000)
        hover(scatter)
        panel.hover(position={'x':30,'y':20})
        cleared()
        hover(scatter)
        scatter.locator('.apply-button').click()
        applied = code.locator('.code-call[data-method=createScatterPlot]')
        expect(applied).to_have_attribute('data-settling','holding',timeout=60000)
        expect(applied).to_have_attribute('open','')
        expect(applied).not_to_have_attribute('open','',timeout=10000)
        expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
        # An explicitly opened committed call must survive transient previews.
        applied.locator('summary').click()
        expect(applied).to_have_attribute('open','')
        page.locator('#action-search').fill('encodeStroke')
        expect(page.locator('#cards')).to_have_attribute('data-search-query','encodestroke',timeout=60000)
        card = page.locator('.card[data-method=encodeStroke]')
        expect(card).to_be_visible(timeout=60000)
        hover(card)
        panel.hover(position={'x':30,'y':20})
        cleared()
        expect(applied).to_have_attribute('open','')
        hover(card)
        page.locator('#action-search').hover()
        cleared()
        panel.hover(position={'x':30,'y':20})
        page.locator('#code-content summary').first.focus()
        cleared()
        assert not errors, errors
        print('PASS',mode,'initial/action hover exit, code panel re-entry/focus, manual disclosure and Apply settlement',flush=True)
        page.close()
    browser.close()
