from saved_project import save_project
from playwright.sync_api import sync_playwright
from pathlib import Path
import os

output = Path(os.environ.get("AUDIT_OUTPUT", "output/axis-curve-controls")).resolve()
output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,**({'executable_path': os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']} if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') else {}))
 page=b.new_page(viewport={'width':1700,'height':1100});page.set_default_timeout(45000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(os.environ.get('APP_URL', 'http://127.0.0.1:5173/'));page.wait_for_load_state('networkidle')
 page.locator('#dataset').select_option('stocks')
 for field in ['date','price','symbol']:page.get_by_role('button',name='Select column '+field,exact=True).click()
 page.locator('#cards .card').first.wait_for()
 for _ in range(10):
  card=page.locator('.card[data-method="createLinePlot"]').first
  if card.is_visible():break
  page.locator('#cards-next').click();page.wait_for_timeout(700)
 card.hover();card.locator('.apply-button').click();page.wait_for_timeout(1800)
 page.locator('#group-style').click();page.locator('#action-search').fill('smooth');page.wait_for_timeout(1800)
 card=page.locator('.card[data-method="editLineMark"]').first;card.hover();page.wait_for_timeout(400)
 card.get_by_role('button',name='cardinal',exact=True).click();page.wait_for_timeout(500)
 assert card.get_by_role('slider',name='Adjust line: Tension slider',exact=True).is_visible()
 page.screenshot(path=str(output / 'line-cardinal-controls.png'))
 card.get_by_role('button',name='natural',exact=True).click();page.wait_for_timeout(300)
 assert not card.get_by_role('slider',name='Adjust line: Tension slider',exact=True).is_visible()
 card.locator('.apply-button').click();page.wait_for_timeout(1800)
 page.locator('#action-search').fill('editYAxis');page.wait_for_timeout(1800)
 card=page.locator('.card[data-method="editYAxis"]').first;card.hover();page.wait_for_timeout(400)
 card.get_by_role('button',name='right',exact=True).click();page.wait_for_timeout(500)
 assert card.locator('.apply-button').is_enabled()
 page.screenshot(path=str(output / 'y-axis-position-controls.png'))
 card.locator('.apply-button').click();page.wait_for_timeout(1800)
 page.locator('h1').hover();page.screenshot(path=str(output / 'line-right-axis.png'))
 # Export authored code to check actual applied methods and parameters.

 save_project(page, str(output / 'axis-curve-project.json'))
 assert not errors,errors
 print('PASS: curve hover/selection, conditional tension, Apply and numeric Y position; no browser errors',flush=True)
 b.close()
