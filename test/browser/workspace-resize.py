"""Panel divider geometry, persistence, reset, folding and live chart identity."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
OUT=Path('output/workspace-resize');OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
 for width in [1800,980,620]:
  page=browser.new_page(viewport={'width':width,'height':1100});errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
  for field in ['Horsepower','Miles_per_Gallon','Origin']:
   page.get_by_role('button',name='Select column '+field,exact=True).click()
  card=page.locator('.card[data-method=createScatterPlot]');expect(card).to_be_visible(timeout=60000)
  card.locator('.card-top').hover(position={'x':30,'y':16});card.locator('.apply-button').click()
  expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
  expect(page.locator('.card-row').first).to_have_attribute('aria-busy','false',timeout=60000)
  page.locator('h1').hover()
  page.evaluate("window.savedCanvas=document.querySelector('#current canvas');window.savedCard=document.querySelector('.card');window.savedSource=null")
  canonical=page.evaluate("async()=> (await import('/web/code-view.js')).displayedCode(document.querySelector('#code-content'))")
  for mode in ['preview','transition']:
   page.locator(f'#view-mode [data-mode={mode}]').click()
   for layout in ['horizontal','vertical']:
    page.locator(f'#workspace-layout [data-layout={layout}]').click();page.wait_for_timeout(150)
    for name in ['code','primary','history']+(['views'] if mode=='preview' else []):
     handle=page.locator(f'[data-divider={name}]');expect(handle).to_be_visible()
     before=handle.bounding_box();axis=handle.get_attribute('data-axis')
     x=before['x']+before['width']/2;y=before['y']+before['height']/2
     page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+(65 if axis=='x' else 0),y+(35 if axis=='y' else 0),steps=10);page.mouse.up()
     page.wait_for_timeout(150);after=handle.bounding_box()
     delta=abs(after['x']-before['x']) if axis=='x' else abs(after['y']-before['y'])
     assert delta>5,(width,mode,layout,name,axis,before,after)
     assert page.evaluate("savedCanvas===document.querySelector('#current canvas') && savedCard===document.querySelector('.card')")
     expect(page.locator('#current')).to_have_attribute('data-steps','1')
     assert page.evaluate("async()=> (await import('/web/code-view.js')).displayedCode(document.querySelector('#code-content'))")==canonical
     assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
    page.screenshot(path=str(OUT/f'{width}-{mode}-{layout}.png'))
    print('PASS drag',width,mode,layout,flush=True)
  # Restored size preferences survive reload and collapse/expand.
  saved=page.evaluate("localStorage.getItem('vis-autocomplete.workspace-sizes')")
  dimensions=page.locator('.authoring-area,.code-panel,.visualizations,.history-section').evaluate_all('(nodes)=>nodes.map(n=>[n.clientWidth,n.clientHeight])')
  page.reload();page.wait_for_load_state('networkidle')
  expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
  page.wait_for_timeout(200)
  restored=page.locator('.authoring-area,.code-panel,.visualizations,.history-section').evaluate_all('(nodes)=>nodes.map(n=>[n.clientWidth,n.clientHeight])')
  assert all(abs(a-b)<2 for old,new in zip(dimensions,restored) for a,b in zip(old,new)),(dimensions,restored)
  assert page.evaluate("localStorage.getItem('vis-autocomplete.workspace-sizes')")==saved
  for name in ['history','code']:
   page.locator(f'#toggle-{name}').click();expect(page.locator(f'[data-divider={name}]')).to_be_hidden()
   page.locator(f'#toggle-{name}').click();expect(page.locator(f'[data-divider={name}]')).to_be_visible()
  page.locator('#reset-view-sizes').click()
  assert page.evaluate("localStorage.getItem('vis-autocomplete.workspace-sizes')")=='{}'
  assert page.locator('.workspace,.authoring-area,.visualizations').evaluate_all("nodes=>nodes.every(n=>!n.style.gridTemplateColumns&&!n.style.gridTemplateRows)")
  # Keyboard resizing and cancel restore the same panel geometry.
  handle=page.locator('[data-divider=primary]');handle.focus();axis=handle.get_attribute('data-axis');before=handle.bounding_box()
  handle.press('ArrowRight' if axis=='x' else 'ArrowDown');page.wait_for_timeout(100)
  after=handle.bounding_box();assert abs(after['x']-before['x'])+abs(after['y']-before['y'])>5
  x=after['x']+after['width']/2;y=after['y']+after['height']/2
  page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+50,y+50,steps=5);page.keyboard.press('Escape');page.mouse.up();page.wait_for_timeout(150)
  canceled=handle.bounding_box();assert abs(canceled['x']-after['x'])+abs(canceled['y']-after['y'])<2
  assert not errors,errors
  print('PASS persistence, folding, reset, keyboard and cancel',width,flush=True)
  page.close()
 browser.close()
