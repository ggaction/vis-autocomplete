"""Saved modes/layouts paint correctly even when the application cannot load."""
import json
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    for mode,layout,saved in [('transition','vertical',None),('transition','horizontal','horizontal'),
                              ('preview','vertical','vertical'),('preview','horizontal',None)]:
        context=browser.new_context(viewport={'width':1600,'height':1100})
        context.add_init_script('''{
          localStorage.setItem('vis-autocomplete.view-mode', MODE);
          if (LAYOUT) localStorage.setItem('vis-autocomplete.workspace-layout',JSON.stringify({[MODE]:LAYOUT}));
          window.paintSamples=[];
          function sample(){
            const vis=document.querySelector('.visualizations'), work=document.querySelector('.authoring-area');
            if(vis && work && getComputedStyle(vis).display==='grid') {
              const activeMode=document.querySelector('#view-mode [data-mode="'+MODE+'"]');
              const inactiveMode=document.querySelector('#view-mode [data-mode="'+(MODE==='transition'?'preview':'transition')+'"]');
              paintSamples.push({preview:getComputedStyle(document.querySelector('[aria-labelledby="preview-heading"]')).display,
                columns:getComputedStyle(work).gridTemplateColumns.split(' ').length,
                active:getComputedStyle(activeMode).backgroundColor,inactive:getComputedStyle(inactiveMode).backgroundColor});
            }
            requestAnimationFrame(sample);
          }
          requestAnimationFrame(sample);
        }'''.replace('MODE',json.dumps(mode)).replace('LAYOUT',json.dumps(saved)))
        page=context.new_page()
        page.route('**/web/app.js',lambda route:route.abort())
        page.goto('http://127.0.0.1:5173/')
        page.wait_for_function('paintSamples.length>2')
        assert page.locator('.workspace').get_attribute('data-layout') is None, 'app should still be unavailable'
        expect(page.locator(f'#view-mode [data-mode={mode}]')).to_have_attribute('aria-pressed','true')
        expect(page.locator(f'#workspace-layout [data-layout={layout}]')).to_have_attribute('aria-pressed','true')
        def check_samples():
            samples=page.evaluate('paintSamples')
            assert samples
            for frame in samples:
                assert (frame['preview']=='none')==(mode=='transition'),frame
                assert frame['columns']==(2 if layout=='vertical' else 1),frame
                assert frame['active']!=frame['inactive'],frame
        check_samples()
        page.screenshot(path=f'output/view-first-paint/{mode}-{layout}.png')
        page.unroute('**/web/app.js')
        page.reload()
        page.wait_for_load_state('networkidle')
        expect(page.locator('.workspace')).to_have_attribute('data-layout',layout)
        expect(page.locator(f'#view-mode [data-mode={mode}]')).to_have_attribute('aria-pressed','true')
        check_samples()
        print('PASS',mode,layout,'first painted frames with app blocked, then normal startup',flush=True)
        context.close()
    browser.close()
