"""Native charts + history UI: branching, half-size cards, navigation and zoom."""
import argparse, json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:5184');args=parser.parse_args()
out=Path('output/history-graph');out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':1500,'height':1000},device_scale_factor=2)
 page.set_default_timeout(30000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 try:
  page.goto(args.url+'/test/fixtures/history-graph.html');page.wait_for_load_state('networkidle')
  expect(page.locator('.history-list .history-item')).to_have_count(4)
  linear=page.locator('.history-list .history-item').first.bounding_box()
  page.get_by_role('button',name='Graph View',exact=True).click()
  expect(page.locator('.history-graph-node')).to_have_count(5)
  graph=page.locator('.history-graph-node').first.bounding_box()
  assert abs(graph['width']/linear['width']-.5)<.005,(linear,graph)
  assert abs(graph['height']/linear['height']-.5)<.005,(linear,graph)
  page.wait_for_function("document.querySelectorAll('.history-graph-node canvas[data-paint]').length===5")
  old=page.evaluate('harness.old');active=page.evaluate('harness.h.activeId')
  old_node=page.locator(f'[data-node-id="{old}"]')
  old_node.hover();page.wait_for_function('harness.inspected?.calls.at(-1).method==="facet"')
  assert page.evaluate('harness.h.activeId')==active
  page.locator('.history-graph').hover(position={'x':6,'y':6})
  page.wait_for_function('harness.inspected===null')
  old_node.click();page.wait_for_function('(id)=>harness.h.activeId===id',arg=old)
  page.locator('#opacity').click();assert page.evaluate('harness.h.nodes.length')==6
  page.locator('#undo').click();assert page.evaluate('harness.h.activeId')==old
  page.locator('#redo').click();assert page.evaluate('harness.h.entries[harness.h.index].currentNote')=='Opacity · 0.4'
  page.evaluate('harness.roundtrip()');assert page.evaluate('harness.h.nodes.length')==6
  page.get_by_role('button',name='Zoom in history graph',exact=True).click()
  expect(page.locator('.history-graph')).to_have_attribute('data-zoom','1.25')
  page.get_by_role('button',name='Reset history graph zoom',exact=True).click()
  page.locator('.history-graph').hover(position={'x':250,'y':30});page.keyboard.down('Control');page.mouse.wheel(0,-50)
  page.wait_for_function('Number(document.querySelector(".history-graph").dataset.zoom)>1.1');page.keyboard.up('Control')
  page.get_by_role('button',name='Reset history graph zoom',exact=True).click()
  page.screenshot(path=str(out/'graph-branches.png'))
  page.locator('.history-graph-node[aria-current]').focus();page.keyboard.press('ArrowLeft');page.wait_for_function('harness.inspected?.currentNote==="Facet · c"')
  page.keyboard.press('Escape');page.wait_for_function('harness.inspected===null')
  page.get_by_role('button',name='Linear View',exact=True).click()
  expect(page.locator('.history-list .history-item')).to_have_count(5)
  page.get_by_role('button',name='Graph View',exact=True).click();page.reload();page.wait_for_load_state('networkidle')
  expect(page.get_by_role('button',name='Graph View',exact=True)).to_have_attribute('aria-pressed','true')
  page.evaluate('harness.stress()');page.wait_for_function('document.querySelector(".history-graph").dataset.nodeCount==="1005"')
  assert page.locator('.history-graph-node').count()<50
  page.locator('.history-graph').evaluate('(e)=>{e.scrollTop=0;e.scrollLeft=0}')
  page.wait_for_function('document.querySelector(".history-graph").scrollTop===0')
  assert page.locator('.history-graph-node').count()<50
  canvas=page.locator('.history-graph-edges');assert canvas.evaluate('e=>e.height')<600
  page.locator('.history-graph').hover(position={'x':800,'y':20});page.mouse.wheel(0,300)
  page.wait_for_function('document.querySelector(".history-graph").scrollTop>0')
  page.screenshot(path=str(out/'graph-stress.png'))
  page.get_by_role('button',name='Fit history graph',exact=True).click();page.wait_for_function('Number(document.querySelector(".history-graph").dataset.zoom)<.5')
  assert page.locator('.history-graph-node').count()==0
  page.locator('.history-graph').dblclick(position={'x':200,'y':50});expect(page.locator('.history-graph')).to_have_attribute('data-zoom','1')
  assert not errors,errors
  print('PASS graph/linear, exact 50% dimensions, native thumbnails, hover/leave, branch jumps, undo/redo, roundtrip, zoom, scroll, 1005 nodes virtualized, account-free local preference reload')
 except Exception:
  page.screenshot(path=str(out/'failure.png'));print('Errors:',errors);raise
 finally:browser.close()
