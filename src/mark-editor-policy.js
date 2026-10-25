import { actionFeatures } from './semantics.js';

// A mark editor owns geometry/typography only when a dedicated encoding card
// already offers the same fixed appearance control for this exact target.
// Apply this after all recipe sources so corpus presets cannot reintroduce it.
const encodings = {
  opacity: 'encodeOpacity', fill: 'encodeColor', stroke: 'encodeStroke',
  strokeWidth: 'encodeStrokeWidth', strokeDash: 'encodeStrokeDash',
  radius: 'encodeSize', shape: 'encodeShape', angle: 'encodeAngle', width: 'encodeBarWidth',
};
const editors = /^edit(Point|Bar|Line|Area|Rect|Arc|Rule|Text|Tick)Mark$/;
const labels = { cornerRadius: 'Adjust corner radius', length: 'Adjust tick length',
  lineJoin: 'Adjust line joins', shape: 'Set point shape', opacity: 'Adjust mark opacity' };

export function focusMarkEditors(candidates) {
  const fixed = new Map();
  for (const candidate of candidates) {
    if (candidate.args.value === undefined && candidate.args.pixels === undefined) continue;
    if (!fixed.has(candidate.args.target)) fixed.set(candidate.args.target, new Set());
    fixed.get(candidate.args.target).add(candidate.method);
  }
  return candidates.flatMap(candidate => {
    if (!editors.test(candidate.method)) return [candidate];
    const covered = path => fixed.get(candidate.args.target)?.has(encodings[path.split('.')[0]]);
    const args = Object.fromEntries(Object.entries(candidate.args).filter(([key]) => !covered(key)));
    let parameters = candidate.parameters?.filter(parameter => !covered(parameter.path));
    // Arc geometry has its own unit-aware controls. Its appearance recipe uses
    // the same pruning policy as every other mark editor.
    const arcAppearance = candidate.arcContext && candidate.args.innerRadius === undefined && candidate.args.padAngle === undefined;
    if (arcAppearance) {
      const context = candidate.arcContext;
      parameters = [
        { path: 'opacity', label: 'Opacity', type: 'number', value: args.opacity ?? context.opacity, min: .05, max: 1, step: .05 },
        { path: 'strokeWidth', label: 'Stroke width', type: 'number', value: args.strokeWidth ?? context.strokeWidth, min: 0, max: 6, step: .25 },
      ].filter(p => !covered(p.path));
    }
    if (Object.keys(args).every(key => key === 'target')) {
      // The old opacity change used to make this recipe non-empty. Propose a
      // real change to its remaining geometry instead, without touching color.
      const first = parameters?.find(p => !p.whenPath);
      const value = first?.type === 'number'
        ? first.value + (first.step ?? 1) <= first.max ? first.value + (first.step ?? 1) : first.value - (first.step ?? 1)
        : first?.choices?.find(choice => !choice.disabled && choice.value !== first.value)?.value;
      if (value === undefined || first.type === 'number' && value < first.min) return [];
      args[first.path] = value;
      parameters = parameters.map(p => p === first ? { ...p, value, omitUnchanged: false } : p);
    }
    return [{ ...candidate, args, feature: actionFeatures(candidate.method, args)[0] ?? candidate.feature, ...(arcAppearance ? { arcContext: undefined } : {}), ...(parameters ? { parameters } : {}),
      ...(parameters?.length === 1 && labels[parameters[0].path] ? { label: labels[parameters[0].path] } : {}) }];
  });
}
