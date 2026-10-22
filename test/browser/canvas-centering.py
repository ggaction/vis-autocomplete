"""Restore the reported uneven facet Canvas, shrink it, and replay history."""
import subprocess
from playwright.sync_api import sync_playwright,expect
subprocess.run(['node','test/fixtures/centered-canvas.mjs'],check=True)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
 page=b.new_page(viewport={'width':1800,'height':1200});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
 page.locator('#project-file').set_input_files('output/centered-resize/legacy.visauto')
 expect(page.locator('#current')).to_have_attribute('data-steps','4',timeout=60000)
 page.locator('h1').hover()
 def measure():
  page.wait_for_function('!document.querySelector("#current").classList.contains("resizing") && !document.querySelector("#current").dataset.resizeSettling')
  return page.locator('#current canvas').evaluate('''c=>{
   const w=c.width,h=c.height,p=c.getContext('2d').getImageData(0,0,w,h).data;
   let x0=w,x1=0,y0=h,y1=0;
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=(y*w+x)*4;if(p[k+3]>100 && Math.min(p[k],p[k+1],p[k+2])<180){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}}
   return {width:+c.dataset.logicalWidth,height:+c.dataset.logicalHeight,
    blanks:[x0/w*c.dataset.logicalWidth,(w-1-x1)/w*c.dataset.logicalWidth,y0/h*c.dataset.logicalHeight,(h-1-y1)/h*c.dataset.logicalHeight]};
  }''')
 before=measure()
 assert abs(before['blanks'][0]-before['blanks'][1])<8,before
 assert abs(before['blanks'][2]-before['blanks'][3])<8,before
 page.screenshot(path='output/centered-resize/restored.png')
 handle=page.locator('[data-resize=canvas-s]');handle.hover();r=handle.bounding_box();x=r['x']+r['width']/2;y=r['y']+r['height']/2
 page.mouse.move(x,y);page.mouse.down();page.mouse.move(x,y-55,steps=20);page.mouse.up()
 expect(page.locator('#current')).to_have_attribute('data-steps','5',timeout=60000)
 page.locator('h1').hover();after=measure()
 assert after['height']<before['height']-30,(before,after)
 assert abs(after['blanks'][2]-after['blanks'][3])<8,after
 page.screenshot(path='output/centered-resize/shrunk.png')
 page.locator('#undo').click();expect(page.locator('#current')).to_have_attribute('data-steps','4',timeout=60000)
 assert measure()['height']==before['height']
 page.locator('#redo').click();expect(page.locator('#current')).to_have_attribute('data-steps','5',timeout=60000)
 assert measure()['height']==after['height']
 page.wait_for_timeout(700);page.reload();expect(page.locator('#current')).to_have_attribute('data-steps','5',timeout=60000)
 assert measure()['height']==after['height']
 assert not errors,errors
 print('PASS native content centered after legacy restore, bottom shrink, Undo/Redo and reload:',before,after,flush=True)
 b.close()
