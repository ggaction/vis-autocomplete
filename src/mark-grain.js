// Read-only native grain derivation: no candidate execution, SVG, or row sampling.
// Appearance fields must be constant within the same final cells ggaction draws.
import { resolveBarGrain } from '../vendor/ggaction/src/grammar/bars/policy.js';
import { deriveBarAggregates } from '../vendor/ggaction/src/grammar/bars/aggregate.js';
import { deriveHistogramSegments } from '../vendor/ggaction/src/materialization/bars/histogram.js';
import { applyItemMissingPolicy } from '../vendor/ggaction/src/grammar/itemMissing.js';
import { resolveHistogramBins } from '../vendor/ggaction/src/grammar/histogram.js';
const cache = new WeakMap();
export function barGrain(program, layer) {
  if (!cache.has(program)) cache.set(program, new Map());
  const stored = cache.get(program);
  if (stored.has(layer)) return stored.get(layer);
  const source = program.semanticSpec.datasets.find(d => d.id === layer.data);
  const dataset = applyItemMissingPolicy(layer, source), grain = resolveBarGrain(layer);
  if (!dataset.values.length) {
    const empty = { grain, cells: [], values: { x: [], y: [] }, constant: () => false };
    stored.set(layer, empty); return empty;
  }
  let cells, values;
  if (grain === 'aggregate') { const derived = deriveBarAggregates(dataset.values, layer); values = { x: derived.xValues, y: derived.yValues }; cells = derived.values.map(cell => cell.sourceIndices.map(index => dataset.values[index])); }
  else if (grain === 'histogram') { const segments = deriveHistogramSegments({ dataset, layer, xEncoding: layer.encoding.x,
    xScale: program.resolvedScales[layer.encoding.x.scale], resolvedScales: program.resolvedScales }); cells = segments.map(cell => cell.members).filter(rows => rows.length); values = { x: segments.map(cell => (cell.start + cell.end) / 2), y: segments.map(cell => cell.stackEnd - cell.stackStart) }; }
  else cells = dataset.values.map(row => [row]);
  const result = { grain, cells, values, constant: field => cells.every(rows => new Set(rows.map(row => row[field])).size <= 1) };
  stored.set(layer, result); return result;
}
export function canGroupBar(program, layer, field) {
  try { barGrain(program, { ...layer, encoding: { ...layer.encoding, group: { field, fieldType: 'nominal' } } }); return true; }
  catch { return false; }
}

// Encoding editors and scale editors share the same baseline constraint.
export function positionScaleContext(program, layer, profile) {
  if (!layer) return {};
  const encoding = layer.encoding ?? {}, mark = layer.mark.type;
  const endpoint = program.markConfigs[layer.id]?.endpointPlot;
  const grain = mark === 'bar' && encoding.x && encoding.y ? resolveBarGrain(layer) : null;
  const source = program.semanticSpec.datasets.find(d => d.id === profile.id);
  const nonPositiveBins = Object.fromEntries(['x', 'y'].map(axis => [axis,
    !encoding[axis]?.bin && !(mark === 'line' && axis === 'x' && encoding.y?.aggregate) ? [] : profile.fields.filter(field => {
      if (field.type !== 'quantitative') return false;
      const values = source?.values.map(row => row[field.name]).filter(Number.isFinite) ?? [];
      if (!values.length) return true;
      const bin = encoding[axis]?.bin ?? { maxBins: 10 };
      try { return resolveHistogramBins({ values, bin }).boundaries.some(value => value <= 0); }
      catch { return true; } // An incompatible explicit bin domain cannot become a valid Log mapping.
    }).map(field => field.name)]));
  return { bindings: Object.fromEntries(['x', 'y'].map(axis => [axis, { field: encoding[axis]?.field, scale: encoding[axis]?.scale }])), zeroBaseline: Object.fromEntries(['x', 'y'].map(axis => [axis,
    mark === 'bar' && (grain === 'aggregate' && Boolean(encoding[axis]?.aggregate) || grain === 'histogram' && axis === 'y') || mark === 'area' && axis === 'y' ||
    endpoint?.kind === 'lollipop' && axis === (endpoint.orientation === 'horizontal' ? 'x' : 'y') && endpoint.roles.baseline <= 0])),
    nonPositiveBins,
    nonPositiveFields: profile.fields.filter(field => field.type === 'quantitative' && source?.values.some(row => Number.isFinite(row[field.name]) && row[field.name] <= 0)).map(field => field.name) };
}
