import assert from 'node:assert/strict';
import { applyRecommendation } from '../../src/engine.js';

// Replay the exported public calls independently of the cached preview.
export function replayPrepared(prepared, guides = true) {
  let program = applyRecommendation(prepared.actionBase, prepared.recommendation);
  for (const call of prepared.postActionCalls ?? []) program = program[call.method](call.args);
  return guides ? program[prepared.guideCall.method](prepared.guideCall.args) : program;
}
export function assertPreparedTrace(prepared) {
  const before = prepared.actionBase.trace.children;
  const after = prepared.authoringPreview.trace.children;
  assert.deepEqual(after.slice(0, before.length), before);
  assert.deepEqual(after.slice(before.length).map(node => node.op),
    [prepared.recommendation.method, ...(prepared.postActionCalls ?? []).map(call => call.method)]);
  assert.equal(prepared.recommendation.validation.topLevelActions, 1);
}
