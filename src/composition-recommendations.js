import { chartViews, compositionContainers } from './composition-context.js';
import { extractFeatures } from './semantics.js';
import { scoreCandidate } from './model.js';
import { DEFAULT_TITLE_FONT_SIZE } from './parameter-defaults.js';
import { compositionPlotBounds } from '../vendor/ggaction/src/materialization/composition.js';

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

// All owns one composition title; individual targets keep their local title.
export function compositionTitleRecommendations(recommendations, program, model, all) {
  if (!all || !program.compositionSpec || program.compositionSpec.facet) return recommendations;
  let emitted = false;
  return recommendations.flatMap(rec => {
    if (!['createTitle', 'editTitle'].includes(rec.method)) return [rec];
    if (emitted) return [];
    emitted = true;
    const title = program.semanticSpec.title, config = program.titleConfig;
    const method = title.text === undefined ? 'createTitle' : 'editTitle';
    const feature = method === 'createTitle' ? 'guide.title' : 'action.editTitle';
    const frame = compositionPlotBounds(program);
    const args = { ...config, text: title.text ?? rec.args.text, position: config?.position ?? 'top',
      titleStyle: { fontFamily: 'Arial', fontSize: DEFAULT_TITLE_FONT_SIZE, ...config?.titleStyle },
      ...(title.subtitle === undefined ? {} : { subtitle: title.subtitle }),
      ...(config?.subtitleStyle ? { subtitleStyle: { ...config.subtitleStyle } } : {}) };
    const evidence = scoreCandidate(model, [...new Set(chartViews(program).flatMap(({ program }) => extractFeatures(program)))], feature);
    const appliedOrder = program.trace.children.findLastIndex(node => ['createTitle', 'editTitle'].includes(node.op) && !node.args?.target);
    return [{ ...rec, id: 'composition:title', method, args, feature, executionRoot: true, titleWrapBounds: { width: frame.width, height: frame.height },
      label: method === 'createTitle' ? 'Add a title' : 'Edit title', inspectionTarget: undefined,
      editingScope: undefined, parameters: undefined, alternatives: [{ method, args }],
      score: evidence.score, evidence, previouslyApplied: appliedOrder >= 0, appliedOrder }];
  });
}
