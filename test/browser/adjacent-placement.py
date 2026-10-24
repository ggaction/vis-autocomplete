"""Exercise panel/group placement through the same controls used by chart authors."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright, expect

output = Path(os.environ.get('AUDIT_OUTPUT', 'output/adjacent-placement')).resolve()
output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({'executable_path': os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']} if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') else {}))
    page = browser.new_page(viewport={'width': 1700, 'height': 1100})
    page.set_default_timeout(45000)
    expect.set_options(timeout=45000)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(os.environ.get('APP_URL', 'http://127.0.0.1:5173/'))
    page.wait_for_load_state('networkidle')

    def find_card(method, title=None):
        page.locator('#cards .card').first.wait_for()
        for _ in range(20):
            cards = page.locator(f'.card[data-method="{method}"]')
            if title:
                cards = cards.filter(has=page.locator('h3', has_text=title))
            if cards.count() and cards.first.is_visible():
                return cards.first
            page.locator('#cards-next').click()
            page.wait_for_timeout(400)
        raise AssertionError(f'Missing {method} {title}')

    def apply(card):
        card.hover()
        expect(card.locator('.apply-button')).to_be_enabled()
        card.locator('.apply-button').click()
        expect(page.locator('#add-overlay')).to_be_enabled()

    def save(path):
        page.locator('.project-menu > summary').click()
        with page.expect_download() as download:
            page.locator('#save-project').click()
        download.value.save_as(str(path))
        page.locator('.project-menu > summary').click()

    baseline = os.environ.get('ADJACENT_BASELINE')
    if baseline:
        page.locator('#project-file').set_input_files(baseline)
    else:
        page.locator('#dataset').select_option('stocks')
        for field in ['date', 'price', 'symbol']:
            page.get_by_role('button', name='Select column ' + field, exact=True).click()
        apply(find_card('createAreaPlot'))
        page.locator('#current-shell').hover()
        page.get_by_role('button', name='Add chart right', exact=True).click()
        apply(find_card('createAdjacentPlot', 'Bar'))
        page.locator('#add-overlay').click()
        apply(find_card('createOverlay', 'Line'))
    expect(page.locator('.target-chart-group')).to_have_count(2)
    save(output / 'baseline.json')

    for mode, layout in ([] if os.environ.get('ADJACENT_RESTORE_ONLY') else [('preview', 'horizontal'), ('transition', 'vertical')]):
        page.locator(f'#view-mode [data-mode="{mode}"]').click()
        page.locator(f'#workspace-layout [data-layout="{layout}"]').click()
        for direction, prefix in [('left', 'Left of'), ('right', 'Right of'), ('top', 'Above'), ('bottom', 'Below')]:
            for scope in ['Area', 'Bar / Line', 'All charts']:
                page.locator('#current-shell').hover()
                handles = page.locator(f'.add-adjacent[data-position="{direction}"]:not([hidden])')
                assert 1 <= handles.count() <= 3
                if direction == 'bottom':
                    boxes = [page.get_by_role('button', name=f'Add chart bottom: {name}', exact=True).bounding_box() for name in ['Area', 'All charts', 'Bar / Line']]
                    assert boxes[0]['x'] < boxes[1]['x'] < boxes[2]['x']
                    assert boxes[1]['y'] > max(boxes[0]['y'], boxes[2]['y'])
                button = page.get_by_role('button', name=f'Add chart {direction}: {scope}', exact=True)
                # Equivalent outer panel/group edges intentionally retain only
                # the enclosing group. Invisible buttons must not capture hits.
                if not button.count():
                    continue
                box = button.bounding_box()
                page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
                expect(button).to_have_class('add-adjacent nearby')
                assert page.locator('.add-adjacent.nearby').count() == 1
                assert button.evaluate('''e => {
                    const a = e.getBoundingClientRect();
                    return document.elementFromPoint(a.x + a.width / 2, a.y + a.height / 2) === e &&
                        [...document.querySelectorAll('#current .resize-handle')].every(handle => {
                            const b = handle.getBoundingClientRect();
                            return Math.min(a.right, b.right) <= Math.max(a.left, b.left) ||
                                Math.min(a.bottom, b.bottom) <= Math.max(a.top, b.top);
                        });
                }'''), 'Add button must be independently clickable without covering a resize hit area'
                expect(page.locator('.adjacent-placement-highlight')).to_be_visible()
                if mode == 'transition' and direction == 'bottom' and scope == 'All charts':
                    page.screenshot(path=str(output / 'group-highlight.png'))
                button.click()
                expect(page.get_by_role('dialog')).to_have_count(0)
                controls = page.locator('#adjacent-controls')
                shared = 'Y' if direction in ['left', 'right'] else 'X'
                expect(controls.locator('label').filter(has_text=f'{shared} (shared)')).to_have_count(1)
                assert controls.get_by_role('combobox', name='Adjacent share', exact=True).count() == 0
                if scope == 'All charts':
                    source = controls.get_by_role('combobox', name='Adjacent data source')
                    assert source.locator('option').all_text_contents() == ['Area', 'Bar']
                    source.select_option(label='Area')
                    expect(source).to_have_value(source.locator('option').first.get_attribute('value'))
                card = find_card('createAdjacentPlot', 'Line')
                # Rapid card changes exercise interruptible Canvas previews without committing.
                card.hover()
                page.locator('#cards .card:visible').first.hover()
                card.hover()
                apply(card)
                expect(page.locator('.target-chart-group')).to_have_count(3)
                if direction == 'bottom' and scope == 'All charts':
                    page.locator('h1').hover()
                    page.screenshot(path=str(output / f'wide-bottom-{mode}.png'))
                    save(output / f'wide-bottom-{mode}.json')
                page.locator('#undo').click()
                expect(page.locator('.target-chart-group')).to_have_count(2)
                print(f'PASS {mode} {direction} {scope}', flush=True)
    # Reopen saved nested group and then exercise redo and nested placement discovery.
    expect(page.locator('#undo')).to_be_enabled()
    page.locator('#project-file').set_input_files(str(output / 'wide-bottom-transition.json'))
    expect(page.locator('.target-chart-group')).to_have_count(3)
    page.locator('#undo').click()
    expect(page.locator('.target-chart-group')).to_have_count(2)
    page.locator('#redo').click()
    expect(page.locator('.target-chart-group')).to_have_count(3)
    expect(page.locator('#draft-status')).to_have_text('Draft saved on this device')
    page.reload()
    expect(page.locator('.target-chart-group')).to_have_count(3)
    page.locator('#current-shell').hover()
    assert page.locator('.add-adjacent[data-position="right"]:not([hidden])').count() >= 1
    page.locator('h1').hover()
    assert page.locator('.add-adjacent.nearby').count() == 0
    expect(page.locator('.adjacent-placement-highlight')).to_have_count(0)
    assert not errors, errors
    print('PASS saved project, refresh, undo/redo, nested choices; no page errors', flush=True)
    browser.close()
