"""Real editor: long histories, streamed later pages and cached hover endpoints."""
import argparse, base64, csv, json, time
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:5187');parser.add_argument('--baseline-assets',type=Path);parser.add_argument('--case',choices=['cars','bike']);parser.add_argument('--interrupt',action='store_true');parser.add_argument('--output',type=Path,default=Path('output/history-performance/session-after.json'));args=parser.parse_args()
args.output.parent.mkdir(parents=True,exist_ok=True)
user=dict(id='11111111-1111-4111-8111-111111111111',email='perf@example.org',aud='authenticated',role='authenticated',app_metadata={},user_metadata={},identities=[],created_at='2026-10-26T10:00:00Z')
token='eyJhbGciOiJIUzI1NiJ9.'+base64.urlsafe_b64encode(json.dumps(dict(sub=user['id'],role='authenticated',exp=int(time.time())+3600)).encode()).decode().rstrip('=')+'.signature'
def call(method,args):return dict(method=method,args=args)
def project(kind,length):
 if kind=='cars':
  rows=[r for r in json.loads(Path('web/data/cars.json').read_text()) if r['Horsepower'] is not None and r['Miles_per_Gallon'] is not None]
  fields=['Horsepower','Miles_per_Gallon','Origin']
  plot=call('createScatterPlot',dict(id='plot',data='dataset',x=fields[0],y=fields[1],color=dict(field=fields[2],fieldType='nominal'),missing='skip'))
 else:
  rows=[{k:float(v) if k!='dteday' else v for k,v in r.items()} for r in csv.DictReader(Path('web/data/bike-sharing.csv').open())]
  fields=['temp','hum','atemp','windspeed','casual']
  plot=call('createParallelCoordinates',dict(id='plot',data='dataset',dimensions=fields,line=dict(opacity=.55)))
 calls=[plot];setup=[call('createCanvas',dict(plot=dict(width=439.6 if kind!='cars' else 314,height=314),margin=dict(left=170,right=216,top=42,bottom=74))),call('createData',dict(id='dataset',values='__LOADED_DATA__'))]
 if kind!='cars':calls.append(call('facet',dict(field='yr',data='dataset',columns=2,guides=dict(axes='each',legend=False))))
 entries=[]
 for i in range(length):
  if i:
   action=call('encodeOpacity',dict(target='plot',value=.4 if i%2 else .6))
   if kind!='cars':action=call('editFacetSource',dict(action=dict(method=action['method'],options=action['args'])))
   calls=[*calls,action]
  entries.append(dict(setupCalls=setup,calls=calls,steps=len(calls),phase='recommendations',selection=dict(fields=fields),context=dict(target='plot'),plotData='dataset',optionGroup='encoding',currentNote=f'Edit {i}',guideCall=call('createGuides',{})))
 return dict(format='visualization-autocomplete',version=2,activeId='perf',datasets=[dict(id='perf',name=kind,imported=dict(rows=rows),session=dict(entries=entries,index=len(entries)-1))])
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 for mode,kind,length,rate in [('transition','cars',1,1),('transition','cars',50,1),('preview','cars',50,1),('transition','bike',35,1),('transition','cars',50,4)]:
  if args.case and kind!=args.case:continue
  if args.interrupt and (mode,kind,length,rate)!=('transition','cars',1,1):continue
  print('Start',mode,kind,length,rate,flush=True)
  context=browser.new_context(viewport={'width':1800,'height':1100},device_scale_factor=2)
  context.route('**/api/config',lambda route:route.fulfill(json=dict(supabaseUrl='https://perf-test.supabase.co',supabaseKey='sb_publishable_test')))
  def transport(route):
   path=urlparse(route.request.url).path
   value=dict(access_token=token,refresh_token='test',expires_in=3600,token_type='bearer',user=user) if path=='/auth/v1/token' else user if path=='/auth/v1/user' else [dict(id=user['id'],research_enabled=False,consent_version='recommendation-research-v2')] if path=='/rest/v1/profiles' else 1 if path.endswith('/rpc/save_project') else []
   route.fulfill(json=value)
  context.route('https://perf-test.supabase.co/**',transport)
  if args.baseline_assets:
   def asset(route):
    path=args.baseline_assets/urlparse(route.request.url).path.removeprefix('/output/')
    if path.is_file():route.fulfill(content_type='text/javascript',body=path.read_text())
    else:route.continue_()
   context.route('**/output/**/*.js',asset)
  context.add_init_script('''(()=>{const Original=Worker;window.workerRequests=[];window.Worker=class extends Original{postMessage(data,...rest){if(data.request)workerRequests.push({type:data.request.type,page:data.request.page,time:performance.now()});return super.postMessage(data,...rest)}}})()''')
  page=context.new_page();page.set_default_timeout(120000);errors=[];page.on('pageerror',lambda e:(errors.append(str(e)),print('UI ERROR',str(e),flush=True)))
  page.goto(args.url);page.wait_for_load_state('networkidle')
  page.get_by_label('Email',exact=True).fill(user['email']);page.get_by_label('Password',exact=True).fill('test-password');page.locator('#auth-submit').click()
  page.wait_for_function('document.querySelector("#account-button")?.textContent==="perf@example.org"');page.wait_for_load_state('networkidle')
  page.locator('#view-mode [data-mode='+mode+']').click()
  page.get_by_role('button',name='Graph View',exact=True).click()
  cdp=context.new_cdp_session(page);cdp.send('Emulation.setCPUThrottlingRate',dict(rate=rate))
  payload=project(kind,length)
  page.locator('#project-file').set_input_files(dict(name='performance.visauto',mimeType='application/json',buffer=json.dumps(payload).encode()))
  try:page.wait_for_function('document.querySelector(".card-row")?.getAttribute("aria-busy")==="false"',timeout=60000)
  except:
   print(page.locator('body').inner_text()[-4000:],flush=True);page.screenshot(path=str(args.output.parent/'failure.png'));raise
  page.wait_for_function('document.querySelectorAll(".card-row:first-child canvas[data-paint]").length>0')
  page.locator('.app-header h1').hover()
  for group in ['encoding','style']:
   if group!='encoding':page.locator('#group-'+group).click();page.wait_for_function('document.querySelector(".card-row")?.getAttribute("aria-busy")==="false"')
   if page.locator('#cards-next').is_disabled():continue
   page.evaluate('''()=>{window.pageAudit={start:performance.now(),seen:[],initialRequests:workerRequests.length};const row=document.querySelector('.card-row[data-page="2"]');window.pageObserver=new MutationObserver(()=>{const count=row.querySelectorAll('.card').length;if(!pageAudit.seen.length||pageAudit.seen.at(-1).count!==count)pageAudit.seen.push({count,ms:performance.now()-pageAudit.start,busy:row.getAttribute('aria-busy')});});pageObserver.observe(row,{childList:true,subtree:true});}''')
   page.locator('#cards-next').click()
   if args.interrupt and group=='encoding':
    page.wait_for_function('''document.querySelector('.card-row[data-page="2"] .card')''')
    page.evaluate('''window.partialCard=document.querySelector('.card-row[data-page="2"] .card')''')
    page.locator('#group-style').click()
    page.wait_for_function('document.querySelector(".card-row")?.getAttribute("aria-busy")==="false"')
    page.locator('#group-encoding').click()
    page.wait_for_function('document.querySelector("#cards").contains(window.partialCard)')
    # The saved scroll may be between pages when interrupted mid-scroll.
    page.locator('.card-row[data-page="2"]').scroll_into_view_if_needed()

   page.wait_for_function('''document.querySelector('.card-row[data-page="2"]')?.getAttribute('aria-busy')==='false' ''')
   page.wait_for_function('''()=>{const row=document.querySelector('.card-row[data-page="2"]');return row.querySelectorAll('.card canvas[data-paint]').length===row.querySelectorAll('.card:not(.disabled)').length}''')
   sample=page.evaluate('''()=>{pageObserver.disconnect();return {...pageAudit,requests:workerRequests.slice(pageAudit.initialRequests)}}''')
   sample.update(mode=mode,kind=kind,historyNodes=length,cpuRate=rate,group=group)
   assert sample['seen'][-1]['count']>0,sample
   assert page.locator('.card-row[data-page="2"]').evaluate("e=>{const a=[...e.querySelectorAll('.card')].map(n=>n.dataset.position);return new Set(a).size===a.length}")
   if args.interrupt and group=='encoding':assert page.evaluate('partialCard.isConnected')
   if not args.baseline_assets and sample['seen'][-1]['count']>1:
    assert any(0<s['count']<sample['seen'][-1]['count'] for s in sample['seen']),sample
   # A completed card hover uses its ready endpoint, without worker preparation.
   count=page.evaluate('workerRequests.length')
   cards=page.locator('.card-row[data-page="2"] .card:not(.disabled) .card-top')
   for i in range(cards.count()):cards.nth(i).hover();page.wait_for_timeout(40)
   sample['hoverRequests']=page.evaluate('(i)=>workerRequests.slice(i).map(r=>r.type)',count)
   assert not any(r in ['prepare','scene'] for r in sample['hoverRequests']),sample
   results.append(sample);print(mode,kind,length,rate,group,sample['seen'],flush=True)
   page.locator('.app-header h1').hover();page.locator('#cards-prev').click()
  assert not errors,errors
  page.screenshot(path=str(args.output.parent/f'{mode}-{kind}-{length}-{rate}.png'))
  context.close()
 browser.close()
args.output.write_text(json.dumps(results,indent=2))
