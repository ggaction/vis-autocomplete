import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { createCalculationService } from '../web/calculation-service.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';
import { defaultCanvasOptions } from '../src/prepare.js';

test('incremental pages keep exact batch ranking, defaults and pagination through interruptions', () => {
  const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
  const program = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values:
    Array.from({ length: 12 }, (_, i) => ({ x: i + 1, y: i * 2 + 1, group: i % 2 ? 'A' : 'B' })) })
    .createScatterPlot({ id: 'plot', x: 'x', y: 'y', color: 'group' });
  const full = createCalculationService(model), incremental = createCalculationService(model);
  const state = { type: 'state', stateId: 1, snapshot: serializeProgram(program), guideCall: { method: 'createGuides', args: {} } };
  full.execute(state); incremental.execute(state);
  const request = { type: 'recommend', stateId: 1, options: { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS }, group: 'encoding' };
  for (const page of [0, 1, 2]) {
    const expected = full.execute({ ...request, page });
    if (page === 0) assert.equal(expected.defaults.length, 5);
    let value, previous = [], slices = 0;
    do {
      value = incremental.execute({ ...request, page, batchSize: 1 }); slices++;
      assert.ok(value.pagination.pageCount >= Math.ceil(value.result.recommendations.length / 5),
        'the page count includes the cards already streamed into a partial page');
      assert.deepEqual(value.result.recommendations.slice(0, previous.length), previous);
      previous = value.result.recommendations;
      // A different tab can run between candidates; revisiting resumes this deck.
      incremental.execute({ ...request, group: 'style', batchSize: 1 });
      assert.ok(slices < 300);
    } while (value.pagination.pending);
    assert.deepEqual(value, expected);
    for (const range of value.pagination.pageRanges.slice(0, -1)) assert.equal(range.end - range.start, 5);
    if (expected.pagination.complete && page + 1 >= expected.pagination.pageCount) break;
  }
});
