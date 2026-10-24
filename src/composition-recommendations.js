import { chartViews, compositionContainers } from './composition-context.js';
import { extractFeatures } from './semantics.js';
import { scoreCandidate } from './model.js';

export function compositionRecommendations(program, model, group) {
  if (group !== 'encoding' || !program.compositionSpec || program.compositionSpec.facet) return [];
  return compositionContainers(program).map(({ program: container, childPath, label }) => {
    const method = 'editCompositionScales', feature = `action.${method}`;
    const target = childPath.length ? { target: { childPath } } : {};
    const share = Object.fromEntries(['x', 'y', 'color'].map(channel => [channel, Boolean(container.compositionSpec.share?.[channel])]));
    const existing = { ...share };
    const current = ['x', 'y', 'color'].find(channel => share[channel]);
    // Releasing an existing sharing policy is always a meaningful default.
    const channel = current ?? 'y'; share[channel] = !share[channel];
    const args = { ...target, share }, parameters = Object.keys(share).map(channel => ({ path: `share.${channel}`,
      label: `Share ${channel === 'color' ? 'color' : channel.toUpperCase()}`, type: 'select', value: share[channel],
      choices: [{ value: true, label: 'Shared' }, { value: false, label: 'Independent' }] }));
    const features = [...new Set(chartViews(program).flatMap(({ program }) => extractFeatures(program)))];
    const evidence = scoreCandidate(model, features, feature);
    const appliedOrder = program.trace.children.findLastIndex(node => node.op === method &&
      JSON.stringify(node.args?.target?.childPath ?? []) === JSON.stringify(childPath));
    return { id: `composition:scales:${JSON.stringify(childPath)}`, method, args, feature, category: 'encoding', label: `Edit shared scales · ${label}`,
      parameters, score: evidence.score, evidence, executionRoot: true, previouslyApplied: appliedOrder >= 0, appliedOrder,
      alternatives: [channel, ...['x', 'y', 'color'].filter(c => c !== channel)].map(c => {
        const values = { ...existing, [c]: !existing[c] };
        return { method, args: { ...target, share: values }, parameters: parameters.map(p => ({ ...p, value: values[p.path.slice(6)] })) };
      }), validation: { status: 'deferred' } };
  });
}
