"""Repeated real card expansion after cumulative scatter/facet edits, at 2x DPI.
Run against npm run dev. Timing is reported, not used as a hardware-specific gate.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import json

out = Path('output/transition-hover'); out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    page = browser.new_page(viewport={'width': 2560, 'height': 1440}, device_scale_factor=2)
    errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:5173/'); page.wait_for_load_state('networkidle')
    page.locator('#dataset').select_option('iris')
    for field in ['Sepal.Width', 'Petal.Width', 'Species']:
        page.get_by_role('button', name='Select column ' + field, exact=True).click()
    page.get_by_role('button', name='Transition mode', exact=True).click()
    card = page.locator('.card[data-method=createScatterPlot]'); expect(card).to_be_visible(timeout=60000)
    card.locator('.card-top').hover(); card.locator('.apply-button').click()
    expect(page.locator('#current')).to_have_attribute('data-steps', '1', timeout=60000)
    for step, (method, key, value) in enumerate([
        ('editColorScale', 'palette', 'set1'), ('encodeStroke', 'mode', 'fixed'),
        ('encodeSize', 'value', 948), ('encodeOpacity', 'value', .25),
        ('encodeShape', 'field', 'Species'), ('facet', None, None)
    ], start=2):
        page.locator('#action-search').fill(method)
        expect(page.locator('#cards')).to_have_attribute('data-search-query', method.lower(), timeout=60000)
        card = page.locator('.card[data-method=' + method + ']'); expect(card).to_be_visible(timeout=60000)
        card.locator('.card-top').hover()
        if key:
            control = card.locator('[data-parameter="' + key + '"]')
            if isinstance(value, (int, float)):
                fixed = card.locator('[data-parameter=mode] .parameter-choice[data-value=fixed]')
                if fixed.count(): fixed.click()
                control.locator('input[type=range]').evaluate('(e,v)=>{e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}))}', value)
            else:
                choice = control.locator('.parameter-choice[data-value="' + value + '"]')
                if not choice.is_visible(): control.locator('summary').click()
                choice.click()
        card.locator('.apply-button').click()
        expect(page.locator('#current')).to_have_attribute('data-steps', str(step), timeout=60000)
    page.locator('#action-search').fill('')
    expect(page.locator('#cards')).to_have_attribute('data-search-query', '', timeout=60000)
    expect(page.locator('.card-row').first).to_have_attribute('aria-busy', 'false', timeout=60000)
    page.mouse.move(1, 1); page.wait_for_timeout(500)
    page.evaluate('''() => { window.intervals=[]; window.record=false; let previous=0;
      function tick(t){if(record&&previous)intervals.push(t-previous);previous=record?t:0;requestAnimationFrame(tick)}requestAnimationFrame(tick); }''')
    results = []
    for round in range(3):
        page.evaluate('intervals=[];record=true')
        for index in [0, 1, 2, 3, 4, 3, 2, 1, 0, 4] * 2:
            rect = page.locator('.card-row').first.locator('.card').nth(index).bounding_box()
            page.mouse.move(rect['x'] + rect['width'] / 2, rect['y'] + 30)
            page.wait_for_timeout(360)
        page.mouse.move(1, 1); page.wait_for_timeout(500)
        intervals = page.evaluate('record=false;intervals')
        expect(page.locator('.transition-surface')).to_have_count(0)
        expect(page.locator('#current')).to_have_attribute('data-steps', '7')
        assert page.locator('#cards').evaluate("e=>e.getAnimations({subtree:true}).filter(a=>a.playState==='running'||a.pending).length") == 0
        nodes = page.locator('*').count()
        if results: assert nodes <= results[0]['domNodes'] + 20, 'hover accumulated DOM nodes'
        results.append({'round': round + 1, 'frames': len(intervals), 'over25ms': sum(x > 25 for x in intervals),
                        'maxMs': max(intervals), 'domNodes': nodes})
    assert not errors, errors
    (out / 'repeated-hover.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(results), flush=True)
    browser.close()
