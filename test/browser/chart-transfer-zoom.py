"""Preview flight coordinates match the final chart after zoom, pan and resize.

Start a local server and an isolated mock account session from
scripts/audit-browser-session-2026-10-25.mjs with Chromium CDP enabled.
Run: python test/browser/chart-transfer-zoom.py --cdp http://127.0.0.1:9333
"""
import argparse, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--cdp', required=True)
parser.add_argument('--report-only', action='store_true')
args = parser.parse_args()
out = Path('output/chart-transfer-zoom')
out.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', r'''
import {writeFileSync} from 'node:fs';import {createProject} from './web/project.js';import {importDataset} from './src/data-import.js';
const c=(method,args)=>({method,args});
const imported=importDataset(JSON.stringify(Array.from({length:18},(_,i)=>({X:i+1,Y:i%7+2,G:['A','B','C'][i%3]}))),{format:'json',name:'Flight'});
for(const kind of ['unit','facet','concat']) {
 const setupCalls=[c('createCanvas',{plot:{width:314,height:314},margin:{left:170,right:216,top:42,bottom:74}}),c('createData',{id:'dataset',values:'__LOADED_DATA__'})];
 const calls=[c('createScatterPlot',{id:'plot',data:'dataset',x:'X',y:'Y',color:'G'})];
 if(kind==='facet')calls.push(c('facet',{field:'G',columns:3,guides:{legend:'shared',axes:'outer'}}));
 if(kind==='concat')calls.push(c('createAdjacentPlot',{id:'second',source:'plot',position:'right',plot:{action:'createScatterPlot',options:{data:'dataset',x:'X',y:'Y',color:'G'}},share:{color:true}}));
 const snapshot={setupCalls,calls,guideCall:c('createGuides',kind==='concat'?{target:[{childPath:['plot']},{childPath:['second']}]}:{}),steps:calls.length,phase:'recommendations',selection:{fields:['X','Y','G']},currentNote:'Flight test',context:{target:'plot'},plotData:'dataset',optionGroup:'encoding'};
 writeFileSync(`output/chart-transfer-zoom/${kind}.json`,JSON.stringify(createProject([{id:kind,name:'Flight',imported,session:{entries:[snapshot],index:0}}],kind)));
}
'''], check=True)

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(args.cdp)
    page = browser.contexts[0].pages[0]
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.wait_for_load_state('networkidle')
    expect(page.locator('#dataset')).to_be_enabled(timeout=60000)
    page.emulate_media(reduced_motion='no-preference')
    cases = [('horizontal', 'unit', 3, ''), ('horizontal', 'unit', -2, ''), ('vertical', 'unit', 2, ''),
             ('horizontal', 'facet', 2, ''), ('vertical', 'concat', 2, ''), ('horizontal', 'unit', 0, ''),
             ('horizontal', 'unit', 2, 'cancel'), ('horizontal', 'unit', 1, 'reduce')]
    for layout, kind, zoom_steps, special in cases[:1] if args.report_only else cases:
        page.locator('#project-file').set_input_files(str(out / f'{kind}.json'))
        steps = 1 if kind == 'unit' else 2
        expect(page.locator('#current')).to_have_attribute('data-steps', str(steps), timeout=60000)
        expect(page.locator('#reset')).to_be_enabled(timeout=60000)
        page.locator('#view-mode [data-mode="preview"]').click()
        page.locator(f'#workspace-layout [data-layout="{layout}"]').click()
        tools = page.get_by_role('group', name='Current visualization zoom', exact=True)
        tools.get_by_role('button', name='Fit chart to view').click()
        for _ in range(abs(zoom_steps)):
            tools.get_by_role('button', name='Zoom in' if zoom_steps > 0 else 'Zoom out', exact=True).click()
        page.wait_for_function('(z)=>Math.abs(Number(document.querySelector("#current").dataset.chartZoom)-z)<.001', arg=1.2 ** zoom_steps)
        if zoom_steps > 0:
            clip = page.get_by_label('Current visualization viewport', exact=True).bounding_box()
            x, y = clip['x'] + clip['width'] / 2, clip['y'] + 6
            page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + 31, y + 19, steps=6); page.mouse.up()
        # Unequal view sizes expose fit/zoom coordinate mixing independently of
        # native chart dimensions. Keyboard resizing uses the real divider.
        handle = page.locator('[data-divider="views"]')
        handle.focus()
        for _ in range(4):
            handle.press('ArrowRight' if handle.get_attribute('data-axis') == 'x' else 'ArrowDown')
        if kind == 'facet':
            page.context.new_cdp_session(page).send('Emulation.setDeviceMetricsOverride', {
                'width': 1800, 'height': 1200, 'deviceScaleFactor': 2, 'mobile': False})
        if zoom_steps == 0:
            handle = page.locator('#current [data-resize="plot-s"]')
            box = handle.bounding_box()
            x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
            page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x, y - 20, steps=6); page.mouse.up()
            steps += 1
            expect(page.locator('#current')).to_have_attribute('data-steps', str(steps), timeout=60000)
            page.wait_for_function('!document.querySelector("#current").dataset.resizeSettling && !document.querySelector("#current").classList.contains("resizing")')
        page.emulate_media(reduced_motion='reduce' if special == 'reduce' else 'no-preference')
        page.locator('#group-encoding').click()
        page.locator('#action-search').fill('encodeOpacity')
        expect(page.locator('#cards')).to_have_attribute('data-search-query', 'encodeopacity', timeout=60000)
        card = page.locator('.card').filter(has=page.locator('.method', has_text='encodeOpacity'))
        if card.count() == 0:
            card = page.locator('.card[data-method="encodeOpacity"], .card[data-method="editFacetSource"]').first
        card.locator('.card-top').hover()
        expect(card.locator('.apply-button')).to_be_enabled(timeout=60000)
        page.evaluate('''() => {
          window.flights=[];window.flightObserver?.disconnect();const nodes=new WeakMap();
          window.flightObserver=new MutationObserver(records=>{
            for(const r of records){
             for(const n of r.removedNodes)if(nodes.has(n))nodes.get(n).elapsed=performance.now()-nodes.get(n).started;
             for(const n of r.addedNodes)if(n.classList?.contains('chart-transfer')){
              const animation=n.getAnimations()[0],frames=animation.effect.getKeyframes();
              const canvas=document.querySelector('#preview canvas'),r=canvas.getBoundingClientRect();
              const [x,y,width,height]=canvas.dataset.viewBox.split(' ').map(Number),s=Math.min(r.width/width,r.height/height);
              const start=new DOMMatrix(frames[0].transform);
              const flight={started:performance.now(),start:frames[0].transform,end:frames.at(-1).transform,clip:frames.at(-1).clipPath,
                departureError:Math.max(Math.abs(start.e+x*start.a-r.left-(r.width-width*s)/2),Math.abs(start.f+y*start.d-r.top-(r.height-height*s)/2)),
                width:parseFloat(n.style.width),height:parseFloat(n.style.height)};
              flights.push(flight);nodes.set(n,flight);
              document.querySelector('#code-content').dispatchEvent(new Event('scroll'));
            }}
          });flightObserver.observe(document.body,{childList:true});
        }''')
        card.locator('.apply-button').click()
        if special == 'cancel':
            expect(page.locator('.chart-transfer')).to_have_count(1)
            page.set_viewport_size({'width': 1640, 'height': 1120})
        expect(page.locator('#current')).to_have_attribute('data-steps', str(steps + 1), timeout=60000)
        expect(page.locator('.chart-transfer')).to_have_count(0)
        expect(page.locator('.chart-transfer-source')).to_have_count(0)
        if special:
            assert page.evaluate('flights.length') == (0 if special == 'reduce' else 1)
            assert page.locator('#current .canvas-stage > canvas').count() == 1
            print('PASS', special, 'flight cleanup and committed chart', flush=True)
            continue
        measurement = page.evaluate(r'''() => {
          if(flights.length!==1)throw Error('Expected one flight');
          const f=flights[0],m=new DOMMatrix(f.end),canvas=document.querySelector('#current .canvas-stage > canvas');
          const r=canvas.getBoundingClientRect(),clip=canvas.closest('.chart-viewport-clip').getBoundingClientRect();
          const parts=f.clip.match(/[-.\d]+/g).map(Number),[top,right,bottom,left]=parts.length===1?[parts[0],parts[0],parts[0],parts[0]]:parts.length===2?[parts[0],parts[1],parts[0],parts[1]]:parts.length===3?[parts[0],parts[1],parts[2],parts[1]]:parts;
          const clipped={left:m.e+left*m.a,top:m.f+top*m.d,right:m.e+(f.width-right)*m.a,bottom:m.f+(f.height-bottom)*m.d};
          const visible={left:Math.max(r.left,clip.left),top:Math.max(r.top,clip.top),right:Math.min(r.right,clip.right),bottom:Math.min(r.bottom,clip.bottom)};
          return {error:Math.max(Math.abs(r.left-m.e),Math.abs(r.top-m.f),Math.abs(r.width-f.width*m.a),Math.abs(r.height-f.height*m.d)),
            clipError:Math.max(...Object.keys(visible).map(key=>Math.abs(visible[key]-clipped[key]))),
            flight:f,actual:{left:r.left,top:r.top,width:r.width,height:r.height},viewport:{left:clip.left,top:clip.top,right:clip.right,bottom:clip.bottom}};
        }''')
        print(layout, kind, zoom_steps, measurement, flush=True)
        if not args.report_only:
            assert measurement['error'] < 1, measurement
            assert measurement['clipError'] < 1, measurement
            assert measurement['flight']['departureError'] < 1, measurement
            assert measurement['flight']['elapsed'] >= 400, 'Unrelated scrolling must not cancel the flight'
            assert page.locator('#preview canvas').count() == 0
        page.locator('.visualizations').screenshot(path=str(out / f'{layout}-{kind}-{zoom_steps}.png'))
    assert not errors, errors
