"""Apply flies Preview into Current; unrelated panel scrolling must not abort it."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    page=browser.new_page(viewport={'width':1600,'height':1100},reduced_motion='no-preference')
    page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
    for field in ['Horsepower','Miles_per_Gallon']:
        page.get_by_role('button',name='Select column '+field,exact=True).click()
    card=page.locator('.card[data-method=createScatterPlot]');expect(card).to_be_visible(timeout=60000)
    def observe():
        page.evaluate('''() => {
          window.flights=[];
          window.transferObserver?.disconnect();
          window.transferObserver=new MutationObserver(records=>{
            for(const r of records){for(const n of r.addedNodes)if(n.classList?.contains('chart-transfer')){
              const flight={start:performance.now(),frames:[],destination:n.getAnimations()[0].effect.getKeyframes().at(-1).transform}; flights.push(flight);
              function frame(){if(!n.isConnected){flight.end=performance.now();return;}
                flight.frames.push({t:performance.now(),x:n.getBoundingClientRect().left});requestAnimationFrame(frame);}frame();
              document.querySelector('#code-content').scrollTop=0;
            }}
          });transferObserver.observe(document.body,{childList:true});
        }''')
    observe();card.locator('.card-top').hover();card.locator('.apply-button').click()
    page.wait_for_timeout(150)
    Path('output/chart-transfer').mkdir(parents=True,exist_ok=True)
    page.screenshot(path='output/chart-transfer/mid-flight.png')
    expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
    page.wait_for_timeout(100)
    first=page.evaluate('flights');print('initial',[(round(f['end']-f['start']),len(f['frames'])) for f in first],flush=True)
    if '--report-only' in sys.argv:
        browser.close();sys.exit()
    assert len(first)==1 and first[0]['end']-first[0]['start']>=400,first
    assert len(first[0]['frames'])>=15,first
    assert first[0]['frames'][-1]['x']<first[0]['frames'][0]['x']-300,first
    expect(page.locator('.chart-transfer')).to_have_count(0)
    expect(page.locator('#preview svg')).to_have_count(0)
    page.locator('#action-search').fill('encodeOpacity')
    card=page.locator('.card[data-method=encodeOpacity]');expect(card).to_be_visible(timeout=60000)
    observe();card.locator('.card-top').hover();card.locator('.apply-button').click()
    expect(page.locator('#current')).to_have_attribute('data-steps','2',timeout=60000)
    page.wait_for_timeout(100)
    second=page.evaluate('flights');print('followup',[(round(f['end']-f['start']),len(f['frames'])) for f in second],flush=True)
    landing=page.evaluate('''() => {
      const d=new DOMMatrix(flights[0].destination);
      const r=document.querySelector('#current .canvas-stage > svg').getBoundingClientRect();
      const vb=document.querySelector('#current .canvas-stage > svg').viewBox.baseVal;
      return {x:Math.abs(r.x-d.e),y:Math.abs(r.y-d.f),width:Math.abs(r.width-vb.width*d.a),height:Math.abs(r.height-vb.height*d.d)};
    }''')
    assert max(landing.values())<1,landing
    page.screenshot(path='output/chart-transfer/landed.png')
    assert len(second)==1 and second[0]['end']-second[0]['start']>=400,second
    expect(page.locator('#current')).to_have_attribute('data-last-method','encodeOpacity')
    expect(page.locator('#current .canvas-stage > svg')).to_have_count(1)
    expect(page.locator('.chart-transfer')).to_have_count(0)
    page.emulate_media(reduced_motion='reduce')
    page.locator('#action-search').fill('encodeSize');card=page.locator('.card[data-method=encodeSize]')
    expect(card).to_be_visible(timeout=60000)
    observe();card.locator('.card-top').hover();card.locator('.apply-button').click()
    expect(page.locator('#current')).to_have_attribute('data-steps','3',timeout=60000)
    assert page.evaluate('flights.length')==0
    print('PASS initial/followup Apply flights, code scrolling, landing and reduced motion')
    browser.close()
