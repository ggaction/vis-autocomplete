"""Resize holds display scale until release, then fits uniformly via compositor animation."""
import re
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    for mode in ['preview','transition']:
        page=browser.new_page(viewport={'width':1600,'height':1100})
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
        page.locator('#dataset').select_option(label='Iris')
        for field in ['Sepal.Width','Petal.Width','Species']:
            page.get_by_role('button',name='Select column '+field,exact=True).click()
        page.locator(f'#view-mode [data-mode={mode}]').click()
        card=page.locator('.card[data-method=createScatterPlot]');expect(card).to_be_visible(timeout=60000)
        expect(page.locator('.card-row').first).to_have_attribute('aria-busy','false',timeout=60000)
        card.locator('.card-top').hover(position={'x':40,'y':16});card.locator('.apply-button').click()
        expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
        expect(page.locator('.card-row').first).to_have_attribute('aria-busy','false',timeout=60000)
        page.locator('h1').hover()
        page.evaluate('''window.measureResize=()=>{
          const h=document.querySelector('#current'),s=h.querySelector('.canvas-stage'),b=s.querySelector('.canvas-boundary');
          const w=+b.querySelector('.resize-label').textContent.match(/[0-9]+/)[0];
          return {scale:parseFloat(s.style.width)/w,rect:s.getBoundingClientRect().toJSON(),host:h.getBoundingClientRect().toJSON()};
        };window.fitFrames=[];function sample(){
          if(document.querySelector('#current')?.dataset.resizeSettling){
            const s=document.querySelector('#current .canvas-stage'),m=new DOMMatrix(getComputedStyle(s).transform);
            fitFrames.push({sx:m.a,sy:m.d});
          }requestAnimationFrame(sample);
        }requestAnimationFrame(sample);''')
        steps=1
        handles=([('plot-s',0,-40),('plot-s',0,65),('canvas-s',0,55)] if mode=='preview'
                 else [('plot-e',-40,0),('plot-e',65,0),('canvas-e',55,0)])
        for handle,dx,dy in handles:
            before=page.evaluate('measureResize()');page.evaluate('fitFrames=[]')
            h=page.locator(f'[data-resize={handle}]');h.hover();b=h.bounding_box()
            x,y=b['x']+b['width']/2,b['y']+b['height']/2
            page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+dx,y+dy,steps=24)
            expect(page.locator('#code-mode')).to_have_text('Resize chart',timeout=30000)
            page.wait_for_timeout(250)
            during=page.evaluate('measureResize()')
            assert abs(during['scale']-before['scale'])<.002,(before,during)
            assert page.evaluate('fitFrames.length')==0
            page.mouse.up();steps=2
            expect(page.locator('#current')).to_have_attribute('data-steps',str(steps),timeout=60000)
            page.wait_for_function('!document.querySelector("#current").classList.contains("resizing") && !document.querySelector("#current").dataset.resizeSettling')
            after=page.evaluate('measureResize()');r=after['rect'];host=after['host']
            assert abs(r['x']+r['width']/2-host['x']-host['width']/2)<1
            assert abs(r['y']+r['height']/2-host['y']-host['height']/2)<1
            assert r['width']<=host['width']-23 and r['height']<=host['height']-23
            frames=page.evaluate('fitFrames')
            assert len(frames)>2 and all(abs(f['sx']-f['sy'])<.0001 for f in frames),frames
            assert abs(frames[0]['sx']-1)>abs(frames[-1]['sx']-1),frames
            print('PASS',mode,handle,'fixed scale during drag; uniform animated fit after release',flush=True)
        # Reduced-motion users get the same final fit without animation.
        page.emulate_media(reduced_motion='reduce');page.evaluate('fitFrames=[]')
        h=page.locator('[data-resize=plot-s]');h.hover();b=h.bounding_box()
        x,y=b['x']+b['width']/2,b['y']+b['height']/2
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x,y-20,steps=5);page.mouse.up();steps=2
        expect(page.locator('#current')).to_have_attribute('data-steps',str(steps),timeout=60000)
        expect(page.locator('#current')).not_to_have_class(re.compile('resizing'))
        assert page.evaluate('fitFrames.length')==0
        assert not errors,errors
        page.close()
    browser.close()
