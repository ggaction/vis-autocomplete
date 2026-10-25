// Focused actual-UI regression for independent path layers above numeric colors.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openAuditSession, selectDataset, findCard } from './audit-browser-session-2026-10-25.mjs';

const out = new URL('../output/option-audit-2026-10-25/path-layer-color-final/', import.meta.url);
await mkdir(out, { recursive: true });
const session = await openAuditSession();
const { page } = session;
const result = { events: [], probes: [], errors: session.errors };

async function ready(card) {
  await card.locator('.card-top').hover();
  await page.waitForFunction(el => el?.isConnected && el.dataset.previewState !== 'pending', await card.elementHandle());
  const state = await card.evaluate(el => ({ state: el.dataset.previewState, error: el.querySelector('.card-error')?.textContent ?? '', apply: !el.querySelector('.apply-button')?.disabled }));
  assert.equal(state.state, 'ready', JSON.stringify(state));
  assert.equal(state.error, '');
  assert.equal(state.apply, true);
  return state;
}
async function apply(card) {
  await ready(card);
  const before = Number(await page.locator('.history-item[aria-current]').getAttribute('data-history-index'));
  await card.locator('.apply-button').click();
  await page.waitForFunction(before => Number(document.querySelector('.history-item[aria-current]')?.dataset.historyIndex) > before, before);
  await page.waitForFunction(() => document.querySelector('#current canvas'));
}

try {
  await selectDataset(page, 'iris', ['Sepal.Length', 'Sepal.Width', 'Petal.Length']);
  await apply(await findCard(page, 'createScatterPlot'));
  result.events.push('numeric-color-scatter-created');
  await page.getByRole('button', { name: 'Add overlay', exact: true }).click();
  const card = await findCard(page, 'createLayerPlot', /Line plot layer/i);
  result.probes.push({ parameter: 'default', ...await ready(card) });
  result.controls = await card.locator('.control').evaluateAll(controls => controls.filter(control => !control.querySelector('.control')).map(control => ({
    key: control.dataset.parameter, label: control.querySelector('span')?.textContent,
    choices: [...control.querySelectorAll('button[data-value]')].map(button => ({ value: button.dataset.value, label: button.textContent, disabled: button.disabled, selected: button.getAttribute('aria-pressed') === 'true', reason: button.title }))
  })));
  const color = result.controls.find(control => control.label === 'Color');
  const group = result.controls.find(control => control.label === 'Group by');
  assert.ok(color, 'Line layer exposes Color');
  assert.ok(group, 'Line layer exposes Group by');
  const invalidNumeric = color.choices.find(choice => choice.label === 'Sepal.Width');
  assert.ok(invalidNumeric?.disabled, 'Variable numeric path color is explained as unavailable');
  assert.ok(invalidNumeric.reason, 'Disabled color explains the path-series incompatibility');
  for (const control of [color, group]) {
    for (const choice of control.choices.filter(choice => !choice.disabled && !choice.selected)) {
      const button = card.locator(`.control[data-parameter=${JSON.stringify(control.key)}] button[data-value=${JSON.stringify(choice.value)}]`).first();
      const details = button.locator('xpath=ancestor::details');
      if (await details.count()) await details.evaluate(el => el.open = true);
      if (await button.isDisabled()) continue;
      await button.click();
      result.probes.push({ parameter: control.label, value: choice.value, ...await ready(card) });
    }
    const original = control.choices.find(choice => choice.selected);
    const restore = card.locator(`.control[data-parameter=${JSON.stringify(control.key)}] button[data-value=${JSON.stringify(original.value)}]`).first();
    await restore.click();
  }
  await ready(card);
  await page.screenshot({ path: new URL('parameters.png', out).pathname, fullPage: true });
  await apply(card);
  result.events.push('line-layer-applied');
  await page.locator('#undo').click();
  await page.waitForFunction(() => !document.querySelector('#redo').disabled);
  await page.locator('#redo').click();
  await page.waitForFunction(() => document.querySelector('#current canvas'));
  result.events.push('undo-redo');
  await page.waitForTimeout(1000);
  const project = [...session.projects.values()].at(-1);
  assert.ok(project?.snapshot, 'The mock account saved the composed program');
  const snapshot = project.snapshot;
  const saved = snapshot.datasets.find(dataset => dataset.id === snapshot.activeId).session;
  const calls = saved.entries[saved.index].calls;
  assert.equal(calls.find(call => call.method === 'createScatterPlot').args.color.field, 'Sepal.Width');
  assert.ok(calls.find(call => call.method === 'createLayerPlot'), 'Saved program contains the actual public layer action');
  await writeFile(new URL('program.json', out), JSON.stringify(snapshot, null, 2));
  await page.reload();
  await page.locator('#current canvas').waitFor();
  await page.locator('#editing-target button').filter({ hasText: /^Line$/ }).waitFor();
  await page.waitForFunction(() => {
    const text = document.querySelector('#code-content')?.textContent ?? '';
    return text.includes('createScatterPlot') && text.includes('createLayerPlot');
  });
  await page.locator('#cards .card-row[data-page="1"][aria-busy="false"] .card').first().waitFor();
  result.events.push('reload');
  await page.locator('#editor-root h1').hover();
  await page.waitForTimeout(500);
  result.finalReadiness = await page.evaluate(() => ({
    codeCharacters: document.querySelector('#code-content').textContent.length,
    codeContainsOriginalScatter: document.querySelector('#code-content').textContent.includes('createScatterPlot'),
    codeContainsPublicLayer: document.querySelector('#code-content').textContent.includes('createLayerPlot'),
    firstPageReady: document.querySelector('#cards .card-row[data-page="1"]')?.getAttribute('aria-busy') === 'false',
    firstPageCards: document.querySelectorAll('#cards .card-row[data-page="1"] .card').length,
    pagination: document.querySelector('#cards-page').textContent
  }));
  await page.screenshot({ path: new URL('final.png', out).pathname, fullPage: true });
  assert.deepEqual(session.errors, []);
  result.status = 'passed';
} catch (error) {
  result.status = 'failed'; result.failure = error.stack;
  await page.screenshot({ path: new URL('failure.png', out).pathname, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile(new URL('result.json', out), JSON.stringify(result, null, 2));
  await session.close();
  console.log(JSON.stringify(result));
}
