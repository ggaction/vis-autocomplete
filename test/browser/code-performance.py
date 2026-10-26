"""Long histories must not make each parameter hover rewrite unchanged code DOM."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5187')
parser.add_argument('--baseline', action='store_true')
parser.add_argument('--output', type=Path, default=Path('output/performance-hardening/code-after.json'))
args = parser.parse_args()
args.output.parent.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1200, 'height': 800})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url + '/test/fixtures/code-performance.html')
    page.wait_for_load_state('networkidle')
    page.wait_for_function('window.harness')
    # Warm the preview structure, then count DOM work on the unchanged prefix.
    page.evaluate('harness.hover(0)')
    page.wait_for_timeout(50)
    result = page.evaluate('''async () => {
      const h = harness, old = [...h.host.querySelectorAll('.code-call')].slice(0, -1);
      const query = Element.prototype.querySelector;
      let queries = 0, mutations = 0;
      Element.prototype.querySelector = function (...args) {
        if (this.closest?.('#code')) queries++;
        return query.apply(this, args);
      };
      const observer = new MutationObserver(records => { mutations += records.length; });
      for (const node of old) observer.observe(node, { subtree: true, childList: true, attributes: true, characterData: true });
      const times = [];
      try {
        for (let i = 0; i < 40; i++) {
          const start = performance.now(); h.hover(i + 1); times.push(performance.now() - start);
          await new Promise(requestAnimationFrame);
        }
      } finally { Element.prototype.querySelector = query; observer.disconnect(); }
      const sorted = [...times].sort((a,b) => a-b);
      return { calls: old.length, queries, unchangedMutations: mutations,
        medianMs: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)],
        preservedNodes: old.every((node,i) => h.host.querySelectorAll('.code-call')[i] === node) };
    }''')
    assert result['preservedNodes'], result
    if not args.baseline:
        assert result['unchangedMutations'] == 0, result
        assert result['queries'] < 600, result
        # Folding defers DOM work but copy/export still sees the latest source.
        hidden = page.evaluate('''async () => {
          const h = harness; let mutations = 0;
          const observer = new MutationObserver(records => { mutations += records.length; });
          observer.observe(h.host, { subtree: true, childList: true, attributes: true, characterData: true });
          h.hover(2, { defer: true }); await Promise.resolve();
          observer.disconnect();
          const copied = h.displayedCode(h.host) === h.proposed[2];
          h.hover(2);
          return { mutations, copied, rendered: h.host.textContent.includes('green') };
        }''')
        assert hidden == {'mutations': 0, 'copied': True, 'rendered': True}, hidden
        # User-expanded committed calls survive preview changes and pointer exit.
        page.evaluate('''() => {
          const call = harness.host.querySelectorAll('.code-call')[10]; call.open = true;
        }''')
        page.wait_for_timeout(50)
        page.evaluate('harness.hover(3); harness.leave()')
        assert page.evaluate('harness.host.querySelectorAll(".code-call")[10].open')
        assert page.evaluate('harness.displayedCode(harness.host) === harness.current')
    assert not errors, errors
    browser.close()
args.output.write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
