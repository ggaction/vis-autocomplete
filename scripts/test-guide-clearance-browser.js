import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../vendor/ggaction/node_modules/playwright/index.mjs';
const output = new URL('../output/guide-clearance/', import.meta.url); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ['preview', 'transition']) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
    await context.addInitScript(mode => localStorage.setItem('vis-autocomplete.view-mode', mode), mode);
    const page = await context.newPage(), errors = []; page.setDefaultTimeout(45000);
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5173/'); await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => !document.querySelector('#dataset').disabled);
    await page.locator('#dataset').selectOption('cars');
    for (const field of ['Horsepower', 'Acceleration', 'Displacement', 'Weight_in_lbs', 'Miles_per_Gallon', 'Origin']) {
      await page.getByRole('button', { name: `Select column ${field}`, exact: true }).click();
    }
    async function apply(method) {
      const card = page.locator(`.card[data-method="${method}"]`);
      await card.locator('.card-top').hover();
      await page.waitForFunction(method => document.querySelector(`.card[data-method="${method}"]`)?.dataset.previewState === 'ready', method);
      await card.locator('.apply-button').click();
      await page.waitForFunction(method => document.querySelector('#current').dataset.lastMethod === method, method);
      return card;
    }
    await apply('createParallelCoordinates');
    await page.locator('#group-style').click(); await page.locator('#action-search').fill('createTitle');
    const title = page.locator('.card[data-method="createTitle"]'); await title.locator('.card-top').hover();
    await title.locator('[data-parameter="text"] input').fill('Cars: five dimensions');
    await title.locator('[data-parameter="subtitle"] input').fill('Grouped by Origin');
    await apply('createTitle');
    await page.mouse.move(8, 8); await page.waitForTimeout(500);
    await page.locator('#current').screenshot({ path: new URL(`${mode}-title.png`, output).pathname });
    await page.locator('#action-search').fill('editLegend');
    const legend = page.locator('.card[data-method="editLegend"]');
    await legend.locator('.card-top').hover();
    await page.waitForFunction(() => document.querySelector('.card[data-method="editLegend"]')?.dataset.previewState === 'ready');
    await page.mouse.move(8, 8); await legend.locator('.card-top').hover(); await page.waitForTimeout(500);
    await legend.locator('[data-parameter="position"] [data-value="top"]').click();
    await apply('editLegend');
    await page.mouse.move(8, 8); await page.waitForTimeout(500);
    await page.locator('#current').screenshot({ path: new URL(`${mode}-legend-top.png`, output).pathname });
    assert.deepEqual(errors, []); console.log(`PASS ${mode}: Cars PCP, title/subtitle, top legend via option cards`);
    await context.close();
  }
} finally { await browser.close(); }
