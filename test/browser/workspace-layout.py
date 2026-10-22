"""Real options in both orientations: fixed half-height bands and live controls."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright, expect

OUT = Path('output/workspace-layout')
OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    for width, height in [(1600, 1100), (1440, 900), (2560, 1440), (980, 900)]:
        context = browser.new_context(viewport={'width': width, 'height': height}, device_scale_factor=2)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script('''{
          const W = window.Worker; window.rankRequests = 0;
          window.Worker = class extends W { postMessage(m, ...args) {
            if (m?.request?.type === 'recommend') rankRequests++;
            super.postMessage(m, ...args);
          }};
        }''')
        page.goto('http://127.0.0.1:5173/')
        page.wait_for_load_state('networkidle')
        workspace = page.locator('.workspace')
        expect(workspace).to_have_attribute('data-layout', 'horizontal')
        for field in ['Horsepower', 'Miles_per_Gallon', 'Origin']:
            page.get_by_role('button', name='Select column ' + field, exact=True).click()
        scatter = page.locator('.card[data-method=createScatterPlot]')
        expect(scatter).to_be_visible(timeout=60000)
        page.get_by_role('button', name='Transition mode', exact=True).click()
        expect(workspace).to_have_attribute('data-layout', 'vertical')
        scatter.locator('.card-top').hover(position={'x': 40, 'y': 16})
        expect(page.locator('.transition-surface canvas')).to_be_visible(timeout=60000)
        scatter.locator('.apply-button').click()
        expect(page.locator('#current')).to_have_attribute('data-steps', '1', timeout=60000)
        row = page.locator('.card-row').first
        expect(row).to_have_attribute('aria-busy', 'false', timeout=60000)
        cards = row.locator('.card')
        expect(cards).to_have_count(5)
        page.locator('h1').hover()
        page.wait_for_timeout(350)

        def boxes():
            return cards.evaluate_all('(cards) => cards.map(e => e.getBoundingClientRect().toJSON())')

        baseline = boxes()
        band = row.bounding_box()
        assert abs(baseline[0]['y'] - baseline[1]['y']) < 1
        assert abs(baseline[2]['y'] - (band['y'] + band['height'] / 2 + 8)) < 1
        assert all(abs(baseline[i]['y'] - baseline[2]['y']) < 1 for i in [3, 4])
        assert baseline[0]['width'] > baseline[2]['width'] * 1.4
        charts = page.locator('.visualizations').bounding_box()
        options = page.locator('.options-section').bounding_box()
        assert charts['x'] + charts['width'] < options['x']
        assert abs(charts['width'] - options['width']) < 1

        for index in [0, 2, 1, 4, 3, 0, 4]:
            card = cards.nth(index)
            card.locator('.card-top').hover(position={'x': 40, 'y': 16})
            page.wait_for_timeout(330)
            expect(card).to_have_class(re.compile(r'\bexpanded\b'))
            after = boxes()
            # Expansion stays inside a fixed half; neighboring cards never move.
            for before, current in zip(baseline, after):
                assert abs(before['x'] - current['x']) < 1
                assert abs(before['y'] - current['y']) < 1
                assert abs(before['width'] - current['width']) < 1
            assert after[index]['height'] > baseline[index]['height'] + 20
            assert after[index]['height'] <= band['height'] / 2 - 7
        for index in [0, 4, 1, 3, 2] * 4:
            cards.nth(index).locator('.card-top').hover(position={'x': 40, 'y': 16})
            page.wait_for_timeout(40)
        page.wait_for_timeout(350)
        expect(cards.nth(2)).to_have_class(re.compile(r'\bexpanded\b'))
        assert page.locator('.card.expanded').count() == 1
        assert page.locator('#cards').evaluate('e => e.getAnimations({subtree:true}).filter(a => a.playState === "running" || a.pending).length') == 0
        page.screenshot(path=str(OUT / f'vertical-{width}.png'))
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        # No chart commits are caused by touching cards or changing orientation.
        cards.nth(4).locator('.card-top').click(position={'x': 40, 'y': 16})
        expect(page.locator('#current')).to_have_attribute('data-steps', '1')

        page.locator('#action-search').fill('encodeOpacity')
        expect(page.locator('#cards')).to_have_attribute('data-search-query', 'encodeopacity', timeout=60000)
        opacity = page.locator('.card[data-method=encodeOpacity]')
        expect(opacity).to_be_visible(timeout=60000)
        opacity.locator('.card-top').hover(position={'x': 40, 'y': 16})
        fixed = opacity.locator('[data-parameter="mode"] [data-value="fixed"]')
        if fixed.count():
            fixed.click()
        slider = opacity.locator('input[type=range]').first
        slider.press('Home')
        slider.press('ArrowRight')
        value = slider.input_value()
        page.evaluate('window.keptCards = [...document.querySelectorAll(".card")]; window.keptCanvas = document.querySelector("#current .canvas-stage canvas"); window.beforeRanks = rankRequests')
        page.get_by_role('button', name='Horizontal', exact=True).click()
        expect(workspace).to_have_attribute('data-layout', 'horizontal')
        page.get_by_role('button', name='Vertical', exact=True).click()
        expect(workspace).to_have_attribute('data-layout', 'vertical')
        assert page.evaluate('keptCards.every(e => e.isConnected) && keptCanvas === document.querySelector("#current .canvas-stage canvas") && rankRequests === beforeRanks')
        expect(slider).to_have_value(value)
        # A one-card search still occupies only the first of the two upper slots.
        assert opacity.bounding_box()['width'] < page.locator('#cards').bounding_box()['width'] * .55
        opacity.locator('.card-top').hover(position={'x': 40, 'y': 16})
        opacity.locator('.apply-button').click()
        expect(page.locator('#current')).to_have_attribute('data-steps', '2', timeout=60000)
        expect(page.locator('#undo')).to_be_enabled(timeout=60000)

        page.get_by_role('button', name='Preview mode', exact=True).click()
        expect(workspace).to_have_attribute('data-layout', 'horizontal')
        page.get_by_role('button', name='Vertical', exact=True).click()
        expect(workspace).to_have_attribute('data-layout', 'vertical')
        current = page.locator('#current').bounding_box()
        preview = page.locator('#preview').bounding_box()
        assert abs(current['x'] - preview['x']) < 1 and preview['y'] > current['y'] + current['height']
        page.locator('#action-search').fill('encodeStroke')
        expect(page.locator('#cards')).to_have_attribute('data-search-query', 'encodestroke', timeout=60000)
        stroke = page.locator('.card[data-method=encodeStroke]')
        expect(stroke).to_be_visible(timeout=60000)
        stroke.locator('.card-top').hover(position={'x': 40, 'y': 16})
        expect(page.locator('#preview canvas')).to_be_visible(timeout=60000)
        stroke.locator('.apply-button').click()
        expect(page.locator('#current')).to_have_attribute('data-steps', '3', timeout=60000)
        expect(page.locator('.chart-transfer')).to_have_count(0, timeout=10000)
        expect(page.locator('#undo')).to_be_enabled(timeout=60000)
        page.locator('#undo').click()
        expect(page.locator('#current')).to_have_attribute('data-steps', '2', timeout=60000)
        # Per-mode choices persist while keeping chart state intact.
        page.get_by_role('button', name='Transition mode', exact=True).click()
        expect(workspace).to_have_attribute('data-layout', 'vertical')
        page.get_by_role('button', name='Horizontal', exact=True).click()
        page.get_by_role('button', name='Preview mode', exact=True).click()
        expect(workspace).to_have_attribute('data-layout', 'vertical')
        page.get_by_role('button', name='Transition mode', exact=True).click()
        expect(workspace).to_have_attribute('data-layout', 'horizontal')
        page.get_by_role('button', name='Preview mode', exact=True).click()
        page.locator('#action-search').fill('')
        expect(page.locator('#cards')).to_have_attribute('data-search-query', '', timeout=60000)
        expect(page.locator('#cards-next')).to_be_enabled(timeout=60000)
        page.locator('#cards-next').click()
        expect(page.locator('#cards-page')).to_have_text(re.compile('^2 /'), timeout=60000)
        page.get_by_role('button', name='Horizontal', exact=True).click()
        page.get_by_role('button', name='Vertical', exact=True).click()
        expect(page.locator('#cards-page')).to_have_text(re.compile('^2 /'))
        expect(page.locator('.card-row[data-page="2"]')).to_have_attribute('aria-busy', 'false', timeout=60000)
        assert page.locator('.card-row[data-page="2"] .card').count() > 0
        page.locator('#toggle-code').click()
        page.locator('#toggle-history').click()
        expect(page.locator('#cards-page')).to_have_text(re.compile('^2 /'))
        page.locator('#toggle-code').click()
        page.locator('#toggle-history').click()
        page.screenshot(path=str(OUT / f'preview-{width}.png'))
        page.reload()
        expect(workspace).to_have_attribute('data-layout', 'vertical')
        expect(page.locator('#current')).to_have_attribute('data-steps', '2', timeout=60000)
        assert not errors, errors
        print(f'PASS {width}x{height}: 50:50 panels, fixed half bands, 2+3 cards, rapid hover, controls, both Apply modes, live layout, sparse search, paging, folds, mode preferences and reload', flush=True)
        context.close()
    browser.close()
