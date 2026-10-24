import { chartViews } from './composition-context.js';
import { extractFeatures } from './semantics.js';
import { scoreCandidate } from './model.js';

export function compositionRecommendations(program, model, group) {
  if (group !== 'encoding' || !program.compositionSpec || program.compositionSpec.facet) return [];
  const method = 'editCompositionScales', feature = `action.${method}`;
  const share = Object.fromEntries(['x', 'y', 'color'].map(channel => [channel, Boolean(program.compositionSpec.share?.[channel])]));
  const existing = { ...share };
  const current = ['x', 'y', 'color'].find(channel => share[channel]);
  // Releasing an existing sharing policy is always a meaningful default.
  const channel = current ?? 'y'; share[channel] = !share[channel];
  const args = { share }, parameters = Object.keys(share).map(channel => ({ path: `share.${channel}`,
    label: `Share ${channel === 'color' ? 'color' : channel.toUpperCase()}`, type: 'select', value: share[channel],
    choices: [{ value: true, label: 'Shared' }, { value: false, label: 'Independent' }] }));
  const features = [...new Set(chartViews(program).flatMap(({ program }) => extractFeatures(program)))];
  const evidence = scoreCandidate(model, features, feature);
  const appliedOrder = program.trace.children.findLastIndex(node => node.op === method);
  return [{ id: 'composition:scales', method, args, feature, category: 'encoding', label: 'Edit shared scales',
    parameters, score: evidence.score, evidence, executionRoot: true, previouslyApplied: appliedOrder >= 0, appliedOrder,
    alternatives: [channel, ...['x', 'y', 'color'].filter(c => c !== channel)].map(c => {
      const values = { ...existing, [c]: !existing[c] };
      return { method, args: { share: values }, parameters: parameters.map(p => ({ ...p, value: values[p.path.slice(6)] })) };
    }), validation: { status: 'deferred' } }];
}
