import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { createProject, parseProject, restoreSession } from '../web/project.js';
import { editableGuides } from '../src/guide-manipulation.js';
import { addDefaultGuides } from '../src/prepare.js';
import { compositionPlotBounds } from '../vendor/ggaction/src/materialization/composition.js';
import { importDataset } from '../src/data-import.js';

export async function checkElementSelection(page) {
  const output = 'output/element-selection'; await mkdir(output, { recursive: true });
  const rows = Array.from({ length: 18 }, (_, i) => ({ X: i + 1, Y: i * 2 + 5, Group: ['A', 'B', 'C'][i % 3] }));
  const call = (method, args) => ({ method, args });
  const setupCalls = [call('createCanvas', { plot: { width: 314, height: 314 }, margin: 160 }),
    call('createData', { id: 'dataset', values: '__LOADED_DATA__' })];
  const baseCalls = [call('createScatterPlot', { id: 'plot', data: 'dataset', x: 'X', y: 'Y', color: { field: 'Group', fieldType: 'nominal' } }),
    call('encodeSize', { target: 'plot', field: 'Y' }), call('createGuides', {}),
    call('createTitle', { text: 'Overview', subtitle: 'Three regions', titleStyle: { fontFamily: 'Arial', fontSize: 23 } })];
  const imported = importDataset(JSON.stringify(rows), { format: 'json', name: 'Selection' });
  async function load(kind) {
    const calls = [...baseCalls];
    if (kind === 'facet') calls.push(call('facet', { field: 'Group', columns: 3, guides: { axes: 'outer', legend: 'shared' } }));
    if (kind === 'concat') calls.push(call('createAdjacentPlot', { id: 'other', source: 'plot', position: 'right',
      plot: { action: 'createScatterPlot', options: { data: 'dataset', x: 'X', y: 'Y', color: { field: 'Group', fieldType: 'nominal' } } }, share: { color: true } }));
    const snapshot = { setupCalls, calls, guideCall: call('createGuides', kind === 'concat'
      ? { target: [{ childPath: ['plot'] }, { childPath: ['other'] }] } : {}), steps: calls.length, phase: 'recommendations',
      selection: { fields: ['X', 'Y', 'Group'] }, currentNote: 'Overview', context: { target: 'plot' }, plotData: 'dataset', optionGroup: 'style' };
    const document = createProject([{ id: `selection-${kind}`, name: `Selection ${kind}`, imported,
      session: { entries: [snapshot], index: 0 } }], `selection-${kind}`);
    await page.locator('#project-file').setInputFiles({ name: `${kind}.visauto.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
    await expect(page.locator('#dataset')).toHaveValue(`selection-${kind}`);
    await expect(page.locator('#chart-font')).toBeEnabled();
  }
  const selected = page.locator('.guide-control.selected');
  const hit = key => page.locator(`.guide-control[data-guide-key="${key}"] .guide-hit`);
  const size = page.locator('#chart-font-size');
  const ready = () => expect(size).toBeEnabled();
  const setSize = async value => {
    const before = await page.locator('#current').getAttribute('data-trace-count');
    await size.fill(value); await size.press('Enter');
    await expect(page.locator('#current')).not.toHaveAttribute('data-trace-count', before);
    await ready(); await expect(size).toHaveValue(value);
  };
  const scope = async label => {
    const menu = page.locator('.text-group-menu');
    if (await menu.getAttribute('open') === null) await page.getByLabel('Choose text groups', { exact: true }).click();
    await menu.getByRole('button', { name: `Select ${label}`, exact: true }).click();
  };
  async function saved() {
    await ready(); await page.locator('.project-menu > summary').click();
    const pending = page.waitForEvent('download'); await page.locator('#save-project').click();
    const download = await pending, doc = parseProject(await readFile(await download.path(), 'utf8'));
    await page.locator('.project-menu > summary').click();
    const record = doc.datasets.find(d => d.id === doc.activeId), session = restoreSession(record.session, record.imported.rows);
    return { session, entry: session.entries[session.index] };
  }
  for (const mode of ['preview', 'transition']) {
    await load('unit'); await page.locator(`#view-mode [data-mode="${mode}"]`).click();
    const initial = await saved();
    await hit('title').click(); await page.locator('.app-header h1').hover(); await expect(selected).toHaveCount(1);
    await hit('axis:xAxisTitle').click({ modifiers: ['Shift'] }); await expect(selected).toHaveCount(2);
    await expect(page.locator('.history-item')).toHaveCount(1);
    await setSize('21');
    await expect(selected).toHaveCount(2);
    const edited = await saved();
    assert.equal(edited.entry.program.titleConfig.titleStyle.fontSize, 21);
    assert.equal(edited.entry.program.guideConfigs.axis.x.title.fontSize, 21);
    assert.deepEqual(edited.entry.program.guideConfigs.axis.y, initial.entry.program.guideConfigs.axis.y);
    await page.locator('#undo').click(); await expect(size).toHaveValue(''); await ready();
    await expect(selected).toHaveCount(2);
    await page.locator('#redo').click(); await expect(size).toHaveValue('21'); await ready();
    // Direct manipulation uses the same pinned selection in both view modes.
    const beforeGroup = await saved();
    const historyCount = await page.locator('.history-item').count();
    const resize = page.locator('.guide-control[data-guide-key="title"] .guide-size');
    await hit('title').hover();
    const groupHandle = await resize.boundingBox();
    await page.mouse.move(groupHandle.x + groupHandle.width / 2, groupHandle.y + groupHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(groupHandle.x + groupHandle.width / 2 + 14, groupHandle.y + groupHandle.height / 2, { steps: 6 });
    await page.mouse.up(); await ready();
    await expect(page.locator('.history-item')).toHaveCount(historyCount + 1);
    await expect(selected).toHaveCount(2);
    const resized = await saved();
    const ratio = resized.entry.program.titleConfig.titleStyle.fontSize / beforeGroup.entry.program.titleConfig.titleStyle.fontSize;
    assert.ok(ratio > 1);
    assert.equal(resized.entry.program.guideConfigs.axis.x.title.fontSize, resized.entry.program.titleConfig.titleStyle.fontSize);
    assert.deepEqual(resized.entry.program.guideConfigs.axis.y, beforeGroup.entry.program.guideConfigs.axis.y);
    await page.locator('#undo').click(); await ready();
    const undone = await saved();
    assert.deepEqual(undone.entry.program.titleConfig, beforeGroup.entry.program.titleConfig);
    assert.deepEqual(undone.entry.program.guideConfigs.axis, beforeGroup.entry.program.guideConfigs.axis);
    await page.locator('#redo').click(); await ready();
    assert.equal((await saved()).entry.program.titleConfig.titleStyle.fontSize,resized.entry.program.titleConfig.titleStyle.fontSize);
    await page.locator('#undo').click(); await ready();
    const moveBox = await hit('title').boundingBox();
    await page.mouse.move(moveBox.x + moveBox.width / 2, moveBox.y + moveBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(moveBox.x + moveBox.width / 2 + 12, moveBox.y + moveBox.height / 2 + 6, { steps: 6 });
    await page.mouse.up(); await ready();
    const moved = await saved();
    assert.ok(moved.entry.program.titleConfig.alongOffset > (beforeGroup.entry.program.titleConfig.alongOffset ?? 0));
    assert.ok(moved.entry.program.guideConfigs.axis.x.title.alongOffset > (beforeGroup.entry.program.guideConfigs.axis.x.title.alongOffset ?? 0));
    assert.deepEqual(moved.entry.program.guideConfigs.axis.y,beforeGroup.entry.program.guideConfigs.axis.y);
    await expect(selected).toHaveCount(2);
    const moveCount = await page.locator('.history-item').count(), repeatBox = await hit('title').boundingBox();
    await page.mouse.move(repeatBox.x + repeatBox.width / 2, repeatBox.y + repeatBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(repeatBox.x + repeatBox.width / 2 + 8, repeatBox.y + repeatBox.height / 2, { steps: 6 });
    await page.mouse.up(); await ready();
    await expect(page.locator('.history-item')).toHaveCount(moveCount);
    const repeated = await saved();
    assert.ok(repeated.entry.program.titleConfig.alongOffset > moved.entry.program.titleConfig.alongOffset, JSON.stringify({before:moved.entry.program.titleConfig,after:repeated.entry.program.titleConfig,calls:repeated.entry.calls.slice(-6)}));
    assert.ok(repeated.entry.program.guideConfigs.axis.x.title.alongOffset > moved.entry.program.guideConfigs.axis.x.title.alongOffset);
    await page.locator('#undo').click(); await ready();
    // Cancel a grouped resize after its preview: no member or history changes.
    const cancelBefore = await saved(), cancelCount = await page.locator('.history-item').count();
    await hit('title').hover();
    const cancelHandle = await resize.boundingBox();
    await page.mouse.move(cancelHandle.x + cancelHandle.width / 2, cancelHandle.y + cancelHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(cancelHandle.x + cancelHandle.width / 2 + 18, cancelHandle.y + cancelHandle.height / 2, { steps: 6 });
    await page.keyboard.press('Escape'); await page.mouse.up(); await ready();
    await expect(page.locator('.history-item')).toHaveCount(cancelCount);
    const cancelled = await saved();
    assert.deepEqual(cancelled.entry.program.titleConfig,cancelBefore.entry.program.titleConfig);
    assert.deepEqual(cancelled.entry.program.guideConfigs.axis,cancelBefore.entry.program.guideConfigs.axis);
    await hit('axis:xAxisTitle').click({ modifiers: ['Shift'] }); await expect(selected).toHaveCount(1);
    await page.keyboard.press('Escape'); await expect(selected).toHaveCount(0);

    await hit('legend:color:items').click(); await expect(selected).toHaveCount(1);
    await hit('legend:size:items').click({ modifiers: ['Shift'] }); await expect(selected).toHaveCount(2);
    await page.getByLabel('Increase selected font sizes', { exact: true }).click();
    await expect(size).toHaveValue('13'); await ready();
    const items = await saved();
    for (const family of ['color', 'size']) {
      assert.equal(items.entry.program.guideConfigs.legend[family].labels.fontSize, 13);
      assert.equal(items.entry.program.guideConfigs.legend[family].titleStyle.fontSize, initial.entry.program.guideConfigs.legend[family].titleStyle.fontSize);
    }
    await hit('legend-title:color').click(); await scope('legend');
    await expect(page.locator('.guide-control[data-guide-key="legend:color"]')).toHaveClass(/selected/);
    await scope('title'); await expect(selected).toHaveCount(1);
    await scope('items'); await expect(selected).toHaveCount(1);
    await scope('all legends'); await expect(page.locator('.guide-control[data-guide-key="legends:all"]')).toHaveClass(/selected/);
    await setSize('18');
    const all = await saved();
    for (const config of Object.values(all.entry.program.guideConfigs.legend)) {
      assert.equal(config.labels.fontSize, 18); assert.equal(config.titleStyle.fontSize, 18);
    }
    assert.equal(all.entry.program.titleConfig.titleStyle.fontSize, 21);
    await page.screenshot({ path: `${output}/${mode}-all-legends.png` });
    await page.keyboard.press('Escape'); await expect(selected).toHaveCount(0);
    // Dragging legend items still moves the whole legend, not its labels only.
    const labels = hit('legend:color:items'), box = await labels.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 12, { steps: 5 }); await page.mouse.up();
    await ready(); assert.equal((await saved()).session.entries.length, all.session.entries.length + 1);
    // The existing bottom-right resize handle remains reachable above item hits.
    await labels.hover();
    const handle = page.locator('.guide-control[data-guide-key="legend:color"] .guide-size');
    await expect(handle).toBeVisible(); const corner = await handle.boundingBox();
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2); await page.mouse.down();
    await page.mouse.move(corner.x + corner.width / 2 + 12, corner.y + corner.height / 2 + 12, { steps: 5 }); await page.mouse.up();
    await ready(); assert.ok((await saved()).entry.program.guideConfigs.legend.color.labels.fontSize > 18);
    await hit('title').click();
    await page.locator('#current').click({ position: { x: 16, y: 16 } }); await expect(selected).toHaveCount(0);
    await hit('title').focus(); await hit('title').press('Enter'); await expect(selected).toHaveCount(1);
    await page.keyboard.press('Escape'); await expect(selected).toHaveCount(0);
    await hit('legend-title:color').hover();
    await page.locator('.guide-control[data-guide-key="legend-title:color"] .guide-delete').click();
    await expect(hit('legend-title:color')).toHaveCount(0); await ready();
    await hit('legend:color:items').click();
    await page.getByLabel('Choose text groups', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Select title', exact: true })).toBeDisabled();
    await expect(selected).toHaveCount(1);
    await page.keyboard.press('Escape');
    await hit('legend:color:items').hover();
    await page.locator('.guide-control[data-guide-key="legend:color"] .guide-delete').click();
    await expect(hit('legend:color:items')).toHaveCount(0); await ready();
    await expect(hit('legend:size:items')).toHaveCount(1);
    await page.locator('#undo').click(); await expect(hit('legend:color:items')).toHaveCount(1); await ready();
    console.log(`Element selection: ${mode} persistent click, Shift toggle, scoped fonts, hierarchy, undo/redo, drag/resize passed`);
  }
  for (const kind of ['facet', 'concat']) {
    await load(kind);
    // Shared legends expose the same hierarchy as single-view legends.
    const key = kind === 'facet' ? 'legend-title:color' : 'legend:shared-color:title';
    await hit(key).click(); await setSize('20');
    await expect(selected).toHaveCount(1); await scope('items'); await setSize('16');
    await scope('all legends'); await expect(selected).toHaveCount(1);
    await page.screenshot({ path: `${output}/${kind}-selected.png` });
    await saved(); console.log(`Element selection: ${kind} legend title/items edits and replay passed`);
    if (kind === 'concat') {
      await page.keyboard.press('Escape');
      const initial = await saved(), view = addDefaultGuides(initial.entry.program, initial.entry.guideCall);
      const target = editableGuides(view).find(t => t.kind === 'legend' && !t.part && t.channels.includes('size'));
      const plot = compositionPlotBounds(view);
      assert.ok(target.bounds.left >= plot.x + plot.width, 'Independent size legend must start beside the final panel');
      assert.equal(target.childPath, undefined, 'Drag coordinates must address the parent');
      const items = hit(`${target.key}:items`), box = await items.boundingBox();
      const stage = await page.locator('#current .canvas-stage').boundingBox();
      const scale = stage.width / view.graphicSpec.objects.canvas.properties.width;
      const dx = plot.x + plot.width / 2 - (target.bounds.left + target.bounds.right) / 2;
      const dy = plot.y + plot.height + 100 - (target.bounds.top + target.bounds.bottom) / 2;
      const before = await page.locator('#current').getAttribute('data-trace-count');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + dx * scale, box.y + box.height / 2 + dy * scale, { steps: 20 });
      await page.mouse.up();
      await expect(page.locator('#current')).not.toHaveAttribute('data-trace-count', before);
      await ready();
      const moved = await saved(), result = addDefaultGuides(moved.entry.program, moved.entry.guideCall);
      const after = editableGuides(result).find(t => t.key === target.key), region = compositionPlotBounds(result);
      assert.ok(after.bounds.top > region.y + region.height, 'A pointer drag must dock beneath the whole composition');
      assert.equal(moved.session.entries.length, initial.session.entries.length + 1);
      await page.locator('#undo').click(); await ready();
      const undone = await saved(); assert.equal(undone.session.index, initial.session.index);
      await page.locator('#redo').click(); await ready();
      const redone = await saved(); assert.equal(redone.session.index, moved.session.index);
      await page.screenshot({ path: `${output}/concat-size-drag.png` });
      console.log('Collected legend pointer drag, global bounds, saved replay and undo/redo passed');
    }
  }
}
