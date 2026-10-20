import { chart } from 'ggaction';

export const xBinControl = () => ({ key: 'bins', label: 'X bins (maximum)',
  type: 'number', value: 10, min: 2, max: 24, step: 1 });

export const isContinuousField = field => ['quantitative', 'temporal'].includes(field?.type);

// Dates are continuous values too. Normalize them through a public native
// expression, keeping the original date column and every source row intact.
export function continuousFieldSetup({ source, field, type, role, reserved = [] }) {
  if (type !== 'temporal') return { data: source, field, calls: [] };
  let as = `${field} (timestamp)`;
  while (reserved.includes(as)) as += ' (timestamp)';
  const data = `${source}-${role}-time-values`;
  return { data, field: as, calls: [{ method: 'createComputedData', args: { id: data, source, as,
    expression: { op: 'parseTime', operand: { field } } } }] };
}

// Parsed dates have integer-millisecond precision. A fractional native bin
// boundary is therefore equivalent to the next whole millisecond for '<'.
const timeLabel = value => new Date(Math.ceil(value)).toISOString().replace(/T00:00:00\.000Z$/, '').replace(/\.000Z$/, 'Z');

// A balanced native expression uses the library's exact bin boundaries, including
// its last closed interval. No application-side row grouping or bin algorithm.
function binCenterExpression(field, boundaries, first = 0, last = boundaries.length - 2, labels = false, format = String) {
  if (first === last) {
    const a = boundaries[first], b = boundaries[first + 1];
    const midpoint = a + (b - a) / 2;
    return { constant: labels ? `[${format(a)}, ${format(b)}${first === boundaries.length - 2 ? ']' : ')'}`
      : Number.isFinite(midpoint) ? midpoint : a / 2 + b / 2 };
  }
  const split = Math.floor((first + last + 1) / 2);
  return { op: 'if', condition: { op: 'lt', left: { field }, right: { constant: boundaries[split] } },
    then: binCenterExpression(field, boundaries, first, split - 1, labels, format),
    else: binCenterExpression(field, boundaries, split, last, labels, format) };
}

// Plan row-preserving native bins. Labels explicitly expose the interval rather
// than pretending a continuous field is a category or one group per value.
export function binnedFieldSetup({ source, rows, field, as, role, type = 'quantitative', reserved = Object.keys(rows[0] ?? {}) }) {
  let planner;
  const normalized = continuousFieldSetup({ source, field, type, role, reserved });
  const format = type === 'temporal' ? timeLabel : String;
  const plans = new Map();
  return bins => {
    if (!Number.isInteger(bins) || bins < 2 || bins > 24) throw new Error('Bins must be an integer from 2 to 24.');
    if (!plans.has(bins)) {
      const bin = { method: 'createBinData', args: { id: `${source}-${role}-bins`, source: normalized.data, field: normalized.field,
        maxBins: bins, nice: type !== 'temporal', zero: false, includeEmpty: true } };
      planner ??= normalized.calls.reduce((program, call) => program[call.method](call.args),
        chart().createData({ id: source, values: rows }));
      const boundaries = planner.createBinData(bin.args).semanticSpec.datasets.find(d => d.id === bin.args.id)
        .transform[0].resolved.boundaries;
      const data = `${source}-${role}-binned-rows`;
      const expression = binCenterExpression(normalized.field, boundaries, 0, boundaries.length - 2, true, format);
      const domain = boundaries.slice(0, -1).map((_, i) => binCenterExpression(normalized.field, boundaries, i, i, true, format).constant);
      plans.set(bins, { data, domain, calls: [...normalized.calls, bin,
        { method: 'createComputedData', args: { id: data, source: normalized.data, as, expression } }] });
    }
    return plans.get(bins);
  };
}

// Area/horizon cannot use native positional bin+aggregate.
// Prepare their data with existing PUBLIC native calls, recorded and replayed
// before the single recommended plot function. The complete source is immutable.
export function binnedSummarySetup({ source, rows, x, binField, y, color, output = `${source}-plot-summary` }) {
  let planner;
  const plans = new Map();
  return (values = {}) => {
    const bins = values.bins ?? 10;
    if (!Number.isInteger(bins) || bins < 2 || bins > 24) throw new Error('X bins must be an integer from 2 to 24.');
    if (!plans.has(bins)) {
      const bin = { method: 'createBinData', args: { id: `${source}-x-bins`, source, field: x,
        maxBins: bins, nice: true, zero: false, includeEmpty: true,
        as: { lower: 'lower', upper: 'upper', count: 'count' } } };
      // Resolve boundaries through the same ggaction action that the returned
      // code will execute. Cache only this immutable plan, never grouped rows.
      planner ??= chart().createData({ id: source, values: rows });
      const resolved = planner.createBinData(bin.args).semanticSpec.datasets.find(d => d.id === bin.args.id);
      const boundaries = resolved.transform[0].resolved.boundaries;
      const computed = { method: 'createComputedData', args: { id: `${source}-binned-rows`, source,
        as: binField, expression: binCenterExpression(x, boundaries) } };
      plans.set(bins, [bin, computed]);
    }
    return [...plans.get(bins), { method: 'createSummaryData', args: {
      id: output, source: `${source}-binned-rows`,
      groupBy: [...new Set([binField, color].filter(Boolean))],
      aggregates: [{ op: values.aggregate ?? 'mean', field: y, as: y }], missing: 'drop',
    } }];
  };
}

// Reusable public-native bin plan for post-Apply editing of a row-preserving
// computed position. The full program's dependent summaries replay natively.
export function binnedPositionExpression(field, domain, bins) {
  const planner = chart().createData({ id: 'bin-plan', values: domain.map(value => ({ [field]: value })) });
  const bin = planner.createBinData({ id: 'planned-bins', source: 'bin-plan', field, maxBins: bins, nice: true, zero: false, includeEmpty: true });
  const boundaries = bin.semanticSpec.datasets.find(d => d.id === 'planned-bins').transform[0].resolved.boundaries;
  return binCenterExpression(field, boundaries);
}
