"""History work scales with changed/visible content, not retained edit count.

Timing samples are diagnostic; deterministic work and memory bounds are gates.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5187')
parser.add_argument('--output', type=Path, default=Path('output/history-performance/scaling.json'))
args = parser.parse_args()
args.output.parent.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1800, 'height': 1100}, device_scale_factor=2)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url + '/test/fixtures/history-graph.html')
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='Graph View', exact=True).click()
    page.wait_for_function('document.querySelectorAll(".history-graph-node canvas[data-paint]").length === 5')
    result = page.evaluate('''async () => {
      const result = {graph: []}, sample = harness.h.current;
      const nodesGetter = Object.getOwnPropertyDescriptor(harness.h, 'nodes').get;
      let treeReads = 0;
      Object.defineProperty(harness.h, 'nodes', {configurable: true, get() {treeReads++; return nodesGetter();}});
      for (const count of [100, 1000, 10000]) {
        harness.h.restore(Array.from({length: count}, () => sample), count - 1);
        harness.view.update(harness.h, false); await new Promise(requestAnimationFrame);
        treeReads = 0;
        const durations = [];
        for (let i = 0; i < 20; i++) {
          harness.h.undo();
          const start = performance.now(); harness.view.update(harness.h, false);
          durations.push(performance.now() - start);
          await new Promise(requestAnimationFrame);
          harness.h.redo(); harness.view.update(harness.h, true); harness.view.update(harness.h, false);
          await new Promise(requestAnimationFrame);
        }
        result.graph.push({count, treeReads, medianMs: durations.sort((a,b) => a-b)[10], maxMs: Math.max(...durations)});
      }
      return result;
    }''')
    assert all(item['treeReads'] == 0 for item in result['graph']), result
    assert page.locator('.history-graph-node').count() < 50

    page.evaluate('''() => {
      const sample = harness.h.current;
      harness.h.restore(Array.from({length: 1000}, (_, i) => ({...sample, steps: i, currentNote: `State ${i}`})), 0);
      harness.view.update(harness.h);
    }''')
    page.get_by_role('button', name='Linear View', exact=True).click()
    page.wait_for_function('document.querySelectorAll(".history-list .history-item").length === 1000')
    result['linear'] = page.evaluate('''() => {
      const nativeLeft = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft');
      const nativeWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
      let layoutReads = 0;
      for (const [name, descriptor] of [['offsetLeft', nativeLeft], ['offsetWidth', nativeWidth]]) {
        Object.defineProperty(HTMLElement.prototype, name, {...descriptor, get() {
          if (this.classList.contains('history-item')) layoutReads++;
          return descriptor.get.call(this);
        }});
      }
      try {
        const host = document.querySelector('.history-list'), left = host.getBoundingClientRect().left;
        for (let i = 0; i < 100; i++) harness.view.move({clientX: left + 20 + (i % 8) * 150});
        return {layoutReads, inspecting: host.querySelectorAll('.inspecting').length};
      } finally {
        Object.defineProperty(HTMLElement.prototype, 'offsetLeft', nativeLeft);
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', nativeWidth);
        harness.view.clear();
      }
    }''')
    assert result['linear']['layoutReads'] < 3000, result
    assert result['linear']['inspecting'] == 1, result

    page.evaluate('''() => {
      const sample = harness.h.current;
      harness.h.restore(Array.from({length: 120}, (_, i) => ({...sample, steps: i, currentNote: `Raster ${i}`})), 0);
      harness.view.update(harness.h);
      window.rasterStart = harness.historyPaints;
    }''')
    page.wait_for_function('document.querySelector(".history-list .history-item:first-child canvas[data-paint]")');
    page.evaluate('''() => {
      window.originalHistoryButton = document.querySelector('.history-list .history-item');
      window.originalHistoryRaster = originalHistoryButton.querySelector('canvas').toDataURL();
    }''')
    for start in range(0, 120, 8):
        page.locator('.history-list').evaluate('(host, start) => {host.scrollLeft = start * 149;}', start)
        page.wait_for_function('''() => {
          const host = document.querySelector('.history-list'), bounds = host.getBoundingClientRect();
          return [...host.querySelectorAll('.history-item')].filter(button => {
            const box = button.getBoundingClientRect();
            return box.right > bounds.left + 2 && box.left < bounds.right - 2;
          }).every(button => button.querySelector('canvas[data-paint]'));
        }''')
    result['rasters'] = page.evaluate('''() => ({rendered: harness.historyPaints - rasterStart,
      retained: document.querySelectorAll('.history-list canvas[data-paint]').length})''')
    assert result['rasters']['rendered'] >= 110, result
    assert result['rasters']['retained'] <= 80, result
    page.locator('.history-list').evaluate('host => {host.scrollLeft = 0;}')
    page.wait_for_function('document.querySelector(".history-list .history-item:first-child canvas[data-paint]")')
    assert page.locator('.history-list .history-item').first.get_attribute('aria-label').endswith('Raster 0')
    assert page.evaluate('''() => {
      const button = document.querySelector('.history-list .history-item'), canvas = button.querySelector('canvas');
      return button === originalHistoryButton && canvas.toDataURL() === originalHistoryRaster && canvas.width > canvas.clientWidth;
    }'''), 'Eviction must preserve node identity and regenerate exact high-DPI pixels'
    assert page.locator('.history-list canvas[data-paint]').count() <= 80
    page.locator('.history-list .history-item').first.focus()
    page.keyboard.press('ArrowRight')
    assert page.evaluate('document.activeElement.dataset.historyIndex === "1" && harness.h.index === 0')
    assert not errors, errors
    browser.close()

args.output.write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
