import { profileDataset, preferVisualFields } from './profile.js';
import { barGrain } from './mark-grain.js';
const cache = new WeakMap();

// Describe the same populations the native reference action reads, axis by
// axis. Density/ECDF X describes observations; their Y describes derived values.
// Group fields must come from that population, not always from the input table.
export function statisticalContext(program, layer, owner) {
  if (!cache.has(program)) cache.set(program, new Map());
  const contexts = cache.get(program);
  if (contexts.has(layer.id)) return contexts.get(layer.id);
  if (!['x', 'y'].some(axis => layer.encoding[axis]?.fieldType === 'quantitative')) return { series: false, axes: {}, groupFields: [] };
  const datasets = new Map(program.semanticSpec.datasets.map(data => [data.id, data]));
  const visible = datasets.get(layer.data), series = ['line', 'area', 'text'].includes(layer.mark.type);
  let bound = visible;
  while (bound?.transform?.length === 1 && bound.transform[0].type === 'markFilter' && bound.transform[0].target === layer.id) bound = datasets.get(bound.source);
  const transform = bound?.transform?.length === 1 ? bound.transform[0] : undefined;
  const parent = datasets.get(bound?.source);
  const fieldCache = new Map();
  const fieldsFor = data => {
    if (!fieldCache.has(data.id)) fieldCache.set(data.id, preferVisualFields(profileDataset(program, data.id).fields
      .filter(field => field.usable && field.complete && field.distinct > 1), 'color'));
    return fieldCache.get(data.id);
  };
  const visibleFields = fieldsFor(visible);
  const groupFields = (data, visibleItems = false) => fieldsFor(data).map(field => ({ name: field.name,
    visibleItems: visibleItems && !series && visibleFields.some(item => item.name === field.name) &&
      (layer.mark.type !== 'bar' || barGrain(program, layer).constant(field.name)) }));
  const axes = {};
  for (const axis of ['x', 'y']) {
    const encoding = layer.encoding[axis];
    if (encoding?.fieldType !== 'quantitative') continue;
    let observation;
    if (transform?.type === 'density' && encoding.field === transform.as[0]) observation = transform.field;
    else if (transform?.type === 'ecdf' && encoding.field === transform.as.value) observation = transform.field;
    else if (transform?.type === 'boxSummary' && transform.method !== 'precomputed' && Object.values(transform.as).includes(encoding.field)) observation = transform.field;
    else if (transform?.type === 'gradientProfile' && ['lower', 'upper', 'center'].some(key => encoding.field === transform.as?.[key])) observation = transform.field;
    else if (transform?.type === 'summary' && owner?.method === 'editEndpointPlot') observation = transform.aggregates.find(item => item.as === encoding.field)?.field;
    else if (transform?.type === 'horizon' && encoding.field === transform.as.x) observation = transform.x.field;
    const data = observation && parent ? parent : bound;
    const groups = groupFields(data, true);
    let itemCount = visible.values.length, aggregate = Boolean(encoding.aggregate);
    if (layer.mark.type === 'bar') {
      const grain = barGrain(program, layer);
      itemCount = grain.values?.[axis]?.length ?? grain.cells.length;
      aggregate ||= ['aggregate', 'histogram'].includes(grain.grain);
    }
    const derived = data !== visible ? false : Boolean(transform);
    const populations = [
      { value: 'visibleItems', label: `Visible marks (${itemCount})`, disabled: series,
        reason: series ? 'A line or area represents a series. Use its axis values or original observations.' : undefined,
        groups: groupFields(visible, true) },
      { value: 'boundData', label: observation ? `Original observations (${data.values.length})`
        : aggregate ? `Aggregated axis values${series ? '' : ` (${itemCount})`}`
          : derived ? `Derived axis values (${data.values.length})` : `Bound observations (${data.values.length})`, groups },
    ];
    // An explicit field bypasses mark aggregation in the public API. This
    // distinguishes mean(sum(Y)) from mean(Y) without a second action.
    if (aggregate && !observation && data.values.length && data.values.every(row => Number.isFinite(row[encoding.field]))) {
      populations.push({ value: 'observations', label: `Original observations (${data.values.length})`,
        field: encoding.field, groups: groupFields(data) });
    }
    axes[axis] = { populations, defaultPopulation: series || observation ? 'boundData' : 'visibleItems' };
  }
  const result = { series, axes, groupFields: [...new Map(Object.values(axes).flatMap(axis => axis.populations.flatMap(p => p.groups))
    .map(field => [field.name, field])).values()],
    ...(owner?.statisticalAxes ? { axisChoices: ['x', 'y'].filter(channel => layer.encoding[channel]?.fieldType === 'quantitative')
      .map(value => ({ value, label: value, disabled: !owner.statisticalAxes.includes(value),
        reason: owner.statisticalAxes.includes(value) ? undefined : owner.statisticalAxisReason })) } : {}) };
  contexts.set(layer.id, result);
  return result;
}
