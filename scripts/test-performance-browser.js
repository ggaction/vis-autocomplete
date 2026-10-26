// Real authoring workflows with isolated auth/storage transport, never a real account.
// Timing is diagnostic; correctness and bounded DOM work are the regression gates.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { newSession } from './audit-browser-session-2026-10-25.mjs';
import { createProject } from '../web/project.js';
import { importDataset } from '../src/data-import.js';

const url = process.env.APP_URL ?? 'http://127.0.0.1:5187';
const output = process.env.PERF_OUTPUT ?? 'output/performance-hardening/browser-after.json';
const rate = Number(process.env.PERF_CPU_RATE ?? 1);
const kinds = (process.env.PERF_CASES ?? 'scatter,facet,parallel,layer,concat').split(',');
const call = (method, args) => ({ method, args });
const guides = call('createGuides', {});
const percentile = (values, q) => [...values].sort((a,b) => a-b)[Math.floor((values.length - 1) * q)] ?? 0;
async function project(kind) {
  const rows = kind === 'parallel'
    ? importDataset(await readFile(new URL('../web/data/bike-sharing.csv', import.meta.url), 'utf8'), { format: 'csv', name: 'Bike Sharing' }).rows
    : Array.from({ length: kind === 'scatter' ? 1500 : 180 }, (_, i) => ({ x: i + 1, y: 2 + Math.sin(i / 9), g: `Group ${i % 3}` }));
  const imported = importDataset(JSON.stringify(rows), { format: 'json', name: kind });
  const setupCalls = [call('createCanvas', { plot: { width: 400, height: 314 }, margin: { left: 100, right: 180, top: 70, bottom: 80 } }),
    call('createData', { id: 'dataset', values: '__LOADED_DATA__' })];
  const color = { field: 'g', fieldType: 'nominal' };
  const calls = kind === 'parallel'
    ? [call('createParallelCoordinates', { id: 'plot', data: 'dataset', dimensions: ['temp', 'hum', 'atemp', 'windspeed', 'casual'], line: { opacity: .55 } }),
      call('facet', { data: 'dataset', field: 'yr', columns: 2, guides: { axes: 'each', legend: false } })]
    : kind === 'layer'
      ? [call('createBeeswarmPlot', { id: 'plot', data: 'dataset', x: { field: 'g', fieldType: 'nominal' }, y: 'y', color }),
        call('createLayerPlot', { id: 'layer', source: 'plot', plot: { action: 'createBoxPlot', options: {} }, placement: 'back' })]
      : [call('createScatterPlot', { id: 'plot', data: 'dataset', x: 'x', y: 'y', color })];
  if (kind === 'facet') calls.push(call('facet', { data: 'dataset', field: 'g', columns: 3, guides: { axes: 'outer', legend: 'shared' } }));
  if (kind === 'concat') calls.push(call('createAdjacentPlot', { id: 'chart2', source: 'plot', position: 'right',
    plot: { action: 'createLinePlot', options: { data: 'dataset', x: 'x', y: 'y', color } }, share: { x: true, y: true, color: true }, gap: 8 }));
  const snapshot = () => ({ setupCalls, calls: [...calls], guideCall: kind === 'concat'
    ? call('createGuides', { target: [{ childPath: ['plot'] }, { childPath: ['chart2'] }] }) : guides,
    steps: calls.length, phase: 'recommendations', selection: { fields: kind === 'parallel' ? ['temp','hum','atemp','windspeed','casual'] : ['x','y','g'] },
    currentNote: `Performance ${kind}`, context: { target: 'plot', ...(kind === 'concat' ? { childPath: ['plot'] } : {}) },
    plotData: 'dataset', optionGroup: 'encoding' });
  const entries = [snapshot()];
  if (kind === 'scatter') for (let i=0; i<40; i++) {
    calls.push(call('encodeOpacity', { target: 'plot', value: i % 2 ? .7 : .5 })); entries.push(snapshot());
  }
  return createProject([{ id: kind, name: kind, imported, session: { entries, index: entries.length-1 } }], kind);
}
const browser = await chromium.launch({ headless: true });
const results = [];
await mkdir(new URL('../output/performance-hardening/', import.meta.url), { recursive: true });
try {
  for (const kind of kinds) {
    const session = await newSession(browser, { url, viewport: { width: 1600, height: 1050 } });
    const { page } = session;
    try {
      const cdp = await session.context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      await page.locator('#project-file').setInputFiles({ name: `${kind}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(await project(kind))) });
      await page.waitForFunction(() => document.querySelector('#history')?.getAttribute('aria-busy') === 'false' && Number(document.querySelector('#current')?.dataset.steps) > 0);
      await page.waitForFunction(() => document.querySelector('#cards .card-row[aria-busy="false"]'));
      const steps = await page.locator('#current').getAttribute('data-steps');
      await page.getByRole('button', { name: 'Graph View', exact: true }).click();
      await page.evaluate(() => {
        window.perfSample = { longTasks: [], intervals: [], hovering: false, previous: 0 };
        new PerformanceObserver(list => { if (perfSample.hovering) perfSample.longTasks.push(...list.getEntries().map(e => e.duration)); }).observe({ type: 'longtask' });
        function frame(t) { if (perfSample.hovering && perfSample.previous) perfSample.intervals.push(t-perfSample.previous); perfSample.previous=t; requestAnimationFrame(frame); }
        requestAnimationFrame(frame);
      });
      const modes = [];
      for (const mode of ['transition', 'preview']) {
        await page.locator(`#view-mode [data-mode="${mode}"]`).click();
        const cards = page.locator('#cards .card-row').first().locator('.card');
        const count = Math.min(5, await cards.count()); assert.ok(count > 0);
        await page.evaluate(() => { perfSample.intervals=[]; perfSample.longTasks=[]; perfSample.hovering=true; });
        for (let i=0; i<15; i++) {
          await cards.nth(i%count).locator('.card-top').hover({ position: { x: 32, y: 16 } });
          await page.waitForTimeout(30);
        }
        const stats = await page.evaluate(() => { perfSample.hovering=false; return perfSample; });
        assert.equal(await page.locator('#current').getAttribute('data-steps'), steps, 'hover never commits');
        modes.push({ mode, frameP95Ms: percentile(stats.intervals, .95), longTasks: stats.longTasks });
        await page.locator('.app-header h1').hover();
      }
      // Later pages stream real usable cards rather than staying blank.
      let secondPageMs = null;
      if (await page.locator('#cards-next').isEnabled()) {
        const started = performance.now(); await page.locator('#cards-next').click();
        await page.waitForFunction(() => document.querySelector('#cards .card-row[data-page="2"][aria-busy="false"] .card'));
        secondPageMs = performance.now() - started;
      }
      await page.locator('#action-search').fill('encodeOpacity');
      await page.waitForFunction(() => document.querySelector('#cards').dataset.searchQuery === 'encodeopacity');
      await page.waitForFunction(() => document.querySelector('#cards .card-row[aria-busy="false"] .card'));
      const opacity = page.locator('#cards .card').filter({ has: page.locator('h3', { hasText: /opacity/i }) }).first();
      const appliedMethod = await opacity.getAttribute('data-method');
      await opacity.locator('.card-top').hover();
      const started = performance.now(); await opacity.locator('.apply-button').click();
      await page.waitForFunction(n => Number(document.querySelector('#current').dataset.steps) > Number(n), steps);
      await page.waitForFunction(() => document.querySelector('#history').getAttribute('aria-busy') === 'false');
      const applyMs = performance.now() - started;
      const after = await page.locator('#current').getAttribute('data-steps');
      await page.locator('.app-header h1').hover(); await page.keyboard.press('Control+z');
      await page.waitForFunction(n => document.querySelector('#current').dataset.steps === n && document.querySelector('#history').getAttribute('aria-busy') === 'false', steps);
      await page.keyboard.press('Control+Shift+z');
      await page.waitForFunction(n => document.querySelector('#current').dataset.steps === n && document.querySelector('#history').getAttribute('aria-busy') === 'false', after);
      // Closed code panels retain up-to-date canonical state on reopening.
      await page.locator('#toggle-code').click();
      await page.locator('#toggle-code').click();
      assert.ok(await page.locator(`#code-content [data-method="${appliedMethod}"]`).count());
      assert.deepEqual(session.errors, []);
      const result = { kind, cpuRate: rate, steps: Number(steps), hoverSwitches: 30, secondPageMs, applyMs, modes, applyUndoRedo: true };
      results.push(result); console.log(JSON.stringify(result));
    } catch (error) {
      await page.screenshot({ path: `output/performance-hardening/browser-failure-${kind}.png` });
      throw error;
    } finally { await session.close(); }
  }
} finally { await browser.close(); }
await writeFile(output, JSON.stringify({ runtime: process.version, url, results }, null, 2));
