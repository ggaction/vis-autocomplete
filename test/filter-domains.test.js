import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { extendedCandidates } from '../src/extended-catalog.js';
import { generateCandidates } from '../src/catalog.js';
import { profileDataset } from '../src/profile.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';
import { prepareGuidedAction } from '../src/prepare.js';
import { barGrain } from '../src/mark-grain.js';
import { resolveMarkItems } from '../vendor/ggaction/src/materialization/selection/policies/index.js';

const data = [2, 12, 22, 32, 42].flatMap((x, i) => ['A', 'B'].map(group => ({ x, y: 50 - i * 10, group })));
const base = (values = data) => chart().createCanvas({ plot: { width: 314, height: 314 }, margin: 100 }).createData({ id: 'dataset', values });
const recipes = p => {
  const layer = p.semanticSpec.layers.find(l => l.id === 'plot');
  return extendedCandidates(p, { layer, profile: profileDataset(p, layer.data) });
};
const bars = () => base().createBarPlot({ id: 'plot', x: { field: 'x', bin: { boundaries: [0, 10, 20, 30, 40, 50] } }, y: { field: 'y', aggregate: 'sum' } });

test('threshold card switches X/Y using real bin starts and bar endpoints, then fits its native preview', () => {
  const p = bars(), filters = recipes(p).filter(c => c.method === 'filterMarks' && c.args.channel);
  const x = filters.find(c => c.args.channel === 'x');
  const editor = recommendationParameters({ ...x, alternatives: filters }, profileDataset(p, 'dataset'));
  const values = valuesFor(editor.controls);
  assert.deepEqual(editor.controls[0].choices.map(c => [c.value, c.label]), [['x', 'X'], ['y2', 'Y']]);
  assert.equal(editor.controls[2].min, 0); assert.equal(editor.controls[2].max, 40);
  const next = prepareGuidedAction(p, { method: 'filterMarks', args: editor.build({ ...values, p2: 30 }) });
  assert.deepEqual(next.preview.resolvedScales.x.domain, [30, 50]);
  assert.equal(next.preview.graphicSpec.objects.plot.items.length, 2);
  assert.equal(next.recommendation.validation.topLevelActions, 1);
  const yValues = editor.normalizeValues({ ...values, p0: 'y2' }, 'p0');
  assert.equal(editor.resolveControls(yValues)[2].min, 20);
  assert.equal(editor.resolveControls(yValues)[2].max, 100);
  const lower = prepareGuidedAction(p, { method: 'filterMarks', args: editor.build({ ...yValues, p1: 'lte', p2: 40 }) });
  assert.deepEqual(lower.preview.resolvedScales.x.domain, [30, 50]);
  assert.deepEqual(lower.preview.resolvedScales.y.domain, [0, 40]);
});

test('subsequent recommendation generation keeps semantic bins separate from fitted display domains', () => {
  const filtered = bars().filterMarks({ target: 'plot', channel: 'x', op: 'gte', value: 30 });
  const layer = filtered.semanticSpec.layers.find(l => l.id === 'plot');
  assert.deepEqual(barGrain(filtered, layer).values.x, [35, 45]);
  assert.ok(recipes(filtered).some(c => c.method === 'filterMarks'));
  const candidates = generateCandidates(filtered, { layer, profile: profileDataset(filtered, layer.data) });
  assert.ok(candidates.some(c => c.method === 'encodeColor'));
});

test('threshold bounds match actual native endpoint values for stacked, horizontal and raw numeric bars', () => {
  const variants = [
    bars().encodeColor({ target: 'plot', field: 'group' }).layoutSeries({ target: 'plot', mode: 'stack' }),
    base(data.map(row => ({ ...row, y: row.group === 'B' ? row.y / 2 : row.y })))
      .createBarPlot({ id: 'plot', x: { field: 'y', aggregate: 'mean' }, y: { field: 'group', fieldType: 'nominal' } }),
    base().createBarPlot({ id: 'plot', x: 'x', y: 'y' }),
  ];
  for (const p of variants) {
    const items = resolveMarkItems(p, 'plot');
    const filters = recipes(p).filter(c => c.method === 'filterMarks' && c.label === 'Filter values');
    assert.ok(filters.length > 0);
    for (const c of filters) {
      const values = items.map(item => item.channels[c.args.channel]);
      const control = c.parameters.find(p => p.path === 'value');
      assert.equal(control.min, Math.min(...values)); assert.equal(control.max, Math.max(...values));
      assert.ok(p.filterMarks(c.args).graphicSpec.objects.plot.items.length > 0);
    }
  }
});

test('Cars numeric-bin bars and histograms fit the actual retained intervals from the threshold card', () => {
  const rows = JSON.parse(readFileSync(new URL('../web/data/cars.json', import.meta.url)));
  const source = base(rows.filter(row => row.Horsepower != null && row.Miles_per_Gallon != null));
  const plots = [
    source.createHistogram({ id: 'plot', data: 'dataset', field: 'Horsepower', maxBins: 12 }),
    source.createBarPlot({ id: 'plot', data: 'dataset', x: { field: 'Horsepower', bin: { maxBins: 12 } },
      y: { field: 'Miles_per_Gallon', aggregate: 'mean' } }),
  ];
  for (const p of plots) {
    const recipe = recipes(p).find(c => c.method === 'filterMarks' && c.args.channel === 'x');
    const preview = prepareGuidedAction(p, recipe).preview;
    const items = resolveMarkItems(preview, 'plot');
    assert.ok(items.length > 0 && items.length < resolveMarkItems(p, 'plot').length);
    assert.deepEqual(preview.resolvedScales.x.domain,
      [Math.min(...items.map(item => item.channels.x)), Math.max(...items.map(item => item.channels.x2))]);
    assert.ok(preview.resolvedScales.x.domain[0] > p.resolvedScales.x.domain[0]);
  }
});

test('threshold recipes remain available on a facet source without a rendered rect collection', () => {
  const faceted = bars().facet({ field: 'group', data: 'dataset', columns: 2 });
  assert.equal(faceted.graphicSpec.objects.plot, undefined);
  const candidates = recipes(faceted).filter(c => c.method === 'filterMarks' && c.label === 'Filter values');
  assert.deepEqual(candidates.map(c => c.args.channel), ['x', 'y2']);
  const x = candidates.find(c => c.args.channel === 'x');
  const next = faceted.editFacetSource({ action: { method: x.method, options: { ...x.args, value: 30 } } });
  for (const child of Object.values(next.children)) {
    assert.deepEqual(child.resolvedScales.x.domain, [30, 50]);
    assert.equal(child.graphicSpec.objects.plot.items.length, 2);
  }
});
