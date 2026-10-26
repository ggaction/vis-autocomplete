import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../vendor/ggaction/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true });
const output = new URL('../output/dataset-startup/', import.meta.url);
await mkdir(output, { recursive: true });
const errors = [];
async function open() {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const exampleRequests = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/web/data/')) exampleRequests.push(request.url()); });
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5173/');
  await ready(page);
  assert.deepEqual(exampleRequests, [], 'fresh visits do not fetch unselected example datasets');
  return { context, page };
}
async function ready(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.querySelector('#dataset').disabled);
}
async function empty(page) {
  assert.equal(await page.locator('#dataset').inputValue(), '');
  assert.equal(await page.locator('#dataset option:checked').innerText(), 'Try example dataset');
  assert.equal(await page.locator('.dataset-table, #cards .card, .history-item, #current canvas').count(), 0);
  assert.equal(await page.locator('#code-content').innerText(), '');
  for (const id of ['reset', 'edit-schema', 'code-export']) assert.ok(await page.locator(`#${id}`).isDisabled());
}
const draft = page => page.evaluate(async () => {
  const { createDraftStore } = await import('/web/project.js');
  return Boolean(await createDraftStore().read());
});
async function upload(page) {
  await page.locator('#upload').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose a dataset file', exact: true }).click()]);
  await chooser.setFiles({ name: 'own-data.csv', mimeType: 'text/csv',
    buffer: Buffer.from('Time,Amount,Group\n1,8,A\n2,15,B\n3,11,A\n') });
  await page.locator('.dataset-import-dialog').waitFor();
}
try {
  {
    const { context, page } = await open();
    await empty(page);
    const left = await page.locator('#upload').boundingBox(), right = await page.locator('#dataset').boundingBox();
    assert.ok(left.x + left.width <= right.x, 'Upload precedes the example picker visually');
    assert.equal(await draft(page), false, 'visiting does not create an example draft');
    await page.screenshot({ path: new URL('fresh.png', output).pathname, fullPage: true });
    await page.reload(); await ready(page); await empty(page);
    await page.locator('#dataset').selectOption('iris');
    for (const name of ['Sepal.Length', 'Petal.Length']) await page.getByRole('button', { name: `Select column ${name}`, exact: true }).click();
    const card = page.locator('#cards .card[data-method="createScatterPlot"]').first();
    await card.hover(); await card.locator('.apply-button').click();
    await page.waitForFunction(() => document.querySelectorAll('.history-item').length === 2 && !document.querySelector('#reset').disabled);
    await page.waitForFunction(() => document.querySelector('#cloud-status').textContent === 'Saved');
    const saved = await page.evaluate(async () => {
      const { createDraftStore } = await import('/web/project.js');
      return createDraftStore().read();
    });
    assert.deepEqual(saved.datasets.map(record => record.id), ['iris'], 'only loaded tables enter the project');
    await page.reload(); await ready(page);
    assert.equal(await page.locator('#dataset').inputValue(), 'iris');
    assert.equal(await page.locator('.history-item').count(), 2);
    assert.ok(await page.locator('#current canvas').count());
    assert.match(await page.locator('#code-content').innerText(), /createScatterPlot/);
    await page.locator('#cards-next').click();
    await page.waitForFunction(() => {
      const row = document.querySelector('#cards .card-row[data-page="2"]');
      return row?.querySelector('.card') && row.getAttribute('aria-busy') === 'false';
    });
    await context.close(); console.log('PASS fresh visit, explicit example selection, and chart restoration');
  }
  {
    const { context, page } = await open();
    await upload(page); await page.locator('.dataset-import-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await empty(page); assert.equal(await draft(page), false);
    await upload(page); await page.locator('.dataset-import-dialog').getByRole('button', { name: 'Use dataset', exact: true }).click();
    await page.getByRole('button', { name: 'Select column Amount', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('#cloud-status').textContent === 'Saved');
    const selected = await page.locator('#dataset').inputValue();
    assert.equal(await page.locator('#dataset option:checked').innerText(), 'own-data.csv');
    await page.reload(); await ready(page);
    assert.equal(await page.locator('#dataset').inputValue(), selected);
    assert.equal(await page.locator('#dataset option:checked').innerText(), 'own-data.csv');
    await page.getByRole('button', { name: 'Select column Amount', exact: true }).waitFor();
    await context.close(); console.log('PASS upload-first, cancel, import, and restoration');
  }
  {
    const { context, page } = await open();
    await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('visualization-autocomplete', 2);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({ format: 'invalid' }, 'draft');
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    }));
    await page.reload(); await ready(page); await empty(page);
    assert.match(await page.locator('#notice').innerText(), /Could not restore/);
    await page.locator('#dataset').selectOption('sales');
    await page.getByRole('button', { name: 'Select column Sales', exact: true }).waitFor();
    await context.close(); console.log('PASS invalid draft leaves the dataset chooser usable');
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
