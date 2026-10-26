"""History branches through the full editor with isolated guest auth transport."""
import argparse, base64, json, time
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
from saved_project import READ_ACCOUNT_PROJECT
parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:5184');args=parser.parse_args()
expect.set_options(timeout=60000)
out=Path('output/history-graph');out.mkdir(parents=True,exist_ok=True)
user=dict(id='11111111-1111-4111-8111-111111111111',is_anonymous=True,email='',aud='authenticated',role='authenticated',app_metadata={},user_metadata={},identities=[],created_at='2026-10-26T10:00:00Z')
token='eyJhbGciOiJIUzI1NiJ9.'+base64.urlsafe_b64encode(json.dumps(dict(sub=user['id'],role='authenticated',is_anonymous=True,exp=int(time.time())+3600)).encode()).decode().rstrip('=')+'.signature'
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 for mode in ['transition','preview']:
  context=browser.new_context(viewport={'width':1600,'height':1050},device_scale_factor=2)
  context.add_init_script("localStorage.setItem('vis-autocomplete.view-mode',"+json.dumps(mode)+");")
  context.route('**/api/config',lambda r:r.fulfill(content_type='application/json',body=json.dumps(dict(supabaseUrl='https://cloud-test.supabase.co',supabaseKey='sb_publishable_test'))))
  def transport(route):
   req=route.request;path=urlparse(req.url).path;body=req.post_data_json if req.post_data and 'application/json' in req.headers.get('content-type','') else {}
   def reply(v):route.fulfill(content_type='application/json',body=json.dumps(v),headers={'Access-Control-Allow-Origin':args.url,'Access-Control-Allow-Headers':'*'})
   if req.method=='OPTIONS':return reply({})
   if path in ['/auth/v1/signup','/auth/v1/token']:return reply(dict(access_token=token,refresh_token='guest',expires_in=3600,token_type='bearer',user=user))
   if path=='/auth/v1/user':
    if req.method=='PUT':user['user_metadata'].update(body.get('data',{}))
    return reply(user)
   if path=='/rest/v1/profiles':return reply([dict(id=user['id'],research_enabled=False,consent_version='history-only-v1',consent_revision=1)])
   assert '/rpc/save_project' not in path and '/storage/' not in path,'Guest must not write private data'
   return reply({})
  context.route('https://cloud-test.supabase.co/**',transport)
  page=context.new_page();page.set_default_timeout(60000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  def ready():
   expect(page.locator('#history')).to_have_attribute('aria-busy','false')
   page.locator('.app-header h1').hover()
  def saved():
   return page.evaluate(READ_ACCOUNT_PROJECT)
  def apply(method,group='encoding'):
   print('Applying',mode,method,flush=True)
   ready();page.locator('#group-'+group).click();page.locator('#action-search').fill(method)
   page.wait_for_function('(method)=>document.querySelector("#cards").dataset.searchQuery===method.toLowerCase()',arg=method)
   page.wait_for_function('document.querySelector("#cards .card-row")?.getAttribute("aria-busy")==="false"')
   card=page.locator(f'.card[data-method="{method}"]').first
   expect(card).to_be_visible();card.locator('.card-top').hover();expect(card.locator('.apply-button')).to_be_enabled();card.locator('.apply-button').click()
   ready();page.wait_for_timeout(250)
  try:
   page.goto(args.url);page.wait_for_load_state('networkidle');page.locator('#auth-guest').click()
   expect(page.locator('#dataset')).to_be_enabled();page.locator('#dataset').select_option('cars')
   for field in ['Horsepower','Miles_per_Gallon','Origin']:
    page.get_by_role('button',name='Select column '+field,exact=True).click()
   scatter=page.locator('.card[data-method="createScatterPlot"]').first
   expect(scatter).to_be_visible();scatter.locator('.card-top').hover();scatter.locator('.apply-button').click();ready()
   apply('encodeOpacity');page.get_by_role('button',name='Graph View',exact=True).click()
   page.wait_for_function('document.querySelector(".history-graph").dataset.nodeCount==="3"')
   project=saved();session=project['datasets'][0]['session'];old=session['graph']['activeId'];fork=session['graph']['nodes'][1]['id']
   page.locator(f'.history-graph-node[data-node-id="{fork}"]').click();ready()
   apply('encodeSize');page.wait_for_function('document.querySelector(".history-graph").dataset.nodeCount==="4"')
   session=saved()['datasets'][0]['session'];assert len(session['entries'])==4;new=session['graph']['activeId'];assert new!=old
   page.locator(f'.history-graph-node[data-node-id="{old}"]').click();ready()
   assert saved()['datasets'][0]['session']['graph']['activeId']==old
   assert 'encodeOpacity' in page.locator('#code-content').inner_text();assert 'encodeSize' not in page.locator('#code-content').inner_text()
   page.locator(f'.history-graph-node[data-node-id="{new}"]').click();ready()
   page.keyboard.press('Control+z');ready();assert saved()['datasets'][0]['session']['graph']['activeId']==fork
   page.keyboard.press('Control+Shift+z');ready();assert saved()['datasets'][0]['session']['graph']['activeId']==new
   apply('facet','encoding');page.wait_for_function('document.querySelector(".history-graph").dataset.nodeCount==="5"')
   # An abandoned branch and the chosen facet path both survive a real draft reload.
   before=saved()['datasets'][0]['session']['graph'];page.reload();page.wait_for_load_state('networkidle');ready()
   expect(page.get_by_role('button',name='Graph View',exact=True)).to_have_attribute('aria-pressed','true')
   page.wait_for_function('document.querySelector(".history-graph").dataset.nodeCount==="5"')
   assert saved()['datasets'][0]['session']['graph']==before
   expect(page.locator('#current canvas').first).to_be_visible()
   page.locator(f'.history-graph-node[data-node-id="{old}"]').hover();page.wait_for_function('document.querySelector("#code-mode").textContent.startsWith("History")')
   # Follow the real editor's preview state through node gaps. Neither mode
   # may request a Current frame between history previews, including re-entry.
   a=page.locator(f'.history-graph-node[data-node-id="{fork}"]').bounding_box()
   b=page.locator(f'.history-graph-node[data-node-id="{old}"]').bounding_box()
   gap=((a['x']+a['width']+b['x'])/2,b['y']+b['height']/2)
   page.evaluate('''()=>{window.previewModes=[];const el=document.querySelector('#code-mode');
    window.modeObserver=new MutationObserver(()=>previewModes.push(el.textContent));
    modeObserver.observe(el,{childList:true,characterData:true,subtree:true});}''')
   for box,ordinal in [(a,1),(b,2),(a,1),(a,1),(b,2)]:
    page.mouse.move(*gap);page.wait_for_timeout(50)
    page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
    expect(page.locator('#code-mode')).to_have_text('History #'+str(ordinal))
   page.wait_for_timeout(230)
   trace=page.evaluate('modeObserver.disconnect();previewModes')
   assert trace and all(value.startswith('History #') for value in trace),trace
   page.locator('.history-graph').hover(position={'x':4,'y':4});page.wait_for_function('!document.querySelector("#code-mode").textContent.startsWith("History")')
   page.screenshot(path=str(out/f'app-{mode}.png'))
   page.get_by_role('button',name='Linear View',exact=True).click();expect(page.locator('.history-list .history-item')).to_have_count(4)
   # Changing the original field selection creates a new branch instead of losing authored charts.
   page.locator('.history-list .history-item').first.click();ready();page.get_by_role('button',name='Select column Acceleration',exact=True).click();ready()
   assert len(saved()['datasets'][0]['session']['entries'])==6
   page.get_by_role('button',name='Graph View',exact=True).click();page.wait_for_function('document.querySelector(".history-graph").dataset.nodeCount==="6"')
   assert not errors,errors
   print('PASS full editor',mode,': Apply branch, exact code, keyboard undo/redo, facet, guest draft reload, saved mode, uninterrupted node hover, hover clear, variable-selection branch',flush=True)
  except Exception:
   page.screenshot(path=str(out/f'app-failure-{mode}.png'));print('Errors:',errors);raise
  finally:context.close()
 browser.close()
