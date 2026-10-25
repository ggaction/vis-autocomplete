import assert from 'node:assert/strict';
import { chromium } from '../vendor/ggaction/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ['preview', 'transition']) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
    await context.addInitScript(mode => localStorage.setItem('vis-autocomplete.view-mode', mode), mode);
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(45000); page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5173/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => !document.querySelector('#dataset').disabled);
    await page.locator('#dataset').selectOption('iris');
    for (const field of ['Sepal.Length', 'Sepal.Width']) await page.getByRole('button', { name: `Select column ${field}`, exact: true }).click();
    const scatter = page.locator('.card[data-method="createScatterPlot"]');
    await scatter.locator('.card-top').hover(); await scatter.locator('.apply-button').click();
    await page.waitForFunction(() => document.body.dataset.phase === 'recommendations');
    await page.locator('#group-style').click(); await page.locator('#action-search').fill('createTitle');
    const card = page.locator('.card[data-method="createTitle"]');
    await card.locator('.card-top').hover(); await page.waitForTimeout(500);
    const slider = card.locator('[data-parameter="size"] input[type="range"]');
    await slider.waitFor();
    const initial = await slider.inputValue();
    const move = async fraction => {
      const box = await slider.boundingBox();
      await page.mouse.move(box.x + 6 + fraction * (box.width - 12), box.y + box.height / 2);
    };
    // Cross and leave before dwell, then wait longer than the activation timer.
    await move(.95); await page.waitForTimeout(60);
    assert.equal(await slider.inputValue(), initial);
    await card.locator('.card-top').hover(); await page.waitForTimeout(300);
    assert.equal(await slider.inputValue(), initial, 'no delayed change after a pass-through');
    await move(.95); await page.waitForTimeout(280);
    const active = await slider.inputValue(); assert.notEqual(active, initial, 'stationary dwell starts preview');
    await move(.15); await page.waitForTimeout(50);
    assert.notEqual(await slider.inputValue(), active, 'armed hover follows without another dwell');
    // Leaving disarms. An explicit click still pins immediately without dwell.
    await card.locator('.card-top').hover();
    const box = await slider.boundingBox();
    await page.mouse.click(box.x + box.width * .7, box.y + box.height / 2);
    assert.equal(await slider.getAttribute('data-locked'), 'true');
    const pinned = await slider.inputValue();
    await move(.05); await page.waitForTimeout(300); assert.equal(await slider.inputValue(), pinned);
    await page.mouse.click(box.x + box.width * .7, box.y + box.height / 2);
    assert.equal(await slider.getAttribute('data-locked'), 'false');
    await move(.2); await page.waitForTimeout(50); assert.notEqual(await slider.inputValue(), pinned);
    await slider.press('End'); assert.equal(await slider.inputValue(), await slider.getAttribute('max'));
    assert.deepEqual(errors, []);
    console.log(`PASS ${mode}: pass-through, dwell, continuous follow, click pin/resume, keyboard`);
    await context.close();
  }
} finally { await browser.close(); }
