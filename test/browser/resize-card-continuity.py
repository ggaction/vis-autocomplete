"""Preserve page/search/parameters and rebase Apply after direct manipulation."""
import re
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    page=browser.new_page(viewport={'width':1600,'height':1100})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.add_init_script('''{
      const W=window.Worker; window.rankRequests=0;
      window.Worker=class extends W {postMessage(m,...args){if(m?.request?.type==='recommend') rankRequests++; super.postMessage(m,...args);}};
    }''')
    page.goto('http://127.0.0.1:5173/'); page.wait_for_load_state('networkidle')
    for field in ['Horsepower','Miles_per_Gallon']:
        page.get_by_role('button',name='Select column '+field,exact=True).click()
    card=page.locator('.card[data-method=createScatterPlot]')
    expect(card).to_be_visible(timeout=60000)
    card.locator('.card-top').hover();card.locator('.apply-button').click()
    expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
    expect(page.locator('.card-row[data-page="1"]')).to_have_attribute('aria-busy','false',timeout=60000)

    def resize(steps):
        page.evaluate('window.beforeNodes=[...document.querySelectorAll("#cards .card")];window.beforeRank=rankRequests')
        handle=page.locator('[data-resize="plot-s"]');handle.hover();b=handle.bounding_box()
        x,y=b['x']+b['width']/2,b['y']+b['height']/2
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x,y+18,steps=8)
        expect(page.locator('#code-mode')).to_have_text('Resize chart',timeout=30000)
        page.mouse.up()
        expect(page.locator('#current')).to_have_attribute('data-steps',str(steps+1),timeout=60000)
        expect(page.locator('#current')).not_to_have_class(re.compile('.*resizing.*'),timeout=60000)
        assert page.evaluate('beforeNodes.every(n=>n.isConnected)')
        assert page.evaluate('rankRequests===beforeRank'),'Size-only edits must not rerank the gallery'

    # Lazily loaded pages must still work after rebasing; resize page 2 in place.
    resize(1)
    page.locator('#cards-next').click()
    expect(page.locator('.card-row[data-page="2"]')).to_have_attribute('aria-busy','false',timeout=60000)
    assert page.locator('.card-row[data-page="2"] .card').count()>0
    page2=page.locator('#cards-page').inner_text()
    resize(2)
    expect(page.locator('#cards-page')).to_have_text(page2)
    page.locator('#cards-prev').click()
    expect(page.locator('#cards-page')).to_have_text(re.compile('^1 /'))
    page.locator('#group-style').click();page.locator('#action-search').fill('createTitle')
    card=page.locator('.card[data-method=createTitle]')
    expect(card).to_be_visible(timeout=60000)
    card.locator('.card-top').hover()
    slider=card.locator('[data-parameter="size"] input')
    slider.press('End'); slider.press('ArrowLeft')
    expect(slider).to_have_value('29')
    expect(card).to_have_attribute('data-preview-state','ready',timeout=30000)
    resize(3)
    expect(page.locator('#action-search')).to_have_value('createTitle')
    expect(slider).to_have_value('29')
    native=page.locator('#current .plot-boundary .resize-label').inner_text()
    card.locator('.card-top').hover()
    expect(card).to_have_attribute('data-preview-state','ready',timeout=30000)
    card.locator('.apply-button').click()
    expect(page.locator('#current')).to_have_attribute('data-steps','5',timeout=60000)
    expect(page.locator('#current')).to_have_attribute('data-last-method','createTitle')
    expect(page.locator('#current .plot-boundary .resize-label')).to_have_text(native)
    assert page.locator('#current svg text[font-size="29"]').count()>0
    page.locator('#undo').click()
    expect(page.locator('#current')).to_have_attribute('data-steps','4',timeout=60000)
    assert not errors,errors
    print('PASS no reranking, lazy pages, page/search/pinned parameter preservation, rebased Apply and Undo')
    browser.close()
