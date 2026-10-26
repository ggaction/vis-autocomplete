import assert from 'node:assert/strict';
import { chromium } from '../vendor/ggaction/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

// Fresh isolated contexts protect the user's project. Report timings, not
// machine-specific pass/fail thresholds. Run alone, with the dev server ready.
const browser = await chromium.launch({ headless: true });
const samples = [], errors = [];
const output = new URL('../output/loading/', import.meta.url);
await mkdir(output, { recursive: true });
try {
  for (let run = 0; run < 3; run++) {
    const context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.addInitScript(mode => {
      if (mode) localStorage.setItem('vis-autocomplete.view-mode', mode);
      performance.setResourceTimingBufferSize(10000);
      window.longTasks = [];
      new PerformanceObserver(list => window.longTasks.push(...list.getEntries().map(e =>
        ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true });
    }, process.env.MODE);
    page.on('pageerror', error => errors.push(error.message));
    const session = await context.newCDPSession(page);
    await session.send('Performance.enable');
    for (const cache of ['cold', 'reload']) {
      const start = performance.now();
      if (cache === 'cold') await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5173/');
      else await page.reload();
      await page.waitForFunction(() => !document.querySelector('#dataset')?.disabled && document.querySelector('#dataset option[value="cars"]'));
      const readyMs = performance.now() - start;
      // Resource Timing includes the main page and worker entry scripts, not
      // fetches executed inside workers. Do not present this as whole-process IO.
      const result = await page.evaluate(() => ({
        resources: performance.getEntriesByType('resource').map(r => ({ name: new URL(r.name).pathname,
          bytes: r.transferSize, duration: r.duration, end: r.responseEnd })),
        longTasks: window.longTasks, navigation: performance.getEntriesByType('navigation')[0]?.toJSON(),
      }));
      const metrics = Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
      samples.push({ run, cache, browser: browser.version(), mode: process.env.MODE ?? 'preview', readyMs, ...result, metrics });
      console.log(JSON.stringify({ run, cache, readyMs, requests: result.resources.length,
        MB: result.resources.reduce((n, r) => n + r.bytes, 0) / 1e6,
        longMs: result.longTasks.reduce((n, t) => n + t.duration, 0) }));
    }
    const sample = samples.at(-1);
    let start = performance.now();
    await page.locator('#dataset').selectOption('cars');
    await page.getByRole('button', { name: 'Select column Horsepower', exact: true }).waitFor();
    sample.tableMs = performance.now() - start;
    await page.getByRole('button', { name: 'Select column Horsepower', exact: true }).click();
    start = performance.now();
    await page.getByRole('button', { name: 'Select column Miles_per_Gallon', exact: true }).click();
    const card = page.locator('.card[data-method="createScatterPlot"]');
    await card.waitFor(); sample.initialCardsMs = performance.now() - start;
    await card.locator('.card-top').hover();
    await page.waitForFunction(() => document.querySelector('.card[data-method="createScatterPlot"]')?.dataset.previewState === 'ready');
    start = performance.now(); await card.locator('.apply-button').click();
    await page.waitForFunction(() => document.querySelectorAll('.history-item').length >= 2 && !document.querySelector('#undo').disabled
      && document.querySelectorAll('.card[data-preview-state="ready"]').length >= 5);
    sample.applyCardsMs = performance.now() - start;
    start = performance.now(); await page.locator('#group-style').click();
    await page.waitForFunction(() => document.querySelector('#cards').dataset.optionGroup === 'style'
      && document.querySelectorAll('.card[data-preview-state="ready"]').length >= 5 && !document.querySelector('#cards').getAttribute('aria-busy'));
    sample.styleCardsMs = performance.now() - start;
    await page.waitForFunction(() => document.querySelector('#cloud-status').textContent === 'Saved');
    start = performance.now(); await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.history-item').length >= 2 && document.querySelectorAll('.card[data-preview-state="ready"]').length >= 5);
    sample.restoreMs = performance.now() - start;
    console.log(JSON.stringify({ run, restoreMs: sample.restoreMs, tableMs: sample.tableMs,
      initialCardsMs: sample.initialCardsMs, applyCardsMs: sample.applyCardsMs, styleCardsMs: sample.styleCardsMs }));
    if (run === 2) {
      await page.waitForFunction(() => {
        const row = document.querySelector('#cards .card-row');
        return row?.getAttribute('aria-busy') === 'false' && Number(getComputedStyle(row).opacity) === 1;
      });
      await page.screenshot({ path: new URL(`${process.env.LABEL ?? 'current'}.png`, output).pathname });
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await writeFile(new URL(`${process.env.LABEL ?? 'current'}.json`, output), JSON.stringify(samples, null, 2));
}
