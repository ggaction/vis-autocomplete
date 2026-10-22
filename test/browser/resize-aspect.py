"""Pending native resize never stretches chart/thumbnail bitmaps."""
import re
from playwright.sync_api import sync_playwright,expect

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    for mode in ['preview','transition']:
        page=browser.new_page(viewport={'width':1600,'height':1100})
        page.add_init_script('''{
          const W=Worker; window.delayResize=false;
          window.Worker=class extends W { postMessage(m,...args) {
            if(delayResize && ['prepare','prepare-resized'].includes(m?.request?.type))
              setTimeout(()=>super.postMessage(m,...args),350);
            else super.postMessage(m,...args);
          }};
          window.resizeSamples=[];
          function sample(){
            if(document.querySelector('#current.resizing')) {
              for(const canvas of document.querySelectorAll('#current canvas, #cards .thumbnail canvas')) {
                const matrix=new DOMMatrix(getComputedStyle(canvas).transform);
                resizeSamples.push({current:!!canvas.closest('#current'),sx:matrix.a,sy:matrix.d});
              }
            }
            requestAnimationFrame(sample);
          }
          requestAnimationFrame(sample);
        }''')
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto('http://127.0.0.1:5173/')
        page.wait_for_load_state('networkidle')
        page.locator('#dataset').select_option(label='Iris')
        for field in ['Sepal.Width','Petal.Width','Species']:
            page.get_by_role('button',name='Select column '+field,exact=True).click()
        page.locator(f'#view-mode [data-mode={mode}]').click()
        card=page.locator('.card[data-method=createScatterPlot]')
        expect(card).to_be_visible(timeout=60000)
        card.locator('.card-top').hover(position={'x':30,'y':16})
        card.locator('.apply-button').click()
        expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
        expect(page.locator('.card-row').first).to_have_attribute('aria-busy','false',timeout=60000)
        page.locator('h1').hover()
        for handle,dx,dy in [('plot-s',0,-40),('plot-e',-40,0),('canvas-s',0,45)]:
            page.evaluate('delayResize=true;resizeSamples=[]')
            h=page.locator(f'[data-resize={handle}]');h.hover()
            box=h.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
            page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+dx,y+dy,steps=4)
            page.wait_for_timeout(100)
            expect(page.locator('#current')).to_have_class(re.compile('resizing'))
            expect(page.locator('#current canvas')).to_have_count(1)
            page.screenshot(path=f'output/resize-aspect/{mode}-{handle}.png')
            samples=page.evaluate('resizeSamples')
            assert any(s['current'] for s in samples) and any(not s['current'] for s in samples)
            assert all(abs(s['sx']-s['sy'])<.00001 for s in samples),samples
            expect(page.locator('#code-mode')).to_have_text('Resize chart',timeout=30000)
            page.wait_for_timeout(600)
            assert page.evaluate('resizeSamples.every(s=>Math.abs(s.sx-s.sy)<.00001)')
            page.keyboard.press('Escape');page.mouse.up()
            expect(page.locator('#current')).not_to_have_class(re.compile('resizing'))
            expect(page.locator('#current')).to_have_attribute('data-steps','1')
            print('PASS',mode,handle,'uniform current/thumbnail scale while workers lag and finish; Esc restores',flush=True)
        assert not errors,errors
        page.close()
    browser.close()
