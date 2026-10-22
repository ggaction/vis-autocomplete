"""Compare native Canvas and retained SVG on identical dense, faceted scenes."""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json
out=Path('output/canvas-migration');out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
 results={}
 for backend in ['svg','canvas']:
  page=b.new_page(viewport={'width':2560,'height':1440},device_scale_factor=2)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:5173/test/fixtures/transition-player.html?backend='+backend);page.wait_for_function('window.ready',timeout=60000)
  page.evaluate("document.querySelector('#actual').style.cssText='width:1800px;height:700px;position:relative';document.querySelector('#expected').style.display='none'")
  results[backend]=page.evaluate('audit.stress()');assert not errors,errors
  assert len(set(row['dom'] for row in results[backend]))==1,results[backend]
  assert len(set(row['nodes'] for row in results[backend]))==1,results[backend]
  print(backend,json.dumps(results[backend]),flush=True);page.close()
 (out/'backend-performance.json').write_text(json.dumps(results,indent=2));b.close()
