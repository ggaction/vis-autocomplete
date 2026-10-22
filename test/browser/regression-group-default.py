"""Cars categorical color remains the default regression group with/without facets."""
import json,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
 for faceted in [False,True]:
  ctx=browser.new_context(viewport={'width':1800,'height':1200});page=ctx.new_page();errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
  for f in ['Horsepower','Miles_per_Gallon','Origin']:page.get_by_role('button',name='Select column '+f,exact=True).click()
  scatter=page.locator('.card[data-method=createScatterPlot]');expect(scatter).to_be_visible(timeout=60000)
  scatter.locator('.card-top').hover(position={'x':35,'y':16});scatter.locator('.apply-button').click()
  step=1;expect(page.locator('#current')).to_have_attribute('data-steps',str(step),timeout=60000)
  if faceted:
   page.locator('#action-search').fill('facet')
   expect(page.locator('#cards')).to_have_attribute('data-search-query','facet',timeout=60000)
   expect(page.locator('.card-row').first).to_have_attribute('aria-busy','false',timeout=60000)
   card=page.locator('.card[data-method=facet]');expect(card).to_be_visible(timeout=60000)
   card.locator('.card-top').hover(position={'x':35,'y':16})
   # Ensure the reported facet variable, independent of the corpus default.
   field=card.locator('[data-parameter=field]').get_by_role('button',name='Origin',exact=True)
   expect(card).to_have_attribute('data-preview-state','ready',timeout=60000)
   if field.get_attribute('aria-pressed')!='true': field.click()
   card.locator('.apply-button').click();step+=1
   expect(page.locator('#current')).to_have_attribute('data-steps',str(step),timeout=60000)
  page.locator('#group-transform').click();page.locator('#action-search').fill('regression')
  expect(page.locator('#cards')).to_have_attribute('data-search-query','regression',timeout=60000)
  expect(page.locator('.card-row').first).to_have_attribute('aria-busy','false',timeout=60000)
  card=page.locator('.card').filter(has_text='Add regression');expect(card).to_be_visible(timeout=60000)
  card.locator('.card-top').hover(position={'x':35,'y':16})
  group=card.locator('[data-parameter=group]');expect(group).to_be_visible(timeout=60000)
  expect(group.get_by_role('button',name='Origin',exact=True)).to_have_attribute('aria-pressed','true')
  expect(card).to_have_attribute('data-preview-state','ready',timeout=60000)
  # Explicit all-observation choice remains possible, and returning to Origin pins it.
  group.get_by_role('button',name='All observations',exact=True).click()
  expect(group.get_by_role('button',name='All observations',exact=True)).to_have_attribute('aria-pressed','true')
  group.get_by_role('button',name='Origin',exact=True).click()
  card.locator('.apply-button').click();step+=1
  expect(page.locator('#current')).to_have_attribute('data-steps',str(step),timeout=60000)
  page.locator('h1').hover();page.locator('.project-menu summary').click()
  with page.expect_download() as d:page.locator('#save-project').click()
  project=json.loads(Path(d.value.path()).read_text());page.locator('.project-menu summary').click()
  current=next(ds for ds in project['datasets'] if ds['id']==project['activeId'])['session']
  calls=current['entries'][current['index']]['calls']
  reg=next(call for call in reversed(calls) if call['method']=='createRegression' or call['args'].get('action',{}).get('method')=='createRegression')
  options=reg['args']['action']['options'] if faceted else reg['args']
  assert options['groupBy']=='Origin',reg
  Path('output/regression-defaults').mkdir(parents=True,exist_ok=True)
  page.screenshot(path=f'output/regression-defaults/{"facet" if faceted else "scatter"}.png')
  assert not errors,errors
  print('PASS Cars', 'facet' if faceted else 'scatter','Origin default, explicit override, preview, Apply and saved native call',flush=True)
  ctx.close()
 browser.close()
