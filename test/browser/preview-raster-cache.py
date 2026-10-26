"""Native Preview reuses exact endpoint pixels without replaying dense paths.

Timings are diagnostic. Exact pixels, invalidation and zero warm native strokes
are the deterministic gates, at both standard and high device pixel density.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5187')
parser.add_argument('--output', type=Path, default=Path('output/performance-hardening/preview-raster-cache.json'))
args = parser.parse_args()
args.output.parent.mkdir(parents=True, exist_ok=True)
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for dpr in [1, 2]:
        page = browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=dpr)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(args.url + '/test/fixtures/preview-raster-cache.html')
        page.wait_for_function('window.ready === true')
        results.append(page.evaluate('harness.run()'))
        assert not errors, errors
        page.close()
    browser.close()
args.output.write_text(json.dumps(results, indent=2))
print(json.dumps(results, indent=2))
