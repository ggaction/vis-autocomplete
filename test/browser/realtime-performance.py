"""Exact Canvas endpoint and dense-hover timings, including a throttled CPU.

Run against the local development server. No login or external writes.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5205')
parser.add_argument('--baseline-sources', type=Path)
parser.add_argument('--output', type=Path, default=Path('output/realtime-optimization/browser.json'))
args = parser.parse_args()
args.output.parent.mkdir(parents=True, exist_ok=True)
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for rate in [1, 4]:
        for cache in [False, True]:
            page = browser.new_page(viewport={'width': 1200, 'height': 800}, device_scale_factor=1)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            if args.baseline_sources and not cache:
                sources = json.loads(args.baseline_sources.read_text())
                for url, source in sources.items():
                    relative = url.split('/ggaction_autocomplete/', 1)[-1]
                    page.route(f'**/{relative}', lambda route, request, source=source: route.fulfill(content_type='text/javascript', body=source))
            page.goto(f'{args.url}/test/fixtures/scene-renderer.html?cache={int(cache)}')
            page.wait_for_load_state('networkidle')
            page.wait_for_function('window.ready', timeout=120000)
            cdp = page.context.new_cdp_session(page)
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': rate})
            buttons = page.get_by_role('button')
            for round_number in range(3):
                page.evaluate('audit.begin()')
                for i in range(30):
                    buttons.nth(i % 5).hover()
                    page.wait_for_timeout(20)
                page.evaluate('audit.show(0)')
                sample = page.evaluate('audit.end()')
                sample.update({'cpuRate': rate, 'cache': cache, 'round': round_number})
                results.append(sample)
                assert sample['nodes'] >= 5000, sample
                assert sample['retainedPixels'] <= 8_000_000, sample
                assert sample['retainedEntries'] <= 6, sample
            for index in [0, 1, 4]:
                comparison = page.evaluate('index=>audit.compare(index)', index)
                assert comparison['max'] == 0, comparison
            # Cache keys must follow display density/resize, never stretch an old bitmap.
            page.evaluate("document.querySelector('#host').style.width='650px'")
            page.wait_for_timeout(150)
            assert page.evaluate('audit.compare(2)')['max'] == 0
            assert not errors, errors
            page.screenshot(path=str(args.output.parent / f'canvas-{rate}-{int(cache)}.png'))
            page.close()
    browser.close()
args.output.write_text(json.dumps(results, indent=2))
print(json.dumps(results, indent=2))
