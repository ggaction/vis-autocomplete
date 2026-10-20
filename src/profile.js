import { getDatasetSchema } from 'ggaction/inspection';
import { isTemporalValue } from './data-import.js';

const FIELD_TYPES = new Set(['quantitative', 'nominal', 'ordinal', 'temporal']);
const isoDate = isTemporalValue;

export function profileDataset(program, data, fieldTypes = {}) {
  const { data: resolvedId, schema } = getDatasetSchema(program, { data });
  const dataset = program.semanticSpec.datasets.find(d => d.id === resolvedId);
  const rows = dataset?.values;
  if (!Array.isArray(rows)) throw new Error(`Dataset ${data} has no materialized rows.`);
  for (const [name, hint] of Object.entries(fieldTypes)) {
    const type = typeof hint === 'string' ? hint : hint?.type;
    if (!schema.fields.some(f => f.name === name) || !FIELD_TYPES.has(type)) {
      throw new TypeError(`Invalid field type hint: ${name} = ${type}`);
    }
  }
  const gradient = dataset.transform?.find(t => t.type === 'gradientProfile');
  // Sample arrays and support endpoints are implementation details, not user
  // variables. Expose the category and meaningful per-strip summaries only.
  const exposed = gradient ? new Set([gradient.as.category, gradient.as.center, gradient.as.count]) : null;
  const fields = schema.fields.filter(f => f.name && (!exposed || exposed.has(f.name))).map(field => {
    const values = rows.map(row => row[field.name]);
    const present = values.filter(v => v !== null && v !== undefined);
    const allNumbers = present.length > 0 && present.every(v => typeof v === 'number' && Number.isFinite(v));
    const allCategories = present.length > 0 && new Set(present.map(v => typeof v)).size === 1 && present.every(v =>
      typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)));
    const inferredType = allNumbers ? 'quantitative' : present.length > 0 && present.every(isoDate) ? 'temporal' : 'nominal';
    const hint = fieldTypes[field.name];
    const categoryType = gradient && field.name === gradient.category
      ? Object.values(program.markConfigs).find(c => c.gradientPlot?.profileId === resolvedId)?.gradientPlot?.categoryType : undefined;
    const type = (typeof hint === 'string' ? hint : hint?.type) ?? categoryType ?? inferredType;
    const compatible = type === 'quantitative' ? allNumbers : type === 'temporal'
      ? present.every(v => (typeof v === 'number' && Number.isFinite(v)) || isoDate(v))
      : allCategories;
    const distinct = new Set(present).size;
    let entropy = 0;
    if (allNumbers && distinct > 1) {
      let min = Infinity, max = -Infinity;
      for (const value of present) { min = Math.min(min, value); max = Math.max(max, value); }
      const bins = Array(10).fill(0);
      for (const value of present) bins[Math.min(9, Math.floor((value - min) / (max - min) * 10))]++;
      entropy = -bins.filter(Boolean).reduce((sum, n) => sum + n / present.length * Math.log(n / present.length), 0) / Math.log(10);
    }
    const unique = [...new Set(present)];
    const order = typeof hint === 'object' && Array.isArray(hint.order) ? hint.order.filter(value => unique.includes(value)) : undefined;
    const domain = order ? [...order, ...unique.filter(value => !order.includes(value))] : unique;
    const guideValues = ['nominal', 'ordinal'].includes(type) && distinct > 12
      ? domain.filter((value, i) => i % Math.ceil(domain.length / 6) === 0) : undefined;
    return { name: field.name, type, distinct, guideValues, ...(order ? { order: domain } : {}),
      visualVariation: allNumbers ? 0.55 * Math.min((distinct - 1) / 30, 1) + 0.45 * entropy : 0,
      missing: values.length - present.length,
      numericString: present.length === rows.length && present.length > 0 && present.every(v =>
        typeof v === 'string' && /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v) && Number.isFinite(Number(v))),
      complete: present.length === rows.length,
      // Missingness is handled by each native action's explicit policy. A null
      // does not erase an otherwise correctly typed column from the dataset.
      usable: rows.length > 0 && present.length > 0 && compatible,
      reason: !present.length ? 'No non-missing values.' : !compatible ? `Values do not consistently match ${type}; review this field’s type or missing-value settings.` : '' };
  });
  return { id: resolvedId, rowCount: rows.length, fields,
    datasetType: fields.some(f => f.usable && f.type === 'temporal') ? 'time-series' : 'tabular' };
}

// Only selects default parameters. This NEVER changes the paper action score.
export function preferVisualFields(fields, role = 'position') {
  const score = field => role === 'color' && ['nominal', 'ordinal'].includes(field.type)
    ? (field.distinct >= 2 && field.distinct <= 12 ? 3 - field.distinct / 100 : -1)
    : field.visualVariation ?? 0;
  return [...fields].sort((a, b) => role === 'position' && Boolean(a.complete) !== Boolean(b.complete)
    ? Number(Boolean(b.complete)) - Number(Boolean(a.complete)) : score(b) - score(a));
}
