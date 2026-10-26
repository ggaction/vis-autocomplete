"""History raster reuse under cursor changes, coalesced edits and long graphs."""
import argparse, json
from pathlib import Path
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser()
parser.add_argument('--url',default='http://127.0.0.1:5187')
parser.add_argument('--baseline-source',type=Path)
parser.add_argument('--output',type=Path,default=Path('output/history-performance/history-after.json'))
args=parser.parse_args();args.output.parent.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':1800,'height':1100},device_scale_factor=2)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 if args.baseline_source:
  page.route('**/web/history-graph-view.js',lambda route:route.fulfill(content_type='text/javascript',body=args.baseline_source.read_text()))
 page.goto(args.url+'/test/fixtures/history-graph.html');page.wait_for_load_state('networkidle')
 page.get_by_role('button',name='Graph View',exact=True).click()
 page.wait_for_function('document.querySelectorAll(".history-graph-node canvas[data-paint]").length===5')
 page.evaluate('''()=>{
  window.perfAudit={nodes:new Map([...document.querySelectorAll('.history-graph-node')].map(n=>[n.dataset.nodeId,n])),added:0,paints:harness.historyPaints};
  new MutationObserver(changes=>{for(const c of changes)for(const n of c.addedNodes)if(n.classList?.contains('history-graph-node'))perfAudit.added++}).observe(document.querySelector('.history-graph-nodes'),{childList:true});
 }''')
 durations=page.evaluate('''async()=>{
  const out=[];
  for(let i=0;i<40;i++){
   const start=performance.now();harness.h.jump(i%2?harness.fork:harness.old);harness.view.update(harness.h,Boolean(i%3));
   await new Promise(requestAnimationFrame);out.push(performance.now()-start);
  }
  harness.view.update(harness.h,false);await new Promise(requestAnimationFrame);return out;
 }''')
 result=page.evaluate('''()=>({replaced:[...perfAudit.nodes].filter(([id,n])=>document.querySelector(`[data-node-id="${id}"]`)!==n).length,
  added:perfAudit.added,paints:harness.historyPaints-perfAudit.paints,
  canvases:document.querySelectorAll('.history-graph-node canvas[data-paint]').length})''')
 result['cursorFrameMs']=durations
 if not args.baseline_source:
  assert result['replaced']==0,result
  assert result['added']==0,result
  assert result['paints']==0,result
  # Replacing the active leaf changes just its thumbnail, never its ancestors.
  page.evaluate('harness.appendAt(harness.old,{method:"encodeOpacity",args:{target:"plot",value:.4}},"Before replacement")')
  page.wait_for_function('document.querySelector(".history-graph-node[aria-current] canvas[data-paint]")')
  before=page.evaluate('''()=>{perfAudit.before=new Map([...document.querySelectorAll('.history-graph-node')].map(n=>[n.dataset.nodeId,n]));return harness.h.activeId}''')
  page.evaluate('''()=>{const s=harness.h.current;harness.h.replace({...s,currentNote:'Replaced resize',view:s.view.editFacetSource({action:{method:'encodeOpacity',options:{target:'plot',value:.6}}})});harness.view.update(harness.h)}''')
  page.wait_for_function('document.querySelector(".history-graph-node[aria-current]")?.textContent.includes("Replaced resize")')
  assert page.evaluate('''id=>[...perfAudit.before].filter(([key,node])=>key!==id).every(([key,node])=>document.querySelector(`[data-node-id="${key}"]`)===node)''',before)
  page.evaluate('harness.stress()')
  page.wait_for_function('document.querySelector(".history-graph").dataset.nodeCount==="1006"')
  assert page.locator('.history-graph-node').count()<50
  page.get_by_role('button',name='Linear View',exact=True).click()
  page.get_by_role('button',name='Graph View',exact=True).click()
  assert page.locator('.history-graph-node').count()<50
 assert not errors,errors
 page.screenshot(path=str(args.output.with_suffix('.png')))
 browser.close()
args.output.write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
