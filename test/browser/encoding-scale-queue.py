"""An encoding and its scale join the used queue together, through the real UI."""
import re
from playwright.sync_api import sync_playwright, expect


def search(page, method):
    page.locator('#action-search').fill(method)
    expect(page.locator('#cards')).to_have_attribute('data-search-query', method.lower(), timeout=60000)
    expect(page.locator('.card-row').first).to_have_attribute('aria-busy', 'false', timeout=60000)
    card = page.locator(f'.card[data-method={method}]')
    expect(card).to_have_count(1)
    card.locator('.card-top').hover(position={'x': 40, 'y': 16})
    return card


def apply(page, card, steps):
    card.locator('.apply-button').click()
    expect(page.locator('#current')).to_have_attribute('data-steps', str(steps), timeout=60000)
    expect(page.locator('#undo')).to_be_enabled(timeout=60000)
    page.locator('h1').hover()


def queue(page, editor):
    page.locator('#action-search').fill('')
    expect(page.locator('#cards')).to_have_attribute('data-search-query', '', timeout=60000)
    first = page.locator('.card-row[data-page="1"]')
    expect(first).to_have_attribute('aria-busy', 'false', timeout=60000)
    assert first.locator(f'.card[data-method={editor}]').count() == 0
    for _ in range(20):
        number = int(page.locator('#cards-page').inner_text().split('/')[0])
        row = page.locator(f'.card-row[data-page="{number}"]')
        expect(row).to_have_attribute('aria-busy', 'false', timeout=60000)
        if page.locator('#cards-next').is_disabled():
            break
        assert row.locator('.card').count() == 5
        page.locator('#cards-next').click()
        expect(page.locator('#cards-page')).to_have_text(re.compile(rf'^{number+1} /'), timeout=60000)
    else:
        raise AssertionError('Pagination did not finish')
    return page.locator('.card-row .card').evaluate_all('cards => cards.map(c => c.dataset.method)')


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    for method, field, mode in [('encodeSize', 'Weight_in_lbs', 'Transition mode'),
                                ('encodeOpacity', 'Acceleration', 'Preview mode'),
                                ('encodeStroke', 'Origin', 'Preview mode')]:
        context = browser.new_context(viewport={'width': 1600, 'height': 1100})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto('http://127.0.0.1:5173/')
        page.wait_for_load_state('networkidle')
        for name in ['Horsepower', 'Miles_per_Gallon', 'Origin']:
            page.get_by_role('button', name='Select column ' + name, exact=True).click()
        page.get_by_role('button', name=mode, exact=True).click()
        card = page.locator('.card[data-method=createScatterPlot]')
        expect(card).to_be_visible(timeout=60000)
        card.locator('.card-top').hover(position={'x': 40, 'y': 16})
        apply(page, card, 1)
        card = search(page, method)
        card.locator('[data-parameter="mode"] [data-value="variable"]').click()
        card.locator(f'[data-parameter="field"] [data-value="{field}"]').click()
        apply(page, card, 2)
        editor = 'edit' + method[len('encode'):] + 'Scale'
        assert set(queue(page, editor)[-2:]) == {method, editor}
        scale_card = search(page, editor)
        expect(scale_card.locator('.apply-button')).to_be_enabled()
        if method == 'encodeSize':
            slider = scale_card.locator('input[type=range]').first
            slider.press('ArrowRight')
            expect(scale_card).to_have_attribute('data-preview-state', 'ready', timeout=30000)
            apply(page, scale_card, 3)
            assert queue(page, editor)[-1] == editor
            page.locator('#undo').click()
            expect(page.locator('#current')).to_have_attribute('data-steps', '2', timeout=60000)
            assert set(queue(page, editor)[-2:]) == {method, editor}
            page.locator('#redo').click()
            expect(page.locator('#current')).to_have_attribute('data-steps', '3', timeout=60000)
            assert queue(page, editor)[-1] == editor
        assert not errors, errors
        print(f'PASS {method}: editor absent from first page, retained at tail and searchable in {mode}', flush=True)
        context.close()
    browser.close()
