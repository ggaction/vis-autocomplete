import test from 'node:test';
import assert from 'node:assert/strict';
import { chart, hconcat } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { selectableGuides, selectedGuideTextTargets } from '../src/guide-manipulation.js';
import { typographyCalls, prepareTypography, chartTextItems } from '../src/chart-typography.js';

const unit = () => chart().createCanvas({ plot: { width: 314, height: 314 }, margin: 180 })
  .createData({ id: 'd', values: [{ x: 1, y: 3, g: 'A' }, { x: 2, y: 5, g: 'B' }, { x: 4, y: 6, g: 'A' }] })
  .createScatterPlot({ id: 'p', data: 'd', x: 'x', y: 'y', color: { field: 'g', fieldType: 'nominal' } })
  .encodeSize({ target: 'p', field: 'y' }).createGuides()
  .createTitle({ text: 'Overview', subtitle: 'Details', titleStyle: { fontSize: 23 } });
const legend = (p, family, part) => selectableGuides(p).find(g => g.family === family && g.legendPart === part);
const legendTextStyle = (p, family) => chartTextItems(p).filter(t => t.id.includes(`${family}Legend`))
  .map(({ id, text, fontSize, fontFamily, fontWeight, fill }) => ({ id, text, fontSize, fontFamily, fontWeight, fill }));
function edit(p, elements, options = { delta: 1 }) {
  const before = serializeProgram(p), result = prepareTypography(p, p, { elements, ...options });
  assert.equal(serializeProgram(p), before);
  let replay = p;
  for (const call of result.calls) replay = replay[call.method](call.args);
  if (result.guideCall) replay = replay[result.guideCall.method](result.guideCall.args);
  assert.deepEqual(replay.graphicSpec, result.view.graphicSpec);
  return result.view;
}
test('title and one axis selection changes only their text through native edits', () => {
  const p = unit(), axis = selectableGuides(p).find(g => g.kind === 'axis' && g.channel === 'x');
  const next = edit(p, ['title', axis.key], { fontSize: 19 });
  assert.equal(next.titleConfig.titleStyle.fontSize, 19);
  assert.equal(next.guideConfigs.axis.x.title.fontSize, 19);
  assert.deepEqual(next.titleConfig.subtitleStyle, p.titleConfig.subtitleStyle);
  assert.deepEqual(next.guideConfigs.axis.y, p.guideConfigs.axis.y);
  assert.deepEqual(next.guideConfigs.legend, p.guideConfigs.legend);
});
test('legend hierarchy separates all legends, one legend, title and items', () => {
  const p = unit();
  for (const part of ['title', 'items', 'legend']) {
    const next = edit(p, [legend(p, 'color', part).key], { fontSize: 18 });
    assert.equal(next.guideConfigs.legend.color.labels.fontSize, part === 'title' ? p.guideConfigs.legend.color.labels.fontSize : 18);
    assert.equal(next.guideConfigs.legend.color.titleStyle.fontSize, part === 'items' ? p.guideConfigs.legend.color.titleStyle.fontSize : 18);
    assert.deepEqual(legendTextStyle(next, 'size'), legendTextStyle(p, 'size'));
  }
  const all = edit(p, ['legends:all'], { fontSize: 17 });
  for (const config of Object.values(all.guideConfigs.legend)) {
    assert.equal(config.titleStyle.fontSize, 17); assert.equal(config.labels.fontSize, 17);
  }
  assert.deepEqual(all.guideConfigs.axis, p.guideConfigs.axis);
  assert.deepEqual(all.titleConfig, p.titleConfig);
});
test('overlapping parent/child selections increment each text owner once', () => {
  const p = unit(), full = legend(p, 'color', 'legend'), title = legend(p, 'color', 'title');
  const next = edit(p, ['legends:all', full.key, title.key, 'title-group', 'title']);
  assert.equal(next.guideConfigs.legend.color.titleStyle.fontSize, p.guideConfigs.legend.color.titleStyle.fontSize + 1);
  assert.equal(next.guideConfigs.legend.color.labels.fontSize, p.guideConfigs.legend.color.labels.fontSize + 1);
  assert.equal(next.titleConfig.titleStyle.fontSize, p.titleConfig.titleStyle.fontSize + 1);
});
test('shared and nested legend selection edits every shared contributor but no other legend', () => {
  const p = hconcat({ programs: [{ id: 'a', program: unit() }, { id: 'b', program: unit() }], share: { color: true } });
  const shared = legend(p, 'color', 'title'); assert.ok(shared);
  assert.ok(shared.bounds.right > shared.bounds.left);
  const next = edit(p, [shared.key], { fontSize: 18 });
  for (const child of Object.values(next.children)) {
    assert.equal(child.guideConfigs.legend.color.titleStyle.fontSize, 18);
    assert.equal(child.guideConfigs.legend.size.titleStyle.fontSize, p.children.a.guideConfigs.legend.size.titleStyle.fontSize);
  }
  const local = selectableGuides(next).find(g => g.legendPart === 'items' && g.childPath?.[0] === 'b');
  const sized = edit(next, [local.key], { fontSize: 20 });
  assert.equal(sized.children.b.guideConfigs.legend.size.labels.fontSize, 20);
  assert.deepEqual(sized.children.a.guideConfigs.legend.size, next.children.a.guideConfigs.legend.size);
});
test('facet guide selections remain source-owned and removed selections never edit other text', () => {
  const p = unit().facet({ field: 'g', columns: 2, guides: { axes: 'outer', legend: 'shared' } });
  const label = legend(p, 'color', 'items');
  const next = edit(p, [label.key], { fontSize: 18 });
  assert.equal(next.guideConfigs.legend.color.labels.fontSize, 18);
  assert.deepEqual(legendTextStyle(next, 'size'), legendTextStyle(p, 'size'));
  const removed = p.removeTitle();
  assert.deepEqual(typographyCalls(removed, { elements: ['title'], delta: 1 }), []);
  assert.deepEqual(selectedGuideTextTargets(p, []), []);
});
test('selected font family does not reset global theme or unrelated text fonts', () => {
  const p = unit(), target = legend(p, 'color', 'items');
  const next = edit(p, [target.key], { fontFamily: 'Georgia' });
  assert.equal(next.guideConfigs.legend.color.labels.fontFamily, 'Georgia');
  assert.deepEqual(next.titleConfig, p.titleConfig);
  assert.deepEqual(next.guideConfigs.axis, p.guideConfigs.axis);
});

