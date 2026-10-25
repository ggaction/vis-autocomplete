"""Multi-row facet resizing: whole-grid handles, pointer gain, guide alignment and history."""
import json,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from canvas_testing import observe_canvas

OUT=Path('output/facet-resize');OUT.mkdir(parents=True,exist_ok=True)
rows='X,Y,Group\n'+'\n'.join(f'{i+1},{(i%7)*3+g+1},{chr(65+g)}' for g in range(6) for i in range(12))
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    for mode,method in [('preview','createScatterPlot'),('transition','createScatterPlot'),('transition','createBarPlot'),('preview','createBoxPlot')]:
        page=browser.new_page(viewport={'width':1800,'height':1200});observe_canvas(page)
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
        page.locator('#upload').click()
        page.locator('#file').set_input_files({'name':'six-groups.csv','mimeType':'text/csv','buffer':rows.encode()})
        page.get_by_role('button',name='Use dataset',exact=True).click()
        for field in (['X','Y','Group'] if method=='createScatterPlot' else ['Group','Y']):
            page.get_by_role('button',name='Select column '+field,exact=True).click()
        page.locator(f'#view-mode [data-mode={mode}]').click()
        def pick(method):
            card=page.locator('.card[data-method='+method+']')
            for n in range(1,20):
                expect(page.locator('.card-row[data-page="'+str(n)+'"]')).to_have_attribute('aria-busy','false',timeout=60000)
                if card.count(): break
                page.locator('#cards-next').click()
                expect(page.locator('#cards-page')).to_have_text(re.compile(rf'^{n+1} /'),timeout=60000)
            expect(card).to_be_visible(timeout=60000)
            card.locator('.card-top').hover(position={'x':30,'y':16});card.locator('.apply-button').click()
        pick(method)
        expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
        page.locator('#action-search').fill('facet')
        expect(page.locator('#cards')).to_have_attribute('data-search-query','facet',timeout=60000)
        pick('facet')
        expect(page.locator('#current')).to_have_attribute('data-steps','2',timeout=60000)
        page.locator('#action-search').fill('')
        expect(page.locator('.card-row').first).to_have_attribute('aria-busy','false',timeout=60000)
        page.locator('h1').hover()
        page.evaluate('''window.geo=()=>{
          const host=document.querySelector('#current'),s=host.querySelector('.canvas-stage'),c=s.querySelector('canvas'),p=s.querySelector('.plot-boundary');
          const box=c.getBoundingClientRect(),plot=p.getBoundingClientRect(),root=s.getBoundingClientRect();
          const lines=(c.__drawings??[]).filter(l=>l.type==='line'&&['#334155','#475569'].includes(l.stroke));
          const positions=lines.filter(l=>Math.hypot(l.points[0].x-l.points[1].x,l.points[0].y-l.points[1].y)>10*c.width/(+c.dataset.logicalWidth))
            .flatMap(l=>l.points.map(p=>({x:box.x+p.x*box.width/c.width,y:box.y+p.y*box.height/c.height})));
          return {native:[+c.dataset.logicalWidth,+c.dataset.logicalHeight],scale:root.width/+c.dataset.logicalWidth,
            plot:plot.toJSON(),canvas:root.toJSON(),host:host.getBoundingClientRect().toJSON(),
            drift:positions.length?Math.max(Math.abs(plot.left-Math.min(...positions.map(p=>p.x))),
              Math.abs(plot.right-Math.max(...positions.map(p=>p.x))),Math.abs(plot.top-Math.min(...positions.map(p=>p.y))),
              Math.abs(plot.bottom-Math.max(...positions.map(p=>p.y)))):null};
        };''')
        def settled():
            page.wait_for_function('!document.querySelector("#current").classList.contains("resizing") && !document.querySelector("#current").dataset.resizeSettling')
        steps=2
        for handle,dx,dy in [('plot-e',35,0),('plot-s',0,30),('plot-se',-25,-25),('canvas-e',25,0),('canvas-s',0,20)]:
            settled();before=page.evaluate('geo()');assert before['drift']<1.2,before
            h=page.locator(f'[data-resize={handle}]');h.hover();b=h.bounding_box();x=b['x']+b['width']/2;y=b['y']+b['height']/2
            page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+dx,y+dy,steps=24)
            expect(page.locator('#code-mode')).to_have_text('Resize chart',timeout=60000)
            page.wait_for_timeout(800)
            during=page.evaluate('geo()');assert during['drift']<1.2,during
            assert abs(during['scale']-before['scale'])<.001,(before,during)
            part='canvas' if handle.startswith('canvas') else 'plot'
            assert abs(during[part]['right']-before[part]['right']-dx)<2,(handle,before,during)
            assert abs(during[part]['bottom']-before[part]['bottom']-dy)<2,(handle,before,during)
            expect(page.locator('#current canvas')).to_have_count(1)
            page.mouse.up();steps=3
            expect(page.locator('#current')).to_have_attribute('data-steps',str(steps),timeout=60000);settled()
            after=page.evaluate('geo()');assert after['drift']<1.2,after
            assert after['canvas']['width']<=after['host']['width']-23
            assert after['canvas']['height']<=after['host']['height']-23
            print('PASS',mode,method,handle,'all panels align; 1:1 edge motion; release fit',flush=True)
        page.screenshot(path=str(OUT/f'{mode}-{method}.png'))
        before=page.evaluate('geo()')
        h=page.locator('[data-resize=plot-e]');h.hover();b=h.bounding_box();x=b['x']+b['width']/2;y=b['y']+b['height']/2
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+50,y,steps=12);page.keyboard.press('Escape');page.mouse.up();settled()
        assert page.evaluate('geo().native')==before['native']
        page.locator('#undo').click();expect(page.locator('#current')).to_have_attribute('data-steps',str(steps-1),timeout=60000)
        page.locator('#redo').click();expect(page.locator('#current')).to_have_attribute('data-steps',str(steps),timeout=60000)
        assert page.evaluate('geo().native')==before['native']
        expect(page.locator('#undo')).to_be_enabled(timeout=60000)
        if mode=='preview' and method=='createScatterPlot':
            # A shared six-entry legend imposes a native minimum height.
            # Overshooting must clamp to valid geometry, not lose the drag.
            h=page.locator('[data-resize=plot-s]');h.hover();b=h.bounding_box()
            x,y=b['x']+b['width']/2,b['y']+b['height']/2
            page.mouse.move(x,y);page.mouse.down()
            expect(page.locator('#current')).to_have_class(re.compile('resizing'))
            page.mouse.move(x,max(10,y-230),steps=20);page.mouse.up()
            expect(page.locator('#current')).to_have_attribute('data-steps',str(steps+1),timeout=60000);settled()
            assert page.evaluate('geo().drift')<1.2,page.evaluate('geo()')
            page.locator('#undo').click();expect(page.locator('#current')).to_have_attribute('data-steps',str(steps),timeout=60000)
            assert page.evaluate('geo().native')==before['native']
            print('PASS shared legend minimum-size clamp and Undo after overshoot',flush=True)
        assert not errors,errors
        page.close()
    browser.close()
