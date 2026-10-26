from saved_project import save_project
from playwright.sync_api import sync_playwright
from pathlib import Path
import os

output = Path(os.environ.get("AUDIT_OUTPUT", "output/composition-guides")).resolve()
output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True, **({'executable_path': os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']} if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') else {}))
 page=b.new_page(viewport={'width':1700,'height':1080}); page.set_default_timeout(45000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def apply(card):
  card.hover(); card.locator('.apply-button').click(); page.wait_for_function("!document.querySelector('#undo').disabled")
 def search(group,query):
  page.locator('#group-'+group).click(); page.locator('#action-search').fill(query);page.wait_for_timeout(1800)
 def save(path):
  save_project(page, path)
 page.goto(os.environ.get('APP_URL', 'http://127.0.0.1:5173/'));page.locator('#dataset').select_option('barley')
 for field in ['variety','yield','site']:page.get_by_role('button',name='Select column '+field,exact=True).click()
 page.locator('#cards .card').first.wait_for()
 for _ in range(10):
  card=page.locator('.card[data-method="createLinePlot"]').first
  if card.is_visible():break
  if page.locator('#cards-next').is_disabled():break
  page.locator('#cards-next').click();page.wait_for_timeout(700)
 apply(card); search('transform','filter series')
 card=page.locator('.card[data-method="filterMarks"]').filter(has=page.locator('h3',has_text='Filter series')).first
 page.wait_for_timeout(1000);card.hover();page.wait_for_timeout(400); group=card.locator('.control').filter(has=page.locator('span',has_text='Keep series'))
 buttons=group.locator('.parameter-choice'); labels=buttons.all_text_contents();print('SERIES',labels,flush=True)
 assert 'Select all' in labels and len(labels)>=4
 # First item is initially selected. Add the next two series with clicks.
 buttons.nth(2).click();buttons.nth(3).click()
 assert len(group.locator('button[aria-pressed="true"]').all())==3
 page.screenshot(path=str(output / 'filter-series-three.png'));apply(card);save(str(output / 'filter-three.json'))
 # Applied filter remains available with the original six series and Select all.
 search('transform','filter series');card=page.locator('.card[data-method="filterMarks"]').filter(has=page.locator('h3',has_text='Filter series')).first
 card.hover();page.wait_for_timeout(400);card.get_by_role('button',name='Select all',exact=True).click();apply(card);save(str(output / 'filter-all.json'))
 page.locator('#current-shell').hover();page.get_by_role('button',name='Add chart right',exact=True).click()
 apply(page.locator('.card[data-method="createAdjacentPlot"]').filter(has=page.locator('h3',has_text='Bar')).first)
 page.locator('#editing-target').get_by_role('button',name='All',exact=True).click();search('style','add title')
 card=page.locator('.card[data-method="createTitle"]').first;card.hover();page.wait_for_timeout(400)
 card.get_by_role('textbox',name='Add a title: Title',exact=True).fill('A long overall title that spans both adjacent charts and continues into a second line without clipping')
 apply(card);save(str(output / 'overall-title.json'))
 page.locator('h1').hover();page.screenshot(path=str(output / 'overall-title.png'))
 search('style','background');card=page.locator('.card[data-method="editCanvas"]').first
 card.hover();card.get_by_role('button',name='Color #e5e7eb',exact=True).click();apply(card);save(str(output / 'overall-background.json'))
 page.locator('h1').hover();page.screenshot(path=str(output / 'overall-background.png'))
 assert not errors,errors
 page.locator('#editing-target').get_by_role('button',name='Bar',exact=True).click()
 page.locator('#view-mode [data-mode="transition"]').click()
 page.locator('#workspace-layout [data-layout="vertical"]').click()
 page.locator('#current-shell').hover();page.get_by_role('button',name='Add chart right: Bar',exact=True).click()
 page.locator('#adjacent-controls').wait_for();page.wait_for_timeout(1500)
 for width in [1700,1350]:
  page.set_viewport_size({'width':width,'height':1080});page.wait_for_timeout(500)
  page.screenshot(path=str(output / f'adjacent-layout-{width}.png'))
  assert page.locator('#adjacent-controls').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
  assert page.locator('.options-tools').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
  assert 'Inherited sharing:' not in page.locator('#adjacent-controls').inner_text()
 apply(page.locator('.card[data-method="createAdjacentPlot"]').filter(has=page.locator('h3',has_text='Bar')).first)
 save(str(output / 'third-chart.json'))
 page.locator('h1').hover();page.screenshot(path=str(output / 'third-chart.png'))
 assert not errors,errors
 print('PASS multi-selection, select all, overall title, background, third chart, responsive controls; no browser errors',flush=True)
 b.close()
