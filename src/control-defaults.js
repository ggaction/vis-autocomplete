import { parameterSettings, preferredSetting, settingKey, variantPreference, DEFAULT_PREFERENCES } from './parameter-defaults.js';

const leaves = (controls, parentWhen) => controls.flatMap(c => c.type === 'group'
  ? leaves(c.controls, c.when) : [{ control: c, when: v => (!parentWhen || parentWhen(v)) && (!c.when || c.when(v)) }]);
const same = (a, b) => settingKey(a) === settingKey(b);
const compatible = (args, path, value) => {
  if (!path.endsWith('scale.type') && !path.endsWith('scale.zero')) return true;
  const parent = path.split('.').slice(0, -2).reduce((node, key) => node?.[key], args);
  const type = parent?.fieldType;
  if (path.endsWith('zero')) return type === 'quantitative';
  if (['nominal', 'ordinal'].includes(type)) return ['band', 'point', 'ordinal'].includes(value);
  if (type === 'temporal') return ['time', 'utc'].includes(value);
  return type === 'quantitative' && !['band', 'point', 'ordinal', 'time', 'utc'].includes(value);
};
const allowed = (control, value) => control.type === 'number'
  ? typeof value === 'number' && Number.isFinite(value) && value >= (control.min ?? -Infinity) && value <= (control.max ?? Infinity) &&
    (!control.step || Math.abs((value - (control.min ?? 0)) / control.step - Math.round((value - (control.min ?? 0)) / control.step)) < 1e-7)
  : control.type === 'select' ? control.choices.some(c => !c.disabled && same(c.value, value))
    : control.type === 'color' && typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

// Bind editor controls to native option paths by probing their pure argument
// builder, without running/rendering any speculative ggaction calls. New controls
// automatically participate when their native option path has corpus evidence.
export function applyParameterDefaults(controls, build, recommendation) {
  const { method, defaultEvidence: evidence } = recommendation;
  const entries = leaves(controls), flat = entries.map(e => e.control);
  const values = Object.fromEntries(flat.map(c => [c.key, c.value]));
  const decisions = [];
  if (recommendation.parameterValues) {
    for (const control of flat) if (Object.hasOwn(recommendation.parameterValues, control.key)) {
      control.value = structuredClone(recommendation.parameterValues[control.key]);
    }
    return recommendation.defaultDecisions ?? [];
  }
  if (recommendation.skipParameterDefaults) return [];
  if (!evidence && !DEFAULT_PREFERENCES[method]) return [];
  const set = (control, decision) => {
    if (!decision) return;
    control.value = structuredClone(decision.value); values[control.key] = control.value;
    decisions.push({ control: control.key, ...decision });
  };
  const mode = flat.find(c => c.key === 'mode');
  if (mode) set(mode, preferredSetting(method, evidence, '$mode', v => allowed(mode, v)));
  for (const { control, when } of entries) {
    if (control === mode || control.defaultPolicy === 'context' || !when(values)) continue;
    if (control.key === 'variant') {
      const variants = recommendation.alternatives ?? [];
      const ranked = variants.map((alternative, value) => ({ value,
        score: variantPreference(method, alternative.args, evidence) })).sort((a, b) => b.score - a.score || a.value - b.value);
      if (ranked[0]?.score > 0) set(control, { value: ranked[0].value, source: 'corpus-preset' });
      continue;
    }
    let probe;
    if (control.type === 'number') probe = [values[control.key] + (control.step ?? 1), values[control.key] - (control.step ?? 1)]
      .find(v => allowed(control, v));
    else if (control.type === 'select') probe = control.choices.find(c => !c.disabled && !same(c.value, values[control.key]))?.value;
    else if (control.type === 'color') probe = values[control.key] === '#000000' ? '#ffffff' : '#000000';
    if (probe === undefined) continue;
    try {
      const nativeArgs = build(values);
      const before = parameterSettings(method, nativeArgs);
      const after = parameterSettings(method, build({ ...values, [control.key]: probe }));
      const paths = Object.keys(after).filter(path => same(after[path], probe) && !same(before[path], after[path]));
      // If one control writes several native paths, accept only an agreed mode.
      const choices = paths.map(path => preferredSetting(method, evidence, path,
        v => allowed(control, v) && compatible(nativeArgs, path, v))).filter(Boolean);
      if (choices.length && choices.every(c => same(c.value, choices[0].value))) set(control, choices[0]);
    } catch { /* Dependent controls keep their valid recipe fallback. */ }
  }
  return decisions;
}
