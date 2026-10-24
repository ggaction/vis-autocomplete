import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { serializeProgram } from '../vendor/ggaction/src/persistence.js';
import { defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';

const rows = Array.from({ length: 40 }, (_, i) => ({ x: i, y: i + 1,
  category: `Group ${i % 20}`, panel: i < 20 ? 'A' : 'B' }));
for (const facet of [false, true]) for (const position of (facet ? ['right', 'top'] : ['right', 'top-right', 'bottom-left', 'top'])) {
  test(`Show all preserves all legend entries and ${position} placement${facet ? ' in facets' : ''}`, () => {
    let p = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows })
      .createScatterPlot({ id: 'plot', x: 'x', y: 'y', color: 'category' })
      .createLegend({ target: 'plot', channels: ['color'], position, overflow: { maxItems: 6 } });
    if (facet) p = p.facet({ field: 'panel', columns: 2, guides: { legend: 'shared' } });
    const before = serializeProgram(p);
    const action = { method: 'editLegend', args: { target: 'plot', channel: 'color',
      position, overflow: false, labels: { fontSize: 16 }, itemGap: 24 } };
    const result = prepareGuidedAction(p, action);
    const config = result.preview.guideConfigs.legend.color;
    assert.equal(config.overflow, false);
    assert.equal(config.position, position);
    assert.equal(config.labels.fontSize, 16);
    assert.equal(config.itemGap, 24);
    assert.deepEqual(serializeProgram(p), before);
    let replay = p;
    for (const call of result.prerequisiteCalls) replay = replay[call.method](call.args);
    replay = replay[action.method](action.args);
    for (const call of result.postActionCalls) replay = replay[call.method](call.args);
    assert.deepEqual(serializeProgram(replay), serializeProgram(result.authoringPreview));
    assert.ok(Object.values(result.preview.graphicSpec.objects).some(obj => obj.items?.length === 20));
  });
}
