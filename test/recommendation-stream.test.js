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

import { createRecommendationStream, collectRecommendationStream } from '../web/recommendation-stream.js';

test('stream sends each preview once while retaining exact ordered defaults at every stage', () => {
  const stream = createRecommendationStream(), collect = collectRecommendationStream();
  const defaults = Array.from({ length: 5 }, (_, i) => ({ action: { method: 'encodeOpacity', args: { value: i / 10 } },
    prepared: i === 3 ? null : { preview: { graphicSpec: { contents: Array(100).fill(i) } } } }));
  let transferred = 0;
  for (const length of [1, 2, 2, 3, 4, 5, 5]) {
    const response = { defaults: defaults.slice(0, length), pagination: { pending: length < 5 }, result: { count: length } };
    const packet = structuredClone(stream(response)); transferred += packet.defaults.length;
    assert.deepEqual(collect(packet), response);
  }
  assert.equal(transferred, 5);
  const fresh = createRecommendationStream(); assert.equal(fresh({ defaults }).defaults.length, 5);
});

test('stream transfers parameter metadata once and preserves completed recommendation identities', () => {
  const send = createRecommendationStream(), receive = collectRecommendationStream();
  const recommendations = Array.from({ length: 15 }, (_, i) => ({ id: `card${i}`, args: { value: i },
    parameters: [{ values: Array.from({ length: 1000 }, (_, n) => n) }] }));
  let transferred = 0, previous = [];
  for (const length of [10, 11, 12, 13, 14, 15, 15]) {
    const response = { defaults: [], result: { recommendations: recommendations.slice(0, length) } };
    const packet = structuredClone(send(response));
    transferred += packet.result.recommendations.length;
    const collected = receive(packet);
    assert.deepEqual(collected, response);
    previous.forEach((value, i) => assert.equal(collected.result.recommendations[i], value));
    previous = collected.result.recommendations;
    assert.deepEqual(receive(packet), response, 'receiving the final packet again must be idempotent');
  }
  assert.equal(transferred, 15, 'later pages must not resend all earlier parameter lists');
});
