"""Consecutive direct resizes coalesce code, native traces and history cells."""
from saved_project import read_saved_project
import json, re, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
subprocess.run(['node','test/fixtures/centered-canvas.mjs'],check=True)
fixture=json.loads(Path('output/centered-resize/legacy.visauto').read_text())
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
 for facet in [False,True]:
  context=browser.new_context(viewport={'width':1800,'height':1200})
  page=context.new_page();errors=[]
  page.on('pageerror',lambda e: errors.append(str(e)))
  project=json.loads(json.dumps(fixture))
  snapshot=project['datasets'][0]['session']['entries'][0]
  if not facet:
   snapshot['calls'].pop();snapshot['steps']=3;snapshot['currentNote']='Encode size'
  start=snapshot['steps']
  page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
  page.locator('#project-file').set_input_files({'name':'resize.visauto.json','mimeType':'application/json','buffer':json.dumps(project).encode()})
  expect(page.locator('#current')).to_have_attribute('data-steps',str(start),timeout=60000)
  def geometry():
   page.wait_for_function('!document.querySelector("#current").classList.contains("resizing") && !document.querySelector("#current").dataset.resizeSettling')
   return page.locator('#current').evaluate('e=>[e.querySelector("canvas").dataset.logicalWidth,e.querySelector("canvas").dataset.logicalHeight,e.querySelector(".plot-boundary").textContent]')
  def session():
   doc=read_saved_project(page)
   return next(d['session'] for d in doc['datasets'] if d['id']==doc['activeId'])
  def drag(handle,dx,dy,step,cancel=False):
   page.locator('h1').hover()
   expect(page.locator('#undo')).to_be_enabled(timeout=60000) if int(page.locator('#history .history-item').count())>1 else None
   h=page.locator(f'[data-resize={handle}]');h.hover();r=h.bounding_box();x=r['x']+r['width']/2;y=r['y']+r['height']/2
   page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+dx,y+dy,steps=12)
   expect(page.locator('#code-mode')).to_have_text('Resize chart',timeout=60000)
   if cancel: page.keyboard.press('Escape')
   page.mouse.up()
   expect(page.locator('#current')).not_to_have_class(re.compile('.*resizing.*'),timeout=60000)
   expect(page.locator('#current')).to_have_attribute('data-steps',str(step),timeout=60000)
   page.locator('h1').hover();return geometry()
  original=geometry();initial=session();baseline_calls=initial['entries'][-1]['calls']
  traces=[]
  for handle,dx,dy in [('plot-s',0,15),('canvas-e',14,0),('plot-e',12,0),('canvas-s',0,-12)]:
   final=drag(handle,dx,dy,start+1)
   expect(page.locator('#history .history-item')).to_have_count(2)
   traces.append(int(page.locator('#current').get_attribute('data-trace-count')))
   saved=session();assert saved['index']==1 and len(saved['entries'])==2,saved
   calls=saved['entries'][-1]['calls'];assert calls[:len(baseline_calls)]==baseline_calls
   assert len(calls)-len(baseline_calls)<=2,calls
  assert max(traces)-min(traces)<=1,traces
  assert drag('plot-e',18,0,start+1,cancel=True)==final
  page.locator('#undo').click();expect(page.locator('#current')).to_have_attribute('data-steps',str(start),timeout=60000)
  assert geometry()==original
  page.locator('#redo').click();expect(page.locator('#current')).to_have_attribute('data-steps',str(start+1),timeout=60000)
  assert geometry()==final
  page.wait_for_timeout(700);page.reload();expect(page.locator('#current')).to_have_attribute('data-steps',str(start+1),timeout=60000)
  assert geometry()==final
  expect(page.locator('#history .history-item')).to_have_count(2)
  # An action splits the run; its successor must not overwrite the earlier resize.
  page.locator('#action-search').fill('encodeOpacity')
  expect(page.locator('#cards')).to_have_attribute('data-search-query','encodeopacity',timeout=60000)
  card=page.locator('.card').filter(has=page.locator('.card-title',has_text='Encode opacity'))
  if not card.count(): card=page.locator('.card').filter(has_text='Encode opacity')
  expect(card.first).to_be_visible(timeout=60000)
  card.first.locator('.card-top').hover(position={'x':40,'y':16});card.first.locator('.apply-button').click()
  expect(page.locator('#current')).to_have_attribute('data-steps',str(start+2),timeout=60000)
  before_action_resize=geometry()
  drag('plot-s',0,12,start+3);final=drag('plot-e',10,0,start+3)
  expect(page.locator('#history .history-item')).to_have_count(4)
  page.locator('#undo').click();expect(page.locator('#current')).to_have_attribute('data-steps',str(start+2),timeout=60000)
  assert geometry()==before_action_resize
  # Branching after Undo preserves the preceding group and drops the abandoned one.
  drag('canvas-s',0,10,start+3)
  expect(page.locator('#history .history-item')).to_have_count(4)
  expect(page.locator('#redo')).to_be_disabled()
  Path('output/resize-history').mkdir(parents=True,exist_ok=True)
  page.screenshot(path=f'output/resize-history/{"facet" if facet else "unit"}.png')
  assert not errors,errors
  print('PASS', 'facet' if facet else 'unit','four coalesced drags, bounded code/trace, cancel, Undo/Redo, reload, action boundary, branching',flush=True)
  context.close()
 browser.close()
