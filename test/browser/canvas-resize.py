"""Native canvas/plot direct manipulation and hover-only option previews."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    page = browser.new_page(viewport={'width':1600,'height':1100})
    errors=[]
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:5173/')
    page.wait_for_load_state('networkidle')
    for field in ['Horsepower','Miles_per_Gallon']:
        page.get_by_role('button',name='Select column '+field,exact=True).click()
    card=page.locator('.card[data-method=createScatterPlot]')
    expect(card).to_be_visible(timeout=60000)
    expect(page.locator('#preview svg')).to_have_count(0)
    card.locator('.card-top').hover()
    expect(page.locator('#preview svg')).to_have_count(1,timeout=30000)
    page.locator('h1').hover()
    expect(page.locator('#preview svg')).to_have_count(0)
    page.wait_for_timeout(500)
    expect(page.locator('#preview svg')).to_have_count(0)
    card.locator('.card-top').hover()
    card.locator('.apply-button').click()
    expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
    page.locator('h1').hover()
    expect(page.locator('#preview svg')).to_have_count(0)
    expect(page.locator('#current .canvas-stage')).to_have_count(1)

    def geometry():
        return page.locator('#current').evaluate('''e=>{
            const svg=e.querySelector('svg'),plot=e.querySelector('.plot-boundary'),canvas=e.querySelector('.canvas-boundary');
            const native=svg.getAttribute('viewBox').split(' ').map(Number),r=canvas.getBoundingClientRect();
            return {box:svg.getAttribute('viewBox'),native,scale:r.width/native[2],host:e.getBoundingClientRect().toJSON(),
              client:[e.clientWidth,e.clientHeight],scroll:[e.scrollWidth,e.scrollHeight],
              plot:plot.getBoundingClientRect().toJSON(),canvas:r.toJSON(),label:plot.textContent,
              lengths:plot.textContent.match(/[0-9]+/g).map(Number)};
        }''')

    def assert_fit():
        g=geometry(); r=g['canvas']; h=g['host']
        assert abs(r['x']+r['width']/2-h['x']-h['width']/2)<1,g
        assert abs(r['y']+r['height']/2-h['y']-h['height']/2)<1,g
        assert r['width'] <= g['client'][0]-23 and r['height'] <= g['client'][1]-23,g
        assert min(abs(r['width']-g['client'][0]+24),abs(r['height']-g['client'][1]+24))<1,g
        assert abs(r['height']/g['native'][3]-g['scale'])<0.001,g
        assert g['scroll']==g['client'],g

    def drag(handle,dx,dy,steps,commit=True):
        expected = ('editCompositionLayout' if handle.startswith('canvas') else 'editFacetSource') if geometry()['label'].startswith('All plots') else 'editCanvas'
        expect(page.locator('.card-row[data-page="1"]')).to_have_attribute('aria-busy','false',timeout=60000)
        page.evaluate('''() => {
          window.resizeCards=[...document.querySelectorAll('#cards .card')];
          window.resizeImages=resizeCards.map(c=>c.querySelector('.thumbnail image'));
          window.resizeSources=resizeImages.map(i=>i?.getAttribute('href'));
          window.removedResizeCards=0;
          window.resizeObserver?.disconnect();
          window.resizeObserver=new MutationObserver(records=>{for(const r of records) for(const n of r.removedNodes)
            if(resizeCards.some(c=>n===c || n.contains?.(c))) removedResizeCards++;});
          resizeObserver.observe(document.querySelector('#cards'),{childList:true,subtree:true});
        }''')
        h=page.locator('[data-resize="'+handle+'"]')
        h.hover()
        box=h.bounding_box()
        x,y=box['x']+box['width']/2,box['y']+box['height']/2
        page.mouse.move(x,y)
        page.mouse.down()
        page.mouse.move(x+dx,y+dy,steps=8)
        expect(page.locator('#code-mode')).to_have_text('Resize chart',timeout=30000)
        expect(page.locator('#current')).to_have_attribute('data-steps',str(steps))
        expect(page.locator('#code-content')).to_have_attribute('data-preview-method',expected)
        assert_fit()
        if page.evaluate('resizeImages.some(Boolean)'):
            page.wait_for_function('resizeImages.some((image,i)=>image && image.getAttribute("href")!==resizeSources[i])',timeout=30000)
        assert page.evaluate('resizeCards.every(c=>c.isConnected) && removedResizeCards===0'), 'Cards must stay mounted during resize'
        if not commit:
            page.keyboard.press('Escape')
            page.mouse.up()
        else:
            page.mouse.up()
            expect(page.locator('#current')).to_have_attribute('data-steps',str(steps+1),timeout=60000)
        expect(page.locator('#current')).not_to_have_class(__import__('re').compile(r'.*resizing.*'),timeout=60000)
        page.locator('h1').hover()
        expect(page.locator('#preview svg')).to_have_count(0)
        assert page.evaluate('resizeCards.every(c=>c.isConnected) && removedResizeCards===0'), 'Pointer release must not replace the card gallery'
        assert page.evaluate('resizeImages.every(i=>!i || i.isConnected)'), 'Thumbnail image nodes should be updated in place'
        page.evaluate('resizeObserver.disconnect()')

    assert_fit()
    before=geometry()
    drag('plot-s',0,20,1)
    after=geometry()
    assert after['lengths'][1]-before['lengths'][1] == 2*round(20/before['scale']),(before,after)
    assert after['lengths'][0]==before['lengths'][0]
    assert_fit()
    expect(page.locator('#current')).to_have_attribute('data-last-method','editCanvas')
    drag('canvas-e',30,0,2)
    canvas=geometry()
    assert canvas['native'][2]-after['native'][2] == 2*round(30/after['scale']),(after,canvas)
    assert canvas['lengths']==after['lengths']
    assert_fit()
    drag('plot-e',25,0,3,commit=False)
    assert geometry()['box']==canvas['box']
    page.locator('#undo').click()
    expect(page.locator('#current')).to_have_attribute('data-steps','2',timeout=60000)
    assert geometry()['box']==after['box']
    page.locator('#redo').click()
    expect(page.locator('#current')).to_have_attribute('data-steps','3',timeout=60000)
    assert geometry()['box']==canvas['box']
    # A refreshed draft must replay the real native edits.
    page.wait_for_timeout(800)
    page.reload()
    expect(page.locator('#current')).to_have_attribute('data-steps','3',timeout=60000)
    assert geometry()['box']==canvas['box']
    with page.expect_download() as downloaded:
        page.get_by_role('button',name='Download current visualization as SVG',exact=True).click()
    svg=Path(downloaded.value.path()).read_text()
    import xml.etree.ElementTree as ET
    exported=ET.fromstring(svg)
    assert float(exported.attrib['width'])==float(canvas['box'].split()[2])
    assert float(exported.attrib['height'])==float(canvas['box'].split()[3])
    assert 'resize-boundary' not in svg
    page.locator('#current').hover()
    page.wait_for_timeout(180)
    Path('output/direct-resize').mkdir(parents=True,exist_ok=True)
    page.screenshot(path='output/direct-resize/current.png')
    assert not errors,errors
    print('PASS hover-only Preview, live axis/canvas/code, one history step, Esc, Undo/Redo and draft replay')
    # Large vertical growth shrinks the entire display; shrinking enlarges it again.
    step = int(page.locator('#current').get_attribute('data-steps'))
    small=geometry()
    drag('canvas-s',0,180,step)
    large=geometry(); assert_fit()
    assert large['scale'] < small['scale'],(small,large)
    drag('canvas-s',0,-65,step+1)
    smaller=geometry(); assert_fit()
    assert smaller['scale'] > large['scale'],(large,smaller)
    assert smaller['lengths']==large['lengths']==small['lengths']
    print('PASS centered uniform shrink/enlarge with no overflow during and after drag',flush=True)
    # Native label constraints clamp an overshoot instead of leaving a broken chart.
    step = int(page.locator('#current').get_attribute('data-steps'))
    drag('plot-e',-500,0,step)
    expect(page.locator('#current svg')).to_have_count(1)
    assert int(geometry()['label'].split('×')[0].split()[-1]) >= 32, 'Overshoot must preserve a positive plot and native guide validation'
    page.locator('#undo').click()
    expect(page.locator('#current')).to_have_attribute('data-steps',str(step),timeout=60000)
    expect(page.locator('#undo')).to_be_enabled(timeout=60000)
    # Keyboard resizing, including repeated keys after the SVG has been replaced.
    handle = page.locator('[data-resize="plot-e"]')
    handle.focus()
    handle.press('Shift+ArrowRight')
    expect(page.locator('#current')).to_have_attribute('data-steps',str(step+1),timeout=60000)
    expect(page.locator('#undo')).to_be_enabled(timeout=60000)
    page.keyboard.press('Shift+ArrowRight')
    expect(page.locator('#current')).to_have_attribute('data-steps',str(step+2),timeout=60000)
    expect(page.locator('#undo')).to_be_enabled(timeout=60000)
    # Returning to the starting position is a cancellation, not a new history step.
    h=page.locator('[data-resize="plot-e"]')
    h.hover(); b=h.bounding_box(); x=b['x']+b['width']/2; y=b['y']+b['height']/2
    before=geometry()
    page.mouse.move(x,y); page.mouse.down(); page.mouse.move(x+20,y,steps=5)
    expect(page.locator('#code-mode')).to_have_text('Resize chart',timeout=30000)
    page.mouse.move(x,y,steps=5); page.mouse.up()
    expect(page.locator('#current')).not_to_have_class(__import__('re').compile(r'.*resizing.*'),timeout=60000)
    expect(page.locator('#current')).to_have_attribute('data-steps',str(step+2))
    assert geometry()['box']==before['box']
    page.locator('#action-search').fill('encodeOpacity')
    card=page.locator('.card[data-method=encodeOpacity]')
    expect(card).to_be_visible(timeout=60000)
    card.locator('.card-top').hover(); card.locator('.apply-button').click()
    expect(page.locator('#current')).to_have_attribute('data-steps',str(step+3),timeout=60000)
    assert abs(geometry()['plot']['width']-before['plot']['width'])<1
    assert abs(geometry()['plot']['height']-before['plot']['height'])<1
    print('PASS native minimum-size clamp, keyboard resize, return-to-origin and subsequent action preserving size',flush=True)
    # Fresh real workflows for composition and non-Cartesian charts.
    for method, facet in [('createScatterPlot',True),('createPiePlot',False)]:
        page = browser.new_page(viewport={'width':1600,'height':900})
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.goto('http://127.0.0.1:5173/')
        page.wait_for_load_state('networkidle')
        page.locator('#dataset').select_option(label='Iris')
        for field in ['Species','Sepal.Length'] if not facet else ['Sepal.Width','Petal.Width','Species']:
            page.get_by_role('button',name='Select column '+field,exact=True).click()
        card = page.locator('.card[data-method='+method+']')
        for number in range(1,12):
            expect(page.locator(f'.card-row[data-page="{number}"]')).to_have_attribute('aria-busy','false',timeout=60000)
            if card.count(): break
            assert page.locator('#cards-next').is_enabled(), 'Plot must be available in the gallery'
            page.locator('#cards-next').click()
            expect(page.locator('#cards-page')).to_have_text(__import__('re').compile(rf'^{number+1} /'),timeout=60000)
        expect(card).to_be_visible(timeout=60000)
        card.scroll_into_view_if_needed()
        card.locator('.card-top').hover()
        card.locator('.apply-button').click()
        expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
        steps=1
        if facet:
            page.locator('#action-search').fill('facet')
            card = page.locator('.card[data-method=facet]')
            expect(card).to_be_visible(timeout=60000)
            card.locator('.card-top').hover()
            card.locator('.apply-button').click()
            expect(page.locator('#current')).to_have_attribute('data-steps','2',timeout=60000)
            steps=2
        drag('plot-s',0,12,steps)
        expect(page.locator('#current')).to_have_attribute('data-last-method','editFacetSource' if facet else 'editCanvas')
        drag('canvas-e',12,0,steps+1)
        expect(page.locator('#current')).to_have_attribute('data-last-method','editCompositionLayout' if facet else 'editCanvas')
        page.set_viewport_size({'width':1200,'height':800})
        page.wait_for_timeout(300)
        host=page.locator('#current').bounding_box()
        rect=geometry()['canvas']
        assert rect['width'] < host['width'] and rect['height'] < host['height']
        assert_fit()
        page.set_viewport_size({'width':1800,'height':1200})
        page.wait_for_timeout(300)
        assert_fit()
        print('PASS',method,'facet' if facet else 'polar','plot + canvas resize and responsive fit',flush=True)
        page.close()
    assert not errors,errors
    browser.close()
