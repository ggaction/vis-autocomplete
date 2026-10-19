// Corpus evidence selects defaults only; action ranking and field binding stay separate.
// Never transfer dataset-specific names, IDs, expressions or user-authored text.
const settings = new Set(('aggregate method type palette position opacity fill stroke strokeWidth strokeDash shape angle ' +
  'fontSize fontFamily fontWeight offset count columns gap padding cornerRadius level bandwidth bins maxbins ' +
  'steps extent normalize mode order direction orient tension interpolate lineWidth size radius maxOffset seed maxBins ' +
  'anchor content align baseline zero nice clamp reverse scheme range').split(' '));
const appearance = /^encode(Color|Stroke|Opacity|Size|StrokeWidth|StrokeDash|Angle|Shape)$/;
export const MIN_DEFAULT_CHARTS = 3;
export const DEFAULT_PREFERENCES = { encodeStroke: { $mode: 'fixed', value: '#000000' } };
export const settingKey = value => JSON.stringify(value);

export function parameterSettings(method, args) {
  const out = {};
  const visit = (value, path = []) => {
    if (typeof value === 'symbol' || value === undefined || value === null) return;
    const key = path.at(-1);
    if (['target', 'id', 'source', 'data', 'field', 'fields', 'fieldType', 'groupBy', 'text', 'title', 'expression', '__dynamicSpread'].includes(key)) return;
    if (Array.isArray(value)) {
      if ((settings.has(key) || key === 'value' && appearance.test(method)) &&
        value.length <= 16 && value.every(v => typeof v === 'number' && Number.isFinite(v))) out[path.join('.')] = value;
      // Range handles edit individual endpoints; keep their evidence as well.
      if (key === 'range') value.forEach((v, i) => { if (Number.isFinite(v)) out[[...path, i].join('.')] = v; });
      return;
    }
    if (typeof value === 'object') {
      if (path.length < 7) for (const [k, v] of Object.entries(value)) visit(v, [...path, k]);
      return;
    }
    if ((settings.has(key) || key === 'value' && appearance.test(method)) &&
      ['number', 'string', 'boolean'].includes(typeof value) &&
      (typeof value !== 'number' || Number.isFinite(value))) out[path.join('.')] = value;
  };
  visit(args);
  if (appearance.test(method)) {
    if (typeof args.field === 'string') out.$mode = 'variable';
    else if (Object.hasOwn(args, 'value') && typeof args.value !== 'symbol') out.$mode = 'fixed';
  }
  return out;
}

export function settingDistribution(evidence, path) {
  const record = evidence?.settings?.[path];
  return record?.charts >= MIN_DEFAULT_CHARTS ? record : undefined;
}

export function preferredSetting(method, evidence, path, accepts = () => true) {
  const override = DEFAULT_PREFERENCES[method]?.[path];
  if (override !== undefined && accepts(override)) return { value: override, source: 'project-preference' };
  const distribution = settingDistribution(evidence, path);
  const winner = distribution?.values.find(entry => accepts(entry.value));
  return winner && { ...winner, source: 'corpus', observedCharts: distribution.charts, path };
}

// Choose among already-generated, compatible bindings; never copy a corpus field.
export function variantPreference(method, args, evidence) {
  const values = parameterSettings(method, args);
  let score = 0;
  for (const [path, value] of Object.entries(values)) {
    const override = DEFAULT_PREFERENCES[method]?.[path];
    if (override !== undefined) score += settingKey(value) === settingKey(override) ? 1000 : -1000;
    else {
      const distribution = settingDistribution(evidence, path);
      const found = distribution?.values.find(v => settingKey(v.value) === settingKey(value));
      if (found) score += (path === '$mode' ? 10 : 1) * found.weight / distribution.charts;
    }
  }
  return score;
}
