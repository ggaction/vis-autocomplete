"""Short gap crossings retain hover; sustained empty-space visits release it."""
import re
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    page=browser.new_page(viewport={'width':1600,'height':1100},device_scale_factor=2)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:5173/')
    page.wait_for_load_state('networkidle')
    for field in ['Horsepower','Miles_per_Gallon','Origin']:
        page.get_by_role('button',name='Select column '+field,exact=True).click()
    card=page.locator('.card[data-method=createScatterPlot]')
    expect(card).to_be_visible(timeout=60000)
    card.locator('.card-top').hover(position={'x':30,'y':16})
    card.locator('.apply-button').click()
    expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
    expect(page.locator('.card-row').first).to_have_attribute('aria-busy','false',timeout=60000)

    def hover(card):
        card.locator('.card-top').hover(position={'x':30,'y':16})
        expect(card).to_have_class(re.compile(r'\bexpanded\b'))
        expect(card).to_have_attribute('data-preview-state','ready',timeout=60000)
        page.wait_for_timeout(350)

    def leave_at(x,y):
        assert page.evaluate('([x,y])=>!document.elementFromPoint(x,y).closest(".card")',[x,y])
        page.mouse.move(x,y)
        expect(page.locator('.card.expanded')).to_have_count(0)
        expect(page.locator('#code-content')).to_have_attribute('data-preview-method','',timeout=10000)
        expect(page.locator('#preview canvas')).to_have_count(0)
        expect(page.locator('.transition-surface')).to_have_count(0,timeout=10000)
        # A still pointer must not reopen cards when the layout shrinks under it.
        page.wait_for_timeout(450)
        expect(page.locator('.card.expanded')).to_have_count(0)
        expect(page.locator('#current')).to_have_attribute('data-steps','1')

    for width in [1440,2560]:
        page.set_viewport_size({'width':width,'height':1100})
        for mode in ['preview','transition']:
            page.locator(f'#view-mode [data-mode={mode}]').click()
            for layout in ['horizontal','vertical']:
                page.locator(f'#workspace-layout [data-layout={layout}]').click()
                cards=page.locator('.card-row').first.locator('.card')
                hover(cards.first)
                a,b=cards.nth(0).bounding_box(),cards.nth(1).bounding_box()
                gap_x=(a['x']+a['width']+b['x'])/2
                page.mouse.move(gap_x,a['y']+24)
                page.wait_for_timeout(60)
                expect(cards.first).to_have_class(re.compile(r'\bexpanded\b'))
                page.mouse.move(b['x']+30,b['y']+24)
                page.wait_for_timeout(250)
                expect(cards.nth(1)).to_have_class(re.compile(r'\bexpanded\b'))
                # A fresh visit that stops in the gap must eventually collapse.
                a,b=cards.nth(0).bounding_box(),cards.nth(1).bounding_box()
                leave_at((a['x']+a['width']+b['x'])/2,a['y']+24)
                hover(cards.nth(1))
                # Blank bottom portion of the first card's slot, inside #cards.
                a=cards.first.bounding_box()
                row=page.locator('.card-row').first.bounding_box()
                y=a['y']+a['height']+15
                assert y<row['y']+row['height']
                leave_at(a['x']+a['width']/2,y)
                print('PASS',width,mode,layout,'gaps, empty space, no stationary reopen',flush=True)
    page.locator('#action-search').fill('encodeStroke')
    expect(page.locator('#cards')).to_have_attribute('data-search-query','encodestroke',timeout=60000)
    expect(page.locator('.card-row').first).to_have_attribute('aria-busy','false',timeout=60000)
    card=page.locator('.card[data-method=encodeStroke]')
    hover(card)
    choice=card.locator('[data-parameter=mode] [data-value=fixed]')
    choice.click()
    pinned=choice.get_attribute('data-value')
    slot=page.locator('.card-space').first.bounding_box()
    leave_at(slot['x']+slot['width']/2,slot['y']+24)
    hover(card)
    expect(card.locator('[data-parameter=mode] [data-value="'+pinned+'"]')).to_have_attribute('aria-pressed','true')
    assert not errors,errors
    print('PASS empty search slots release hover and keep pinned parameters',flush=True)
    browser.close()
