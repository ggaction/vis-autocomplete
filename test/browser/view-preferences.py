"""Mode/layout preferences restore together, before and after a chart is authored."""
from playwright.sync_api import sync_playwright, expect

def check(page, mode, layout):
    expect(page.locator(f'#view-mode [data-mode={mode}]')).to_have_attribute('aria-pressed', 'true')
    expect(page.locator('.workspace')).to_have_attribute('data-layout', layout)
    expect(page.locator(f'#workspace-layout [data-layout={layout}]')).to_have_attribute('aria-pressed', 'true')
    assert page.locator('.visualizations').evaluate("(e)=>e.classList.contains('transition-mode')") == (mode == 'transition')

def choose(page, mode, layout):
    page.locator(f'#view-mode [data-mode={mode}]').click()
    page.locator(f'#workspace-layout [data-layout={layout}]').click()
    check(page, mode, layout)

def reload(page, mode, layout):
    page.reload()
    page.wait_for_load_state('networkidle')
    check(page, mode, layout)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    page=browser.new_page(viewport={'width':1600,'height':1100})
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:5173/')
    page.wait_for_load_state('networkidle')
    check(page, 'transition', 'vertical')
    for phase in ['initial', 'chart']:
        if phase == 'chart':
            for field in ['Horsepower','Miles_per_Gallon','Origin']:
                page.get_by_role('button',name='Select column '+field,exact=True).click()
            card=page.locator('.card[data-method=createScatterPlot]')
            expect(card).to_be_visible(timeout=60000)
            card.locator('.card-top').hover(position={'x':30,'y':16})
            card.locator('.apply-button').click()
            expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
            expect(page.locator('.card-row').first).to_have_attribute('aria-busy','false',timeout=60000)
        for mode, layout in [('transition','horizontal'),('transition','vertical'),('preview','vertical'),('preview','horizontal')]:
            choose(page,mode,layout)
            reload(page,mode,layout)
            if phase == 'chart':
                expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
            print('PASS',phase,mode,layout,'reload',flush=True)
        # Each mode remembers its own layout, independently of the active mode.
        choose(page,'preview','vertical')
        choose(page,'transition','horizontal')
        reload(page,'transition','horizontal')
        page.locator('#view-mode [data-mode=preview]').click()
        check(page,'transition','horizontal')
        page.locator('#view-mode [data-mode=transition]').click()
        check(page,'transition','horizontal')
        if phase == 'chart':
            expect(page.locator('.card-row').first).to_have_attribute('aria-busy','false',timeout=60000)
            page.locator('.card-row .card').first.locator('.card-top').hover(position={'x':30,'y':16})
            expect(page.locator('.transition-surface canvas')).to_be_visible(timeout=60000)
    assert not errors, errors
    page.close()
    for saved in [None, 'invalid']:
        context=browser.new_context()
        context.add_init_script("localStorage.setItem('vis-autocomplete.workspace-layout', JSON.stringify({preview:'vertical',transition:'horizontal'}));" + ("localStorage.setItem('vis-autocomplete.view-mode','invalid');" if saved else ''))
        page=context.new_page()
        page.goto('http://127.0.0.1:5173/')
        page.wait_for_load_state('networkidle')
        check(page,'preview','vertical')
        context.close()
    print('PASS legacy layouts and invalid mode fallback',flush=True)
    browser.close()
