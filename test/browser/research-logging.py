"""Real app + gzip worker transport, isolated from all production accounts."""
import argparse,base64,gzip,json,time
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:5184');args=parser.parse_args()
expect.set_options(timeout=60000)
out=Path('output/research-validation');out.mkdir(parents=True,exist_ok=True)
user=dict(id='11111111-1111-4111-8111-111111111111',is_anonymous=True,email='',aud='authenticated',role='authenticated',app_metadata={},user_metadata={},identities=[],created_at='2026-10-26T10:00:00Z')
token='eyJhbGciOiJIUzI1NiJ9.'+base64.urlsafe_b64encode(json.dumps(dict(sub=user['id'],role='authenticated',is_anonymous=True,exp=int(time.time())+3600)).encode()).decode().rstrip('=')+'.signature'
profile=dict(id=user['id'],research_enabled=True,consent_version='history-only-v1',consent_revision=1)
batches=[];errors=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True);context=browser.new_context(viewport={'width':1600,'height':1050})
 context.route('**/api/config',lambda r:r.fulfill(content_type='application/json',body=json.dumps(dict(supabaseUrl='https://cloud-test.supabase.co',supabaseKey='sb_publishable_test',release='test'))))
 def transport(route):
  req=route.request;path=urlparse(req.url).path
  def reply(v):route.fulfill(content_type='application/json',body=json.dumps(v),headers={'Access-Control-Allow-Origin':args.url,'Access-Control-Allow-Headers':'*'})
  if req.method=='OPTIONS':return reply({})
  if path in ['/auth/v1/signup','/auth/v1/token']:return reply(dict(access_token=token,refresh_token='guest',expires_in=3600,token_type='bearer',user=user))
  if path=='/auth/v1/user':return reply(user)
  if path=='/rest/v1/profiles':return reply([profile])
  if path.endswith('/set_research_consent_v2'):
   profile.update(research_enabled=req.post_data_json['enabled'],consent_revision=profile['consent_revision']+1,consent_version='recommendation-research-v2');return reply(profile)
  assert '/rpc/save_project' not in path and '/storage/' not in path
  return reply({})
 context.route('https://cloud-test.supabase.co/**',transport)
 def ingest(route):
  req=route.request;raw=req.post_data_buffer
  if req.headers.get('content-encoding')=='gzip':raw=gzip.decompress(raw)
  batch=json.loads(raw);batch['participant_id']='fixture-participant';batch['release']='test';batches.append(batch)
  route.fulfill(content_type='application/json',body=json.dumps({'ok':True,'id':batch['id']}))
 context.route('**/api/research',ingest)
 page=context.new_page();page.set_default_timeout(60000);page.on('pageerror',lambda e:errors.append(str(e)))
 try:
  page.goto(args.url);page.locator('#auth-guest').click();expect(page.locator('#dataset')).to_be_enabled()
  expect(page.get_by_role('dialog')).to_have_count(0) # legacy opt-in is carried forward
  page.locator('#dataset').select_option('cars')
  for field in ['Horsepower','Miles_per_Gallon','Origin']:page.get_by_role('button',name='Select column '+field,exact=True).click()
  card=page.locator('.card[data-method="createScatterPlot"]').first;expect(card).to_be_visible();card.locator('.card-top').hover();card.locator('.apply-button').click()
  expect(page.locator('#history')).to_have_attribute('aria-busy','false');page.locator('.app-header h1').hover()
  page.locator('#action-search').fill('encodeOpacity');expect(page.locator('#cards')).to_have_attribute('data-search-query','encodeopacity')
  card=page.locator('.card[data-method="encodeOpacity"]').first;expect(card).to_be_visible();card.locator('.card-top').hover()
  slider=card.locator('input[type=range]').first;expect(slider).to_be_visible();slider.focus();page.keyboard.press('End');page.keyboard.press('ArrowLeft')
  card.locator('.apply-button').click();expect(page.locator('#history')).to_have_attribute('aria-busy','false');page.locator('.app-header h1').hover()
  page.get_by_role('button',name='Graph View',exact=True).click();page.keyboard.press('Control+z');expect(page.locator('#history')).to_have_attribute('aria-busy','false')
  page.keyboard.press('Control+Shift+z');expect(page.locator('#history')).to_have_attribute('aria-busy','false')
  page.wait_for_timeout(6500)
  assert batches,'No research batches sent'
  events=[e for b in batches for e in b['events']];kinds={e['k'] for e in events}
  assert {0,1,2,3,4,5,6,7,8,9,10,11}.issubset(kinds),kinds
  raw=json.dumps(batches);assert 'encodeOpacity' in raw and 'Horsepower' in raw
  assert 'chevrolet' not in raw and 'access_token' not in raw and 'refresh_token' not in raw
  page.screenshot(path=str(out/'editor.png'))
  (out/'batches.json').write_text(json.dumps(batches))
  assert not errors,errors
  print('PASS real app: inherited consent, actual exposures, controls, keyboard parameters, apply, graph undo/redo, gzip worker delivery; events=',len(events),flush=True)
 finally:
  if errors:print('Errors:',errors)
  context.close();browser.close()
