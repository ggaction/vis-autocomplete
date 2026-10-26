"""Exercise Chromium's frame-ancestors enforcement with actual server headers.

Only the presentation documents and the app's network destination are mocked.
The app's HTML, assets and security headers come from the local production server.
No real presentation page, account or hosted deployment is modified.
"""
import argparse
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5184')
args = parser.parse_args()
app_origin = 'https://visauto-embedding.test'
out = Path('output/embedding-testing')
out.mkdir(parents=True, exist_ok=True)
expect.set_options(timeout=15000)

cases = [
    ('talk', 'https://hyeonword.com/job-talk-2026/s/snu-job-talk/', True),
    ('dev-5173', 'http://127.0.0.1:5173/', True),
    ('dev-5174', 'http://127.0.0.1:5174/', True),
    ('wrong-port', 'http://127.0.0.1:5175/', False),
    ('different-host', 'http://localhost:5173/', False),
    ('wrong-scheme', 'http://hyeonword.com/job-talk-2026/s/snu-job-talk/', False),
    ('subdomain', 'https://other.hyeonword.com/', False),
    ('lookalike', 'https://hyeonword.com.outside.test/', False),
    ('unlisted', 'https://outside.test/', False),
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    try:
        for name, parent, allowed in cases + [('nested-unlisted', 'https://outside.test/', False)]:
            context = browser.new_context(viewport={'width': 1440, 'height': 1000})
            page = context.new_page()
            messages, errors = [], []
            page.on('console', lambda message: messages.append(message.text))
            page.on('pageerror', lambda error: errors.append(str(error)))
            nested = name == 'nested-unlisted'
            inner = 'https://hyeonword.com/embed-check/'

            def route_request(route):
                url = route.request.url
                if url.startswith(app_origin + '/'):
                    parts = urlsplit(url)
                    local = args.url.rstrip('/') + parts.path + ('?' + parts.query if parts.query else '')
                    response = context.request.get(local)
                    # Keep CSP and any X-Frame-Options: never make the test pass
                    # by changing the headers the browser must enforce.
                    route.fulfill(response=response)
                elif url in (parent, inner):
                    child = inner if nested and url == parent else app_origin + '/'
                    route.fulfill(content_type='text/html', body=(
                        '<!doctype html><html><head><title>Presentation embedding check</title></head>'
                        '<body style="margin:0"><iframe id="demo" title="VisAuto demo" '
                        f'src="{child}" style="width:100vw;height:100vh;border:0"></iframe></body></html>'
                    ))
                else:
                    route.abort()

            context.route('**/*', route_request)
            try:
                page.goto(parent)
                page.wait_for_load_state('networkidle')
                violations = [message for message in messages if 'frame-ancestors' in message]
                frame = page.frame_locator('#demo')
                if nested:
                    frame = frame.frame_locator('#demo')
                guest_button = frame.get_by_role('button', name='Try without account', exact=True)
                if allowed:
                    expect(guest_button).to_be_enabled()
                    assert not violations, (name, violations)
                    assert not errors, (name, errors)
                    if name == 'talk':
                        # A framed page is interactive, not merely a loaded bitmap.
                        frame.get_by_role('button', name='Sign up', exact=True).click()
                        expect(frame.get_by_role('heading', name='Create your account')).to_be_visible()
                        frame.get_by_role('button', name='Sign in', exact=True).last.click()
                        expect(frame.get_by_role('heading', name='Sign in', exact=True)).to_be_visible()
                        page.screenshot(path=str(out / 'allowed-talk.png'))
                else:
                    assert violations, (name, 'The browser did not report a frame-ancestors rejection', messages)
                    expect(guest_button).to_have_count(0)
                print(f'PASS: {name}: {"allowed" if allowed else "blocked"}')
            finally:
                context.close()
    finally:
        browser.close()