test('nested same-channel legends keep each title attached to its own legend', () => {
  const p = hconcat({ programs: [{ id: 'left', program: hconcat({ programs: [
    { id: 'one', program: unit() }, { id: 'two', program: unit() }
  ] }) }, { id: 'right', program: unit() }] });
  const guides = selectableGuides(p);
  for (const full of guides.filter(g => g.legendPart === 'legend')) {
    const title = guides.find(g => g.legendKey === full.key && g.legendPart === 'title');
    assert.ok(title, full.key);
    assert.equal(title.key.split('/').slice(0, -1).join('/'), full.key.split('/').slice(0, -1).join('/'));
  }
  const chosen = guides.find(g => g.key === 'left/two/legend-title:color');
  const next = edit(p, [chosen.key], { fontSize: 19 });
  assert.equal(next.children.left.children.two.guideConfigs.legend.color.titleStyle.fontSize, 19);
  assert.deepEqual(next.children.left.children.one.guideConfigs.legend, p.children.left.children.one.guideConfigs.legend);
  assert.deepEqual(next.children.right.guideConfigs.legend, p.children.right.guideConfigs.legend);
});

test('hidden legend titles have no selectable title and font edits do not recreate them', () => {
  const p = unit().editLegend({ target: 'p', channel: 'color', title: false });
  assert.equal(legend(p, 'color', 'title'), undefined);
  const next = edit(p, [legend(p, 'color', 'legend').key], { fontSize: 18 });
  assert.equal(next.guideConfigs.legend.color.titleVisible, false);
  assert.equal(legend(next, 'color', 'title'), undefined);
});

test('gradient and shape legend items change text without changing encodings or symbol sizes', () => {
  const base = chart().createCanvas({ plot: { width: 314, height: 314 }, margin: 180 })
    .createData({ id: 'd', values: [{ x: 1, y: 3, g: 'A' }, { x: 2, y: 5, g: 'B' }] })
    .createScatterPlot({ id: 'p', data: 'd', x: 'x', y: 'y' });
  for (const p of [base.encodeColor({ target: 'p', field: 'x', fieldType: 'quantitative' }).createGuides(),
    base.encodeShape({ target: 'p', field: 'g' }).createGuides({ legend: { target: 'p', channels: ['shape'] } })]) {
    const items = selectableGuides(p).find(g => g.legendPart === 'items');
    const next = edit(p, [items.key], { fontSize: 18 });
    const after = next.guideConfigs.legend[items.family];
    assert.equal(after.labels.fontSize, 18);
    assert.deepEqual(after.titleStyle, items.config.titleStyle);
    assert.deepEqual(after.gradient, items.config.gradient);
    assert.deepEqual(after.symbol, items.config.symbol);
    assert.deepEqual(next.semanticSpec.layers[0].encoding, p.semanticSpec.layers[0].encoding);
  }
});

test('polar and parallel axis title selections retain their native per-axis scope', () => {
  const base = chart().createCanvas({ plot: { width: 314, height: 314 }, margin: 180 })
    .createData({ id: 'd', values: [{ x: 1, y: 3, z: 8, g: 'A' }, { x: 2, y: 5, z: 6, g: 'B' }] });
  for (const p of [base.createRosePlot({ id: 'p', category: 'g', value: 'y' }).createGuides(),
    base.createParallelCoordinates({ id: 'p', dimensions: ['x', 'y', 'z'] }).createGuides()]) {
    const axes = selectableGuides(p).filter(g => g.kind === 'axis');
    const next = edit(p, [axes[0].key], { fontSize: 18 });
    assert.equal(selectedGuideTextTargets(next, [axes[0].key])[0].config.fontSize, 18);
    for (const other of axes.slice(1)) assert.equal(selectedGuideTextTargets(next, [other.key])[0].config.fontSize, other.config.fontSize);
  }
});
