import { resolveMarkItems } from '../vendor/ggaction/src/materialization/selection/policies/index.js';
import { profileDataset } from './profile.js';

const choice = value => ({ value, label: String(value) });
const select = (path, label, value, values) => ({ path, label, type: 'select', value, choices: values.map(choice), defaultPolicy: 'context' });
const cache = new WeakMap();

// Filterable fields come from native final-item provenance. A sector, a whole
// path and a parallel-coordinate observation have different aggregation grains;
// neither mark names nor the presence of Cartesian axes defines eligibility.
export function itemFilterCandidates(program, layer) {
  let targets = cache.get(program);
  if (!targets) cache.set(program, targets = new Map());
  if (!targets.has(layer.id)) targets.set(layer.id, buildCandidates(program, layer));
  return targets.get(layer.id);
}

function buildCandidates(program, layer) {
  if (program.markConfigs[layer.id]?.itemFilterable === false || layer.derivedBindings?.overlay) return [];
  let items;
  try { items = resolveMarkItems(program, layer.id); } catch { return []; }
  const owner = program.markConfigs[layer.id]?.markFilter;
  const data = owner?.source ?? layer.data;
  const rows = program.semanticSpec.datasets.find(dataset => dataset.id === data)?.values ?? [];
  const retained = new Set(owner?.selectors.map(selector => selector.field).filter(Boolean));
  const fields = profileDataset(program, data).fields.filter(field => field.usable).flatMap(field => {
    // Replacing a filter replays the original population. Only its already
    // validated field may use that population without assuming a finer grain.
    if (owner && !retained.has(field.name)) return [];
    if (!owner && (!items.length || items.some(item => !Object.hasOwn(item.fields, field.name)))) return [];
    const values = [...new Set((owner ? rows.map(row => row[field.name]) : items.map(item => item.fields[field.name])).filter(value => value != null))];
    if (values.length < 2) return [];
    if (field.type === 'quantitative' && values.every(Number.isFinite)) return [{ ...field, values: values.sort((a, b) => a - b) }];
    return ['nominal', 'ordinal'].includes(field.type) && values.length <= 50 ? [{ ...field, values }] : [];
  });
  const out = [], categories = fields.filter(field => field.type !== 'quantitative'), numeric = fields.filter(field => field.type === 'quantitative');
  // One recipe owns the dependent variable/value controls; validating every
  // field as a separate preview would multiply work without adding any cards.
  for (const field of categories.slice(0, 1)) {
    const previous = owner?.selectors.find(selector => selector.field === field.name);
    const selected = previous?.values?.filter(value => field.values.includes(value));
    const keep = selected?.length ? selected : [field.values[0]];
    out.push({ method: 'filterMarks', category: 'transform', feature: 'transform.filter', variantGroup: 'categories', label: 'Filter categories',
      args: { target: layer.id, field: field.name, op: 'oneOf', values: keep, mode: 'replace' },
      parameters: [select('field', 'Variable', field.name, categories.map(field => field.name)),
        { ...select('values', 'Keep values', keep, field.values), type: 'multiselect', minimum: 1, selectAll: true,
          choicesBy: { path: 'field', values: Object.fromEntries(categories.map(field => [field.name, field.values.map(choice)])) } }] });
  }
  const ranges = Object.fromEntries(numeric.map(field => [field.name, { min: field.values[0], max: field.values.at(-1),
    step: (field.values.at(-1) - field.values[0]) / 100, value: field.values[Math.floor(field.values.length / 2)] }]));
  for (const field of numeric.slice(0, 1)) {
    const range = ranges[field.name];
    out.push({ method: 'filterMarks', category: 'transform', feature: 'transform.filter', variantGroup: 'fields', label: 'Filter by variable',
      args: { target: layer.id, field: field.name, op: 'gte', value: range.value, mode: 'replace' },
      parameters: [select('field', 'Variable', field.name, numeric.map(field => field.name)),
        { ...select('op', 'Keep values', 'gte', []), choices: [{ value: 'gte', label: 'At least' }, { value: 'lte', label: 'At most' }] },
        { path: 'value', label: 'Threshold', type: 'number', ...range, defaultPolicy: 'context', rangeBy: { path: 'field', values: ranges } }] });
  }
  return out;
}
