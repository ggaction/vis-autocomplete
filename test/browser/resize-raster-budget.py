"""Pending resize uses compositor frames, not repeated rasterization of unchanged scenes."""
import json, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

results=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    for mode in ['preview','transition']:
        page=browser.new_page(viewport={'width':2400,'height':1400},device_scale_factor=2)
        errors=[];page.on('pageerror',lambda e: errors.append(str(e)))
        page.add_init_script('''{
          const W=Worker;window.holdResize=false;window.pendingResize=[];
          window.Worker=class extends W { postMessage(m,...args) {
            if(holdResize && ['prepare','prepare-resized'].includes(m?.request?.type))
              pendingResize.push(()=>super.postMessage(m,...args));
            else super.postMessage(m,...args);
          }};
          window.releaseResize=()=>{holdResize=false;pendingResize.splice(0).forEach(send=>send());};
          window.rasterSnapshot=()=>[...document.querySelectorAll('#current canvas,#cards .thumbnail canvas')]
            .filter(c=>c.isConnected&&c.getBoundingClientRect().width>0)
            .map(c=>({current:!!c.closest('#current'),paint:+c.dataset.paint,width:c.width,height:c.height}));
        }''')
        page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
        page.locator('#dataset').select_option(label='Iris')
        for field in ['Sepal.Width','Petal.Width','Species']:
            page.get_by_role('button',name='Select column '+field,exact=True).click()
        page.locator(f'#view-mode [data-mode={mode}]').click()
        card=page.locator('.card[data-method=createScatterPlot]');expect(card).to_be_visible(timeout=60000)
        expect(page.locator('.card-row').first).to_have_attribute('aria-busy','false',timeout=60000)
        card.locator('.card-top').hover(position={'x':30,'y':16});card.locator('.apply-button').click()
        expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
        expect(page.locator('.card-row').first).to_have_attribute('aria-busy','false',timeout=60000)
        page.locator('h1').hover();page.wait_for_timeout(300)
        for handle,dx,dy in [('plot-s',0,-80),('plot-e',100,0),('canvas-s',0,75)]:
            page.evaluate('holdResize=true')
            h=page.locator(f'[data-resize={handle}]');h.hover();b=h.bounding_box()
            x,y=b['x']+b['width']/2,b['y']+b['height']/2
            page.mouse.move(x,y);page.mouse.down();page.wait_for_timeout(50)
            before=page.evaluate('rasterSnapshot()')
            page.mouse.move(x+dx,y+dy,steps=60)
            page.wait_for_timeout(50)
            after=page.evaluate('rasterSnapshot()')
            result={'mode':mode,'handle':handle,'pending_redraws':sum(a['paint']-b['paint'] for a,b in zip(after,before)),
                'canvases':len(before)}
            results.append(result);print(json.dumps(result),flush=True)
            if '--report-only' not in sys.argv:
                assert before==after, 'Unchanged scenes were rerasterized during pointer feedback: '+str(result)
            assert page.evaluate('''[...document.querySelectorAll('#current canvas,#cards .thumbnail canvas')].every(c=>{
              const m=new DOMMatrix(getComputedStyle(c).transform);return Math.abs(m.a-m.d)<.00001;})''')
            page.evaluate('releaseResize()')
            expect(page.locator('#code-mode')).to_have_text('Resize chart',timeout=30000)
            page.wait_for_function('(before)=>rasterSnapshot().some((c,i)=>c.paint>before[i].paint)',arg=before,timeout=30000)
            # Every visible option still gets a native updated thumbnail.
            page.wait_for_function('(before)=>rasterSnapshot().every((c,i)=>c.paint>before[i].paint)',arg=before,timeout=30000)
            page.keyboard.press('Escape');page.mouse.up()
            expect(page.locator('#current')).not_to_have_class(re.compile('resizing'))
            expect(page.locator('#current')).to_have_attribute('data-steps','1')
        assert not errors,errors
        page.close()
    browser.close()
Path('output/resize-aspect').mkdir(parents=True,exist_ok=True)
Path('output/resize-aspect/raster-budget.json').write_text(json.dumps(results,indent=2))
