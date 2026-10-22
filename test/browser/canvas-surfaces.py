"""Verify native Canvas display, fitted bounds, enlargement and vector exports."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = 'http://127.0.0.1:5173'

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    )
    page = browser.new_page(viewport={'width': 1600, 'height': 1100}, device_scale_factor=2)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    page.goto(BASE + '/test/fixtures/chart-viewport.html')
    page.wait_for_load_state('networkidle')
    page.locator('#run').click()
    expect(page.locator('#report')).to_have_attribute('data-result', 'passed', timeout=30000)
    print(page.locator('#report').inner_text().splitlines()[0], flush=True)

    page.goto(BASE + '/test/fixtures/thumbnail-render.html')
    page.wait_for_function('window.ready')
    assert page.locator('.thumbnail > canvas').count() == 3

    page.goto(BASE + '/')
    page.wait_for_load_state('networkidle')
    for field in ['Horsepower', 'Miles_per_Gallon', 'Origin']:
        page.get_by_role('button', name='Select column ' + field, exact=True).click()
    card = page.locator('.card[data-method=createScatterPlot]')
    expect(card).to_be_visible(timeout=60000)
    card.locator('.card-top').hover(position={'x': 40, 'y': 16})
    card.locator('.apply-button').click()
    expect(page.locator('#current')).to_have_attribute('data-steps', '1', timeout=60000)
    page.locator('h1').hover()
    expect(page.locator('#undo')).to_be_enabled(timeout=60000)

    for output_format in ['png', 'pdf', 'svg']:
        with page.expect_download() as download:
            page.locator(f'#chart-exports [data-format={output_format}]').click()
        content = Path(download.value.path()).read_bytes()
        assert len(content) > 1000
        if output_format == 'pdf':
            assert content.startswith(b'%PDF')
        elif output_format == 'png':
            assert content.startswith(b'\x89PNG')
        else:
            assert b'<svg' in content

    page.locator('#zoom-current').click()
    expect(page.locator('#enlarged-chart canvas')).to_be_visible()
    page.keyboard.press('Escape')
    page.locator('#action-search').fill('encodeOpacity')
    expect(page.locator('#cards')).to_have_attribute('data-search-query', 'encodeopacity', timeout=60000)
    card = page.locator('.card[data-method=encodeOpacity]')
    expect(card).to_be_visible(timeout=60000)
    card.locator('.card-top').hover(position={'x': 40, 'y': 16})
    expect(page.locator('#preview canvas')).to_be_visible(timeout=60000)
    # Moving from the card to Expand clears the inline hover preview; the
    # button must still open the most recently displayed candidate.
    page.locator('#zoom-preview').click()
    expect(page.locator('#enlarged-chart canvas')).to_be_visible()
    page.keyboard.press('Escape')
    assert page.locator('#current svg,#preview svg,.thumbnail svg,.history-thumbnail svg').count() == 0
    assert not errors, errors
    print('PASS native Canvas thumbnails, fitted Preview, expanded views, all exports and no chart SVG DOM')
    browser.close()
