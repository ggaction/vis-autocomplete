import { describeAction } from 'ggaction/inspection';
import { hasChartContext } from './chart-context.js';
import { profileDataset, preferVisualFields } from './profile.js';
import { defaultFacetColumns } from './facet-layout.js';
import { chartOwner } from './chart-owner.js';
const select = (path, label, value, values) => ({ path, label, type: 'select', value,
  choices: values.map(value => ({ value, label: String(value) })) });
const number = (path, label, value, min, max, step = 1) => ({ path, label, type: 'number', value, min, max, step });

export function facetCandidates(program, { layer, profile }) {
  if (!layer) return [];
  const facet = program.compositionSpec?.facet;
  const cartesian = program.semanticSpec.coordinates.find(c => c.id === layer.coordinate)?.type === 'cartesian';
  if (facet) {
    const spec = program.compositionSpec, out = [];
    const add = (method, category, args, parameters, label) => out.push({ method, category, args, parameters,
      feature: `action.${method}`, label, compositionAction: true });
    add('editCompositionLayout', 'style', { ...(facet.grid ? {} : { columns: spec.columns === 1 ? 2 : 1 }), spacing: 'plot', gap: spec.gap === 12 ? 16 : 12 },
      [...(facet.grid ? [] : [number('columns', 'Columns', spec.columns === 1 ? 2 : 1, 1, Math.max(6, Object.keys(program.children).length))]), number('gap', 'Minimum gap', spec.gap === 12 ? 16 : 12, 0, 40)], 'Arrange facets');
    const channels = ['x', 'y', 'color'].filter(c => layer.encoding?.[c]?.scale);
    if (channels.length) {
      const resolutions = Object.fromEntries(channels.map(c => [c, facet.scales[c] ?? 'shared']));
      const first = channels.find(channel => channel !== 'color') ?? channels[0];
      resolutions[first] = resolutions[first] === 'shared' ? 'independent' : 'shared';
      add('editFacetScales', 'encoding', resolutions, channels.map(c => select(c, `${c.toUpperCase()} scales`, resolutions[c], ['shared', 'independent'])), 'Facet scales');
    }
    add('editFacetHeaders', 'style', { fontSize: 13, offset: 10 },
      [number('fontSize', 'Header size', 13, 8, 22), number('offset', 'Header offset', 10, 0, 24),
        select('fontWeight', 'Font weight', 'bold', ['normal', 'bold']),
        { path: 'color', label: 'Text color', type: 'color', value: '#555555',
          choices: ['#000000', '#555555', '#9ca3af', '#4c78a8'].map(value => ({ value, label: value })) }], 'Facet headers');
    const axes = facet.guides.axes === 'outer' ? 'each' : 'outer';
    const legend = facet.guides.legend;
    const hasLegend = Object.values(program.guideConfigs.legend ?? {}).length > 0 ||
      Object.values(program.children).some(child => Object.keys(child.guideConfigs.legend ?? {}).length > 0);
    if (cartesian || hasLegend) add('editFacetGuides', 'style', cartesian ? { axes } : { legend: legend === false ? 'shared' : false },
      [...(cartesian ? [select('axes', 'Axes', axes, ['each', 'outer'])] : []),
        { path: 'legend', label: 'Legend', type: 'select', value: legend,
          choices: [{ value: false, label: 'Per facet' }, { value: 'shared', label: 'Shared · right' },
            { value: { position: 'bottom' }, label: 'Shared · bottom' },
            { value: { position: 'top' }, label: 'Shared · top' }].map(choice => ({ ...choice,
            ...(choice.value !== false && !hasLegend ? { disabled: true, reason: 'Add a legend before sharing it across facets.' } : {}) })) }], 'Facet guides');
    return out;
  }
  if (program.compositionSpec || !hasChartContext(program, layer)) return [];
  const datasets = new Map(program.semanticSpec.datasets.map(d => [d.id, d]));
  const fields = [], seen = new Set(), visited = new Set();
  const owner = chartOwner(program, layer);
  // A radar's folded dimension is a coordinate within every polygon, not a
  // partition of observations. Partition its source rows so each child retains
  // every dimension. This also follows edits that change the dimension list.
  let data = datasets.get(owner?.radar ? owner.source : profile.id);
  while (data && !visited.has(data.id)) {
    visited.add(data.id);
    for (const field of profileDataset(program, data.id).fields) {
      if (seen.has(field.name)) continue;
      if (!field.usable || !field.complete || field.distinct < 2 || field.distinct > 12 || field.type === 'temporal') continue;
      // A folded/aggregated output may retain a field name without being a
      // legal partition ancestor. Continue upstream before claiming that name.
      if (describeAction(program, { action: 'facet', options: { field: field.name, data: data.id } }).applicability !== 'supported') continue;
      seen.add(field.name); fields.push({ ...field, data: data.id });
    }
    data = datasets.get(data.source);
  }
  const ordered = preferVisualFields(fields, 'color'), names = ordered.map(f => f.name);
  const hasLegend = ['color', 'size', 'shape', 'stroke', 'opacity', 'strokeWidth', 'strokeDash'].some(c => layer.encoding?.[c]?.scale);
  const guides = { axes: cartesian ? 'outer' : 'each', legend: hasLegend ? 'shared' : false };
  const guideVariants = hasLegend ? [guides, { ...guides, legend: false }] : [guides];
  const out = ordered.flatMap(field => guideVariants.map(guidePolicy => ({ method: 'facet', category: 'encoding', feature: 'action.facet', label: 'Facet',
    args: { field: field.name, data: field.data, columns: defaultFacetColumns(field.distinct), spacing: 'plot', gap: 12, guides: guidePolicy,
      ...(hasLegend && guidePolicy.legend === false && layer.encoding?.color?.scale ? { scales: { color: 'independent' } } : {}) },
    parameters: [select('field', 'Facet by', field.name, names), number('columns', 'Columns', defaultFacetColumns(field.distinct), 1, Math.max(6, field.distinct)),
      number('gap', 'Minimum gap', 12, 0, 40)],
    // Changing the partition field may change its owning source dataset.
    facetFields: Object.fromEntries(ordered.map(f => [f.name, f.data])),
    facetFieldCounts: Object.fromEntries(ordered.map(f => [f.name, f.distinct])),
  })));
  // Grid facets require both roles to exist in one actual partition dataset.
  for (const data of datasets.values()) {
    const usable = new Set(profileDataset(program, data.id).fields.filter(field => field.usable).map(field => field.name));
    const eligible = ordered.filter(field => usable.has(field.name));
    if (eligible.length < 2) continue;
    // The first two visual fields can create a very large cross-product.
    // Start with the smallest grid; retain every field in both selectors.
    const compact = eligible.toSorted((a, b) => a.distinct - b.distinct);
    for (const guidePolicy of guideVariants) out.push({ method: 'facetGrid', category: 'encoding', feature: 'action.facetGrid', label: 'Facet grid',
      args: { data: data.id, rows: { field: compact[0].name }, columns: { field: compact[1].name }, spacing: 'plot', gap: 12, guides: guidePolicy,
        ...(hasLegend && guidePolicy.legend === false && layer.encoding?.color?.scale ? { scales: { color: 'independent' } } : {}) },
      parameters: [select('rows.field', 'Rows', compact[0].name, eligible.map(f => f.name)),
        select('columns.field', 'Columns', compact[1].name, eligible.map(f => f.name)), number('gap', 'Minimum gap', 12, 0, 40)] });
    break;
  }
  return out.filter(candidate => describeAction(program, { action: candidate.method, options: candidate.args }).applicability === 'supported');
}
