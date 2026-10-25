import test from 'node:test';
import assert from 'node:assert/strict';
import { instantiatePlotData } from '../src/plot-setup.js';

test('plot setup allocates independent IDs and rewrites complete dependency chains, not data literals', () => {
  const setup = [
    { method: 'filterData', args: { id: 'selected', source: 'input', field: 'summary', noneOf: ['selected'] } },
    { method: 'createComputedData', args: { id: 'computed', source: 'selected', as: 'selected', expression: { constant: 'summary' } } },
    { method: 'createSummaryData', args: { id: 'summary', source: 'computed', groupBy: ['selected'], aggregates: [{ op: 'mean', field: 'summary', as: 'summary' }] } },
    { method: 'createCompleteData', args: { id: 'aligned', source: 'summary', key: 'selected', fill: { summary: 0 } } },
  ];
  const options = { id: 'plot', data: 'aligned', x: { field: 'selected' }, y: { field: 'summary' }, color: { value: 'selected' } };
  const before = JSON.stringify({ setup, options });
  const datasets = ['input', 'selected', 'summary', 'chart2-selected', 'chart2-selected-2'].map(id => ({ id }));
  const plan = instantiatePlotData(options, setup, datasets, 'chart2');
  assert.deepEqual(plan.calls.map(c => c.args.id), ['chart2-selected-3', 'chart2-computed', 'chart2-summary', 'chart2-aligned']);
  assert.deepEqual(plan.calls.map(c => c.args.source), ['input', 'chart2-selected-3', 'chart2-computed', 'chart2-summary']);
  assert.equal(plan.options.data, 'chart2-aligned');
  for (let i = 0; i < setup.length; i++) {
    const { id: _id, source: _source, ...rest } = plan.calls[i].args;
    const { id, source, ...original } = setup[i].args;
    assert.deepEqual(rest, original);
  }
  assert.deepEqual({ ...plan.options, data: 'aligned' }, options);
  assert.equal(JSON.stringify({ setup, options }), before);
  assert.deepEqual(instantiatePlotData(options, setup, datasets, 'chart2'), plan, 'repeated preview plans are deterministic');
});

test('only setup-owned datasets are renamed and non-data prerequisites keep their own meaning', () => {
  const options = { data: 'existing', x: 'field' };
  const layout = { method: 'editCompositionLayout', args: { id: 'existing', gap: 4 } };
  assert.deepEqual(instantiatePlotData(options, [layout], [{ id: 'existing' }], 'chart2'), { options, calls: [layout] });
  assert.throws(() => instantiatePlotData(options, [
    { method: 'filterData', args: { id: 'duplicate', source: 'existing' } },
    { method: 'createSummaryData', args: { id: 'duplicate', source: 'existing' } },
  ], [], 'chart2'), /declares dataset.*twice/);
});
