"""Record frame gaps, visual updates and worker latency during real resize drags."""
import json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    results=[]
    for facet in [False,True]:
        page=browser.new_page(viewport={'width':1600,'height':1100})
        page.add_init_script('''{
          const W=window.Worker; window.jobs=[]; window.measure=false;
          window.Worker=class extends W {
            constructor(...args){super(...args);this.pending=new Map();this.addEventListener('message',e=>{
              const start=this.pending.get(e.data.id); if(start&&!e.data.progress){this.pending.delete(e.data.id);
                if(window.measure) jobs.push({type:start.type,ms:performance.now()-start.time});}
            });}
            postMessage(m,...args){this.pending.set(m.id,{type:m.request.type,time:performance.now()});super.postMessage(m,...args);}
          };
        }''')
        page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
        for field in ['Horsepower','Miles_per_Gallon','Origin']:
            page.get_by_role('button',name='Select column '+field,exact=True).click()
        card=page.locator('.card[data-method=createScatterPlot]')
        expect(card).to_be_visible(timeout=60000)
        card.locator('.card-top').hover();card.locator('.apply-button').click()
        expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
        if facet:
            page.locator('#action-search').fill('facet')
            card=page.locator('.card[data-method=facet]');expect(card).to_be_visible(timeout=60000)
            card.locator('.card-top').hover();card.locator('.apply-button').click()
            expect(page.locator('#current')).to_have_attribute('data-steps','2',timeout=60000)
        expect(page.locator('.card-row[data-page="1"]')).to_have_attribute('aria-busy','false',timeout=60000)
        page.locator('h1').hover();page.wait_for_timeout(500)
        handle=page.locator('[data-resize="plot-se"]');handle.hover();b=handle.bounding_box()
        x,y=b['x']+b['width']/2,b['y']+b['height']/2
        page.mouse.move(x,y)
        page.evaluate('''() => {
          window.measure=true;window.jobs=[];window.frames=[];window.visualFrames=0;window.thumbnailFrames=0;window.dirtyChart=false;window.dirtyThumb=false;window.updates=[];window.thumbs=0;window.longTasks=[];
          let last=performance.now();function frame(t){if(!measure)return;frames.push(t-last);last=t;if(dirtyChart)visualFrames++;if(dirtyThumb)thumbnailFrames++;dirtyChart=false;dirtyThumb=false;requestAnimationFrame(frame);}requestAnimationFrame(frame);
          window.currentObserver=new MutationObserver(()=>{updates.push(performance.now());dirtyChart=true;});
          currentObserver.observe(document.querySelector('#current'),{subtree:true,childList:true,attributes:true,attributeFilter:['style','viewBox']});
          window.thumbObserver=new MutationObserver(()=>{thumbs++;dirtyThumb=true;});thumbObserver.observe(document.querySelector('#cards'),{subtree:true,attributes:true,attributeFilter:['href','viewBox','transform','style']});
          window.longObserver=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration)));longObserver.observe({type:'longtask'});
          window.started=performance.now();
        }''')
        page.mouse.down()
        page.mouse.move(x+100,y+65,steps=120)
        measured=page.evaluate('''() => {measure=false;currentObserver.disconnect();thumbObserver.disconnect();longObserver.disconnect();return {duration:performance.now()-started,frames,updates,thumbs,longTasks,jobs,visualFrames,thumbnailFrames};}''')
        Path('output/direct-resize').mkdir(parents=True,exist_ok=True)
        page.screenshot(path=f'output/direct-resize/drag-{facet}.png')
        page.mouse.up()
        expect(page.locator('#current')).not_to_have_class(__import__('re').compile('.*resizing.*'),timeout=60000)
        measured['facet']=facet
        results.append(measured)
        times=sorted(measured['frames']);prep=[j['ms'] for j in measured['jobs'] if j['type']=='prepare']
        print(json.dumps({'facet':facet,'duration':round(measured['duration']),'frames':len(times),'p95_frame_ms':round(times[int(len(times)*.95)],1),
          'max_frame_ms':round(max(times),1),'current_updates':len(measured['updates']),'thumbnail_updates':measured['thumbs'],
          'visual_fps':round(measured['visualFrames']/measured['duration']*1000,1),'thumbnail_fps':round(measured['thumbnailFrames']/measured['duration']*1000,1),
          'long_tasks':measured['longTasks'],'prepare_mean_ms':round(sum(prep)/len(prep),1) if prep else None}),flush=True)
        page.close()
    path=Path(sys.argv[1] if len(sys.argv)>1 else 'output/direct-resize/performance.json');path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(results))
    browser.close()
