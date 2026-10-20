import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';
import { profileDataset } from '../src/profile.js';
import { generateCandidates } from '../src/catalog.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';
import { actionTitle } from '../src/action-labels.js';

const rows = JSON.parse(readFileSync(new URL('../web/data/barley.json', import.meta.url)));
function gradient(category, horizontal) {
  const base = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows });
  const c = { field: category, fieldType: category === 'year' ? 'ordinal' : 'nominal' };
  const q = { field: 'yield', fieldType: 'quantitative' };
  return prepareGuidedAction(base, { method: 'createGradientPlot', args: {
    id: 'plot', data: 'data', x: horizontal ? q : c, y: horizontal ? c : q,
  } }).preview;
}
function candidates(p) {
  const layer = p.semanticSpec.layers.find(l => l.id === 'plot');
  const profile = profileDataset(p, layer.data);
  return { profile, cards: generateCandidates(p, { layer, profile }) };
}

for (const category of ['site', 'variety', 'year']) for (const horizontal of [false, true]) {
  test(`Barley gradient ${category}/${horizontal}: meaningful fields and native editors`, () => {
    const p = gradient(category, horizontal), { profile, cards } = candidates(p);
    assert.deepEqual(profile.fields.map(f => f.name), [category, '__gradientPlot_center', '__gradientPlot_count']);
    assert.equal(profile.fields[0].type, category === 'year' ? 'ordinal' : 'nominal');
    const edits = cards.filter(c => c.method === 'editGradientPlot');
    for (const label of ['Adjust density', 'Adjust density colors', 'Adjust gradient width', 'Edit gradient center', 'Edit distribution variables']) {
      assert.ok(edits.some(c => c.label === label), label);
    }
    for (const card of edits) {
      const editor = recommendationParameters({ ...card, skipParameterDefaults: true }, profile);
      const values = valuesFor(editor.controls);
      assert.ok(editor.controls.length <= 4);
      assert.equal(actionTitle(card), card.label);
      for (const control of editor.resolveControls(values)) {
        const probes = control.type === 'number' ? [control.min, control.max] : control.choices.filter(c => !c.disabled).map(c => c.value);
        for (const value of probes) {
          const args = editor.build({ ...values, [control.key]: value });
          let next;
          try {
            const prepared = prepareGuidedAction(p, { method: card.method, args });
            next = prepared.preview;
            assert.equal(prepared.recommendation.validation.topLevelActions, 1);
          } catch (error) {
            if (error.reason !== 'no-change') throw error;
            next = p[card.method](args);
          }
          assert.ok(next.graphicSpec.objects.plot.items.length);
        }
      }
    }
    const colored = prepareGuidedAction(p, { method: 'encodeColor', args: { target: 'plot', field: category, fieldType: category === 'year' ? 'ordinal' : 'nominal' } }).preview;
    assert.equal(colored.semanticSpec.guides.legend.color.scale, 'color');
    assert.ok(colored.graphicSpec.objects.plotDensityLegend);
    const fixed = prepareGuidedAction(colored, { method: 'encodeColor', args: { target: 'plot', value: '#e45756' } }).preview;
    assert.notDeepEqual(fixed.graphicSpec.objects.plot.items, colored.graphicSpec.objects.plot.items);
    assert.equal(fixed.graphicSpec.objects.plot.items[0].properties.fill.type, 'linear-gradient');
    const statistic = cards.find(c => c.method === 'createStatisticalReference');
    assert.equal(statistic.args.population, 'boundData');
    assert.ok(statistic.statisticalContext.groupFields.some(f => f.name === 'site'));
    const withStatistic = prepareGuidedAction(colored, { method: statistic.method, args: { ...statistic.args, groupBy: 'site' } }).preview;
    const reference = Object.values(withStatistic.markConfigs).find(c => c.statisticalReference)?.statisticalReference;
    assert.equal(withStatistic.semanticSpec.datasets.find(d => d.id === reference.dataId).values.length, 6);
  });
}

test('Barley gradient facet retains resolved domains and category edits replace stale ticks', () => {
  const p = gradient('site', false);
  const faceted = prepareGuidedAction(p, { method: 'facet', args: { field: 'site', data: 'data',
    columns: 3, spacing: 'plot', gap: 12, guides: { axes: 'outer', legend: false } } }).preview;
  assert.equal(Object.keys(faceted.children).length, 6);
  const colored = p.encodeColor({ target: 'plot', field: 'site' });
  const revised = prepareGuidedAction(colored, { method: 'editGradientPlot', args: {
    target: 'plot', x: { field: 'variety', fieldType: 'nominal' },
  } }).preview;
  assert.equal(revised.semanticSpec.layers[0].encoding.color.field, 'variety');
  assert.equal(revised.graphicSpec.objects.plot.items.length, 10);
  assert.ok(revised.guideConfigs.axis.x.ticks.values.every(value => rows.some(row => row.variety === value)));
});
