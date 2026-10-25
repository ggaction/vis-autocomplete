import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../vendor/ggaction/node_modules/playwright/index.mjs';
const output = new URL('../output/adjacent-fields/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const fields = ['Sepal.Length', 'Sepal.Width', 'Petal.Length', 'Petal.Width', 'Species'];
async function findCard(page, title) {
  await page.waitForFunction(() => document.querySelector('#cards .card-row[aria-busy="false"]') && document.querySelector('#cards .card'));
  for (let n = 0; n < 9; n++) {
    const card = page.locator('#cards .card').filter({ has: page.locator('h3', { hasText: title }) }).first();
    if (await card.count()) { await card.hover(); return card; }
    assert.ok(await page.locator('#cards-next').isEnabled(), `Missing ${title}`);
    await page.locator('#cards-next').click();
    await page.waitForFunction(() => document.querySelector('#cards .card-row[aria-busy="false"]'));
  }
  throw new Error(`Missing ${title}`);
}
async function apply(page, card) {
  const count = await page.locator('.history-item').count();
  await card.hover(); await card.locator('.apply-button').click();
  await page.waitForFunction(n => document.querySelectorAll('.history-item').length > n && !document.querySelector('#undo').disabled, count);
}
async function addRight(page) {
  await page.locator('#current-shell').hover();
  const button = page.getByRole('button', { name: 'Add chart right', exact: true });
  const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await button.click();
  await page.getByRole('group', { name: 'Adjacent variables', exact: true }).waitFor();
}
const chips = page => page.locator('.adjacent-field > span').allTextContents();
try {
  for (const mode of ['preview', 'transition']) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await context.addInitScript(mode => localStorage.setItem('vis-autocomplete.view-mode', mode), mode);
    const page = await context.newPage(); page.setDefaultTimeout(45000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5173/'); await page.waitForLoadState('networkidle');
      await page.locator('#dataset').selectOption('iris');
      for (const field of fields) await page.getByRole('button', { name: `Select column ${field}`, exact: true }).click();
      await apply(page, await findCard(page, /^Scatter plot$/i));
      await addRight(page);
      assert.doesNotMatch(await page.locator('#adjacent-controls').innerText(), /Right of Point/);
      assert.equal(await page.locator('#current .dataset-table').count(), 0);
      assert.ok(await page.locator('#current canvas').count());
      assert.ok(await page.locator('.options-section .adjacent-fields').count());
      assert.deepEqual(await chips(page), fields, 'carry all selected variables, including those unused by scatter');
      assert.equal(await page.locator('[aria-label="Adjacent x"], [aria-label="Adjacent y"], [aria-label="Adjacent color"]').count(), 0);
      await page.getByRole('button', { name: 'Remove variable Species', exact: true }).click();
      assert.deepEqual(await chips(page), fields.slice(0, 4));
      await page.getByLabel('Add variable', { exact: true }).click();
      await page.getByRole('searchbox', { name: 'Find an adjacent variable' }).fill('spec');
      await page.screenshot({ path: new URL(`${mode}-picker.png`, output).pathname });
      await page.getByRole('button', { name: 'Add variable Species', exact: true }).click();
      assert.deepEqual(await chips(page), fields);
      const parallel = await findCard(page, /^Add Parallel coordinates$/i);
      await parallel.hover(); await page.screenshot({ path: new URL(`${mode}-cards.png`, output).pathname });
      await apply(page, parallel);
      await page.waitForFunction(() => document.querySelector('#current').dataset.lastMethod === 'createAdjacentPlot');
      await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Draft saved on this device');
      const record = await page.evaluate(async () => (await (await import('/web/project.js')).createDraftStore().read()).datasets.find(d => d.id === 'iris'));
      const call = record.session.entries.at(-1).calls.find(c => c.method === 'createAdjacentPlot');
      assert.equal(call.args.plot.action, 'createParallelCoordinates'); assert.deepEqual(call.args.plot.options.dimensions, fields.slice(0, 4));
      await page.keyboard.press('Control+z'); await page.waitForFunction(() => !document.querySelector('#redo').disabled);
      await addRight(page);
      for (const field of fields) await page.getByRole('button', { name: `Remove variable ${field}`, exact: true }).click();
      assert.deepEqual(await chips(page), []);
      await page.waitForFunction(() => document.querySelectorAll('#cards .card').length === 0);
      await page.getByLabel('Add variable', { exact: true }).click();
      await page.getByRole('button', { name: 'Add variable Petal.Width', exact: true }).click();
      await findCard(page, /Histogram/i);
      await page.locator('#adjacent-controls').getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await page.locator('#adjacent-controls').isVisible(), false);
      await page.keyboard.press('Control+Shift+z');
      const lastMethod = record.session.entries.at(-1).calls.at(-1).method;
      await page.waitForFunction(method => document.querySelector('#current').dataset.lastMethod === method, lastMethod);
      await page.reload(); await page.waitForFunction(method => document.querySelector('#current').dataset.lastMethod === method, lastMethod);
      assert.deepEqual(errors, []); console.log(`PASS ${mode}: chips, add/remove, multivariate chart, empty selection, cancel, Undo/Redo and reload`);
    } catch (error) { await page.screenshot({ path: new URL(`${mode}-failure.png`, output).pathname }); throw error; }
    finally { await context.close(); }
  }
} finally { await browser.close(); }
