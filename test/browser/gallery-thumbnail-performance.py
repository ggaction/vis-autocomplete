"""Verify real worker replay, exact PNG pixels, cancellation, and frame diagnostics."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5187')
args = parser.parse_args()
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1200, 'height': 800})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url + '/test/fixtures/gallery-thumbnail-performance.html')
    page.wait_for_load_state('networkidle')
    page.wait_for_function('window.ready === true')
    assert page.title() == 'Gallery thumbnail worker regression'
    results = page.evaluate('window.runGalleryChecks()')
    assert not errors, errors
    output = Path('output/performance-hardening')
    output.mkdir(parents=True, exist_ok=True)
    (output / 'gallery-thumbnail-worker.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))
    browser.close()
