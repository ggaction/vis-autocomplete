from canvas_testing import observe_canvas, canvas_text
"""Catch duplicate native/vector layers and axis/handle drift during delayed layout."""
import json, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    findings=[]
    for facet in [False,True]:
        page=browser.new_page(viewport={'width':1600,'height':1100})
        observe_canvas(page)
        page.add_init_script('''{const W=window.Worker;window.slowResize=false;
          window.Worker=class extends W {postMessage(m,...args){
            if(slowResize && m?.request?.type==='prepare') setTimeout(()=>super.postMessage(m,...args),600);
            else super.postMessage(m,...args);
          }};
        }''')
        page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
        for field in ['Horsepower','Miles_per_Gallon','Origin']:
            page.get_by_role('button',name='Select column '+field,exact=True).click()
        card=page.locator('.card[data-method=createScatterPlot]');expect(card).to_be_visible(timeout=60000)
        card.locator('.card-top').hover(position={'x':40,'y':16});card.locator('.apply-button').click()
        expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
        if facet:
            page.locator('#action-search').fill('facet')
            expect(page.locator('#cards')).to_have_attribute('data-search-query','facet',timeout=60000)
            card=page.locator('.card[data-method=facet]');expect(card).to_be_visible(timeout=60000)
            card.locator('.card-top').hover(position={'x':40,'y':16});card.locator('.apply-button').click()
            expect(page.locator('#current')).to_have_attribute('data-steps','2',timeout=60000)
        expect(page.locator('.card-row[data-page="1"]')).to_have_attribute('aria-busy','false',timeout=60000)
        page.locator('h1').hover()
        page.evaluate('''window.measureAlignment=()=>{
          const host=document.querySelector('#current'), canvas=host.querySelector('.canvas-stage > canvas');
          const extra=host.querySelectorAll('.canvas-stage > canvas').length-1;
          const axes=(canvas.__drawings??[]).filter(l=>l.type==='line'&&['#334155','#475569'].includes(l.stroke));
          const h=axes.find(l=>l.points[0].y===l.points[1].y&&Math.abs(l.points[0].x-l.points[1].x)>10);
          const v=axes.find(l=>l.points[0].x===l.points[1].x&&Math.abs(l.points[0].y-l.points[1].y)>10);
          if(!h||!v)return {error:'Axes missing',extra};
          const box=canvas.getBoundingClientRect();
          const point=(l,i)=>({x:box.left+l.points[i].x*box.width/canvas.width,y:box.top+l.points[i].y*box.height/canvas.height});
          const a=point(h,0),b=point(h,1),c=point(v,0),d=point(v,1);
          const rect=host.querySelector('.plot-boundary').getBoundingClientRect();
          return {extra,drift:Math.max(Math.abs(rect.left-Math.min(a.x,b.x)),Math.abs(rect.right-Math.max(a.x,b.x)),
            Math.abs(rect.bottom-a.y),Math.abs(rect.top-Math.min(c.y,d.y))),axes:[a,b,c,d],rect:rect.toJSON()};
        }''')
        for handle,dx,dy in [('plot-s',0,-65),('plot-e',-75,0),('canvas-s',0,40)]:
            page.evaluate('slowResize=true')
            h=page.locator(f'[data-resize="{handle}"]');h.hover();b=h.bounding_box();x,y=b['x']+b['width']/2,b['y']+b['height']/2
            page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+dx,y+dy,steps=8);page.wait_for_timeout(60)
            during=page.evaluate('measureAlignment()')
            page.wait_for_timeout(750)
            refined=page.evaluate('measureAlignment()')
            findings.append({'facet':facet,'handle':handle,'during':during,'refined':refined})
            Path('output/direct-resize').mkdir(parents=True,exist_ok=True)
            if handle=='plot-s':page.screenshot(path=f'output/direct-resize/compressed-{facet}.png')
            page.keyboard.press('Escape');page.mouse.up()
            expect(page.locator('#current')).not_to_have_class(re.compile('.*resizing.*'),timeout=60000)
            assert page.locator('#current .canvas-stage > canvas').count()==1
        page.close()
    browser.close()
    Path('output/direct-resize/alignment.json').write_text(json.dumps(findings,indent=2))
    for f in findings:
        print(json.dumps({'facet':f['facet'],'handle':f['handle'],**{k:{'extra':f[k].get('extra'),'drift':f[k].get('drift'),'error':f[k].get('error')} for k in ['during','refined']}}))
    if '--report-only' not in sys.argv:
        assert all(f[k].get('extra')==0 and f[k].get('drift',999)<1.1 for f in findings for k in ['during','refined']),findings
        print('PASS one image layer and aligned axes during squeeze, native refinement and cancellation')
