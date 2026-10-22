"""Fine sliders use short smoothing; structural sliders and card changes retain full motion."""
import re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
 page=b.new_page(viewport={'width':1800,'height':1200},reduced_motion='no-preference');errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:5173/');page.wait_for_load_state('networkidle')
 for f in ['Horsepower','Miles_per_Gallon','Origin']:page.get_by_role('button',name='Select column '+f,exact=True).click()
 page.get_by_role('button',name='Transition mode',exact=True).click()
 card=page.locator('.card[data-method=createScatterPlot]');expect(card).to_be_visible(timeout=60000)
 card.locator('.card-top').hover(position={'x':35,'y':16});card.locator('.apply-button').click()
 expect(page.locator('#current')).to_have_attribute('data-steps','1',timeout=60000)
 def pick(method):
  page.locator('#action-search').fill(method)
  expect(page.locator('#cards')).to_have_attribute('data-search-query',method.lower(),timeout=60000)
  expect(page.locator('.card-row').first).to_have_attribute('aria-busy','false',timeout=60000)
  card=page.locator('.card[data-method='+method+']');expect(card).to_be_visible(timeout=60000)
  card.locator('.card-top').hover(position={'x':35,'y':16})
  expect(card).to_have_class(re.compile('expanded'))
  expect(page.locator('.transition-surface')).to_have_attribute('data-duration','300',timeout=60000)
  return card
 card=pick('encodeOpacity')
 fixed=card.get_by_role('button',name='Fixed',exact=True)
 if fixed.count() and fixed.get_attribute('aria-pressed')!='true':fixed.click()
 slider=card.locator('input[type=range]').first;expect(slider).to_be_visible(timeout=60000)
 slider.focus();slider.press('ArrowLeft')
 expect(page.locator('.transition-surface')).to_have_attribute('data-duration','80',timeout=60000)
 expect(page.locator('.transition-surface canvas')).to_have_attribute('data-animating','false',timeout=10000)
 # Resume hover-following after keyboard pins the value, then repeatedly retarget.
 slider.press('Enter');r=slider.bounding_box()
 for f in [.3,.7,.4,.8]:page.mouse.move(r['x']+r['width']*f,r['y']+r['height']/2)
 expect(page.locator('.transition-surface')).to_have_attribute('data-duration','80',timeout=60000)
 expect(page.locator('.transition-surface canvas')).to_have_attribute('data-animating','false',timeout=10000)
 page.locator('h1').hover();expect(page.locator('.transition-surface')).to_have_count(0,timeout=10000)
 card=pick('facet')
 slider=card.get_by_role('slider',name=re.compile('.*[Cc]olumn.*'))
 expect(slider).to_be_visible(timeout=60000);slider.focus();slider.press('ArrowLeft')
 expect(page.locator('.transition-surface')).to_have_attribute('data-duration','300',timeout=60000)
 expect(page.locator('.transition-surface canvas')).to_have_attribute('data-animating','false',timeout=10000)
 page.get_by_role('button',name='Preview mode',exact=True).click()
 assert page.locator('#preview').is_visible()
 assert not errors,errors
 print('PASS opacity keyboard + fast hover: 80ms; facet columns/card entry: 300ms; Preview mode retained',flush=True)
 b.close()
