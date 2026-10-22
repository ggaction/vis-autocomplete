"""Native pixel equivalence and interrupted transitions across chart families."""
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops
from io import BytesIO
from pathlib import Path
import json
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
 page=browser.new_page(viewport={'width':1600,'height':650},reduced_motion='no-preference')
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:5173/test/fixtures/transition-player.html');page.wait_for_function('window.ready',timeout=60000)
 print('SETUP',page.evaluate('audit.errors'),flush=True)
 assert not page.evaluate('Object.keys(audit.errors).length'),page.evaluate('audit.errors')
 results=[];Path('output/transition-player').mkdir(parents=True,exist_ok=True)
 for name in page.evaluate('Object.keys(audit.cases)'):
  page.evaluate('name=>audit.show(name)',name)
  a=Image.open(BytesIO(page.locator('#actual').screenshot())).convert('RGB');b=Image.open(BytesIO(page.locator('#expected').screenshot())).convert('RGB')
  diff=ImageChops.difference(a,b);changed=sum(max(pixel)>20 for pixel in diff.getdata())/(a.width*a.height)
  assert changed<.005,(name,changed)
  variants=page.evaluate('name=>audit.variantsFor(name)',name);assert variants['count']>=2,(name,variants)
  for index in range(1,variants['count']):
   page.evaluate('([name,index])=>audit.showVariant(name,index)',[name,index])
   a=Image.open(BytesIO(page.locator('#actual').screenshot())).convert('RGB');b=Image.open(BytesIO(page.locator('#expected').screenshot())).convert('RGB')
   variant_diff=ImageChops.difference(a,b)
   ratio=sum(max(pixel)>20 for pixel in variant_diff.getdata())/(a.width*a.height)
   assert ratio<.005,(name,index,ratio)
   changed=max(changed,ratio)
  perf=page.evaluate('name=>audit.exercise(name)',name)
  assert perf['nodes']==perf['settledNodes']==perf['actualNodes'],(name,perf)
  assert perf['definitions']<=1,(name,perf)
  result={'chart':name,'pixelDifference':changed,'variants':variants,**perf};results.append(result)
  print(json.dumps(result),flush=True)
 assert not errors,errors
 Path('output/transition-player/results.json').write_text(json.dumps(results,indent=2))
 browser.close()
