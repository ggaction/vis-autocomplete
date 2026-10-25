import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../vendor/ggaction/node_modules/playwright/index.mjs';
const output = new URL('../output/field-selection/', import.meta.url); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true }), errors = [];
const url = process.env.APP_URL ?? 'http://127.0.0.1:5173/';
async function open(mode = 'preview') {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(mode => localStorage.setItem('vis-autocomplete.view-mode', mode), mode);
  const page = await context.newPage(); page.setDefaultTimeout(45000);
  page.on('pageerror', error => errors.push(error.message)); await page.goto(url); await ready(page);
  return { context, page };
}
async function ready(page) {
  await page.waitForLoadState('networkidle'); await page.waitForFunction(() => !document.querySelector('#dataset').disabled);
}
async function select(page, dataset, fields) {
  await page.locator('#dataset').selectOption(dataset);
  for (const name of fields) await page.getByRole('button', { name: `Select column ${name}`, exact: true }).click();
  await page.waitForFunction(n => JSON.parse(document.querySelector('#cards').dataset.selectedFields || '[]').length === n &&
    document.querySelector('#cards .card-row[aria-busy="false"]'), fields.length);
  assert.equal(await page.locator('#select-x, #select-y, #select-color').count(), 0);
  assert.equal(await page.locator('.field-selection .selected-field').count(), fields.length);
}
async function findCard(page, method) {
  for (let i = 0; i < 7; i++) {
    const card = page.locator(`#cards .card[data-method="${method}"]`).first();
    if (await card.count()) { await card.scrollIntoViewIfNeeded(); await card.hover(); return card; }
    assert.ok(await page.locator('#cards-next').isEnabled(), `missing ${method}`);
    const before = await page.locator('#cards-page').textContent(); await page.locator('#cards-next').click();
    await page.waitForFunction(before => document.querySelector('#cards-page').textContent !== before, before);
    await page.waitForFunction(() => !document.querySelector('#cards-next').disabled || document.querySelector('#cards-page').textContent.split('/').map(v => v.trim()).every((v, i, a) => v === a[0]));
  }
  throw new Error(`missing ${method}`);
}
async function apply(page, card) {
  await card.hover(); await card.locator('.apply-button').click();
  await page.waitForFunction(() => document.body.dataset.phase === 'recommendations' && document.querySelectorAll('.history-item').length === 2);
  await page.waitForFunction(() => document.querySelector('#undo').disabled === false);
}
const stored = page => page.evaluate(async () => (await (await import('/web/project.js')).createDraftStore().read()).datasets.find(record => record.id === document.querySelector('#dataset').value));
async function saved(page) { await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Draft saved on this device'); }
try {
  for (const mode of ['preview', 'transition']) {
    const { context, page } = await open(mode);
    await select(page, 'cars', ['Horsepower', 'Miles_per_Gallon', 'Origin']);
    const card = await findCard(page, 'createScatterPlot');
    const x = card.locator('[data-parameter="mapping_x"]'), y = card.locator('[data-parameter="mapping_y"]');
    const beforeX = await x.locator('[aria-pressed="true"]').getAttribute('data-value'), beforeY = await y.locator('[aria-pressed="true"]').getAttribute('data-value');
    const code = page.locator('#code-content');
    await card.getByRole('button', { name: 'Swap X / Y', exact: true }).click();
    assert.equal(await x.locator('[aria-pressed="true"]').getAttribute('data-value'), beforeY);
    assert.equal(await y.locator('[aria-pressed="true"]').getAttribute('data-value'), beforeX);
    await page.waitForFunction(() => document.querySelector('#code-content').dataset.previewMethod === 'createScatterPlot');
    const color = card.locator('[data-parameter="mapping_color"]');
    await color.getByRole('button', { name: 'None', exact: true }).hover();
    await page.waitForFunction(() => !document.querySelector('#code-content').textContent.includes('"color":'));
    assert.equal(await color.locator('[aria-pressed="true"]').getAttribute('data-value'), 'Origin', 'hover does not pin');
    await color.getByRole('button', { name: 'Origin', exact: true }).click();
    await card.hover();
    await page.waitForFunction(() => document.querySelector('#code-content').textContent.includes('"color":'));
    await page.waitForTimeout(500); await page.screenshot({ path: new URL(`scatter-${mode}.png`, output).pathname, fullPage: true });
    await apply(page, card); await saved(page);
    const record = await stored(page), last = record.session.entries[record.session.index];
    const call = last.calls.find(call => call.method === 'createScatterPlot');
    assert.equal(call.args.x.field, beforeY); assert.equal(call.args.y.field, beforeX); assert.equal(call.args.color.field, 'Origin');
    await page.reload(); await ready(page); assert.ok(await page.locator('#current canvas').count());
    await page.keyboard.press('Control+z'); await page.locator('.dataset-table').waitFor();
    assert.equal(await page.locator('.field-selection .selected-field').count(), 3);
    await page.keyboard.press('Control+Shift+z'); await page.waitForFunction(() => document.body.dataset.phase === 'recommendations');
    await context.close(); console.log(`PASS ${mode}: field selection, swap, parameter hover, Apply, restore, Undo/Redo`);
  }
  {
    const { context, page } = await open();
    await select(page, 'iris', ['Sepal.Length', 'Sepal.Width', 'Petal.Length', 'Petal.Width', 'Species']);
    assert.equal(await page.locator('#cards .card').first().getAttribute('data-method'), 'createParallelCoordinates');
    const card = await findCard(page, 'createParallelCoordinates');
    await card.getByRole('button', { name: 'Move Petal.Width earlier', exact: true }).click();
    await page.waitForTimeout(500); await page.screenshot({ path: new URL('parallel-ordered.png', output).pathname, fullPage: true });
    await apply(page, card); await saved(page);
    const record = await stored(page), call = record.session.entries.at(-1).calls.find(call => call.method === 'createParallelCoordinates');
    assert.deepEqual(call.args.dimensions, ['Sepal.Length', 'Sepal.Width', 'Petal.Width', 'Petal.Length']);
    const canvasEdits = record.session.entries.at(-1).calls.filter(call => call.method === 'editCanvas');
    assert.ok(canvasEdits.length, 'four dimensions include explicit native canvas setup');
    assert.equal(canvasEdits.at(-1).args.plot.width, 376.8, 'four axes use 120% of the baseline width after Apply');
    await page.keyboard.press('Control+z'); await page.locator('.dataset-table').waitFor();
    await page.getByRole('button', { name: 'Deselect Species', exact: true }).click();
    await page.getByRole('button', { name: 'Select column Sepal.Length', exact: true }).click();
    assert.equal(await page.locator('.field-selection .selected-field').count(), 3);
    await saved(page); await page.reload(); await ready(page);
    assert.equal(await page.locator('.field-selection .selected-field').count(), 3);
    assert.equal(await page.getByRole('button', { name: 'Select column Species', exact: true }).getAttribute('aria-pressed'), 'false');
    await context.close(); console.log('PASS multivariate dimensions/order and edited selection restoration');
  }
  {
    const { context, page } = await open();
    await select(page, 'barley', ['variety', 'site', 'yield']);
    const card = await findCard(page, 'createHeatmap');
    assert.equal(await card.locator('[data-parameter="mapping_color"] [aria-pressed="true"]').getAttribute('data-value'), 'yield');
    await page.waitForTimeout(500); await page.screenshot({ path: new URL('heatmap.png', output).pathname, fullPage: true });
    await apply(page, card); await saved(page);
    const record = await stored(page), call = record.session.entries.at(-1).calls.find(call => call.method === 'createHeatmap');
    assert.equal(call.args.color.field, 'yield');
    await context.close(); console.log('PASS automatic categorical-grid heatmap with measure aggregation');
  }
  {
    const { context, page } = await open(); await select(page, 'cars', ['Horsepower']);
    const card = await findCard(page, 'createHistogram'); await apply(page, card);
    await context.close(); console.log('PASS one-field distribution chart');
  }
  assert.deepEqual(errors, []); console.log('PASS no browser exceptions');
} finally { await browser.close(); }
