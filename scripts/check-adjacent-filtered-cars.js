import { readSavedProject } from './browser-project.js';
// Run inside the signed-in browser suite using its isolated mock account.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { restoreSession } from '../web/project.js';

export async function checkAdjacentFilteredCars(page) {
  const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
  const calls = await read('../test/fixtures/adjacent-filtered-cars.json');
  const rows = await read('../web/data/cars.json');
  const document = {
    format: 'visualization-autocomplete', version: 1, activeId: 'filtered-cars',
    datasets: [{ id: 'filtered-cars', name: 'Filtered Cars concat regression', imported: { rows, fieldTypes: { Year: 'temporal' } },
      session: { index: 0, entries: [{ phase: 'recommendations', steps: 1,
        selection: { fields: ['Miles_per_Gallon', 'Origin', 'Displacement'] },
        setupCalls: calls.slice(0, 3).map(c => c.method === 'createData' ? { ...c, args: { ...c.args, values: '__LOADED_DATA__' } } : c),
        calls: calls.slice(3, -1), guideCall: calls.at(-1), context: { target: 'plot', data: 'dataset-selected-1' },
        plotData: 'dataset-selected-1', optionGroup: 'encoding', currentNote: 'Filtered Cars' }] } }],
  };
  const output = 'output/adjacent-filtered-cars';
  await mkdir(output, { recursive: true });
  for (const mode of ['preview', 'transition']) {
    await page.locator('#project-file').setInputFiles({ name: 'filtered-cars.visauto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
    await expect(page.locator('#dataset')).toHaveValue('filtered-cars');
    await page.locator('#current canvas').waitFor();
    await page.locator(`#view-mode [data-mode="${mode}"]`).click();
    await page.locator('#current-shell').hover();
    const add = page.getByRole('button', { name: 'Add chart left', exact: true });
    const box = await add.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await add.click();
    const cards = page.locator('.card-row:not([hidden]) .card[data-method="createAdjacentPlot"]');
    await expect(cards).toHaveCount(5);
    const expected = ['Add Scatter plot', 'Add Line plot', 'Add Bar plot', 'Add Area plot', 'Add Beeswarm plot'];
    for (let i = 0; i < expected.length; i++) {
      const card = cards.nth(i);
      await expect(card.locator('h3')).toHaveText(expected[i]);
      await card.hover();
      await expect(card.locator('.apply-button')).toBeEnabled();
      await expect(card.locator('.thumbnail canvas')).toBeVisible();
      await expect(card.locator('.card-error')).toBeEmpty();
    }
    await cards.first().hover();
    await page.screenshot({ path: `${output}/${mode}-cards.png` });
    // Apply an aggregated chart so the complete filter/bin/summary chain, not
    // just a direct raw-data scatter, must survive the worker and persistence.
    const historyCount = await page.locator('.history-item').count();
    const area = cards.filter({ has: page.getByRole('heading', { name: 'Add Area plot', exact: true }) });
    await area.hover(); await area.locator('.apply-button').click();
    await expect(page.locator('.history-item')).toHaveCount(historyCount + 1);
    await expect(page.locator('#current')).toHaveAttribute('data-last-method', 'createAdjacentPlot');
    const project = await readSavedProject(page);
    const record = project.datasets.find(d => d.id === project.activeId);
    const session = restoreSession(record.session, record.imported.rows), snapshot = session.entries[session.index];
    const restoredMethod = snapshot.calls.at(-1).method;
    const dataCalls = snapshot.calls.filter(c => c.method === 'filterData' || /^create.*Data$/.test(c.method));
    assert.equal(new Set(dataCalls.map(c => c.args.id)).size, dataCalls.length);
    assert.ok(snapshot.program.children.chart2);
    assert.equal(snapshot.program.children.plot.semanticSpec.datasets.find(d => d.id === 'dataset-selected-1').values.length,
      rows.filter(row => row.Miles_per_Gallon != null).length);
    await page.locator('#undo').click(); await expect(page.locator('#redo')).toBeEnabled();
    await page.locator('#redo').click();
    await expect(page.locator('#current')).toHaveAttribute('data-last-method', restoredMethod);
    // Rendering the restored history entry precedes its asynchronous durable
    // save. Reload the saved state, rather than racing an in-flight write.
    await expect(page.locator('#reset')).toBeEnabled();
    await expect(page.locator('#cloud-status')).toHaveText('Saved');
    await page.reload(); await page.locator('#current canvas').waitFor();
    await expect(page.locator('#current')).toHaveAttribute('data-last-method', restoredMethod);
    await expect(page.locator(`#view-mode [data-mode="${mode}"]`)).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: `${output}/${mode}-applied-restored.png` });
    console.log(`Filtered Cars: ${mode} five cards, area Apply, code replay, undo/redo, reload passed`);
  }
}
