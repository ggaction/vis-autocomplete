"""Actual option cards on multiple datasets: rapid hover, parameters, Apply, Undo."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import json, os
cases=[('cars',['Horsepower','Miles_per_Gallon','Origin'],'createScatterPlot'),('barley',['variety','yield'],'createGradientPlot'),('iris',['Sepal.Width','Petal.Width','Species'],'createScatterPlot'),('tips',['sex','tip','smoker'],'createViolinPlot'),('sales',['Month','Sales','Region'],'createLinePlot')]
Path('output/transition-workflows').mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
 for dataset,fields,method in cases:
  if os.environ.get("DATASETS") and dataset not in os.environ["DATASETS"].split(","): continue
  page=b.new_page(viewport={'width':1600,'height':1100},reduced_motion='no-preference');errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
  page.locator('#dataset').select_option(dataset)
  for f in fields:page.get_by_role('button',name='Select column '+f,exact=True).click()
  card=page.locator(f'.card[data-method={method}]')
  for i in range(10):
   if card.is_visible():break
   page.wait_for_timeout(400)
   if card.is_visible():break
   nxt=page.locator('#cards-next')
   if nxt.is_enabled():nxt.click()
  expect(card).to_be_visible(timeout=60000)
  page.get_by_role('button',name='Transition mode',exact=True).click()
  card.locator('.card-top').hover(position={'x':40,'y':16})
  expect(page.locator('.transition-surface')).to_have_attribute('data-method',method,timeout=60000)
  card.locator('.apply-button').click();expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
  page.locator('h1').hover();expect(page.locator('.transition-surface')).to_have_count(0,timeout=10000)
  expect(page.locator('.card').first).to_be_visible(timeout=60000)
  page.wait_for_timeout(500)
  cards=page.locator('.card:visible');methods=cards.evaluate_all('(nodes)=>nodes.map(n=>n.dataset.method)')[:5]
  hits=0
  for j in range(30):
   c=page.locator(f'.card[data-method="{methods[j%len(methods)]}"]')
   rect=c.locator('.card-top').bounding_box();page.mouse.move(rect['x']+30,rect['y']+16);page.wait_for_timeout(35)
   if page.locator('.transition-surface').count():hits+=1
  expect(page.locator('#current')).to_have_attribute('data-steps','1')
  page.locator('h1').hover();expect(page.locator('.transition-surface')).to_have_count(0,timeout=10000)
  # Parameter hover, then apply the pinned default while a preview is moving.
  c=page.locator(f'.card[data-method="{methods[0]}"]');c.locator('.card-top').hover(position={'x':40,'y':16})
  choices=c.locator('.parameter-choice:visible')
  if choices.count()>1:
   for i in range(min(4,choices.count())):choices.nth(i).hover();page.wait_for_timeout(40)
  c.locator('.apply-button').click();expect(page.locator('#current')).to_have_attribute('data-steps','2',timeout=60000)
  page.locator('#undo').click();expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
  page.locator('h1').hover();page.screenshot(path=f'output/transition-workflows/{dataset}.png')
  assert not errors,(dataset,errors)
  assert hits>20,(dataset,hits)
  print(json.dumps({'dataset':dataset,'chart':method,'hoverMethods':methods,'rapidHoverFrames':hits,'status':'PASS'}),flush=True)
  page.close()
 b.close()
