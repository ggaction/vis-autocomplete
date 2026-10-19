import { chart } from 'ggaction';

export const xBinControl = () => ({ key: 'bins', label: 'X bins (maximum)',
  type: 'number', value: 10, min: 2, max: 24, step: 1 });

// A balanced native expression uses the library's exact bin boundaries, including
// its last closed interval. No application-side row grouping or bin algorithm.
function binCenterExpression(field, boundaries, first = 0, last = boundaries.length - 2, labels = false) {
  if (first === last) {
    const a = boundaries[first], b = boundaries[first + 1];
    const midpoint = a + (b - a) / 2;
    return { constant: labels ? `[${a}, ${b}${first === boundaries.length - 2 ? ']' : ')'}`
      : Number.isFinite(midpoint) ? midpoint : a / 2 + b / 2 };
  }
  const split = Math.floor((first + last + 1) / 2);
  return { op: 'if', condition: { op: 'lt', left: { field }, right: { constant: boundaries[split] } },
    then: binCenterExpression(field, boundaries, first, split - 1, labels),
    else: binCenterExpression(field, boundaries, split, last, labels) };
}

// Plan row-preserving native bins. Labels explicitly expose the interval rather
// than pretending a continuous field is a category or one group per value.
export function binnedFieldSetup({ source, rows, field, as, role }) {
  let planner;
  const plans = new Map();
  return bins => {
    if (!Number.isInteger(bins) || bins < 2 || bins > 24) throw new Error('Bins must be an integer from 2 to 24.');
    if (!plans.has(bins)) {
      const bin = { method: 'createBinData', args: { id: `${source}-${role}-bins`, source, field,
        maxBins: bins, nice: true, zero: false, includeEmpty: true } };
      planner ??= chart().createData({ id: source, values: rows });
      const boundaries = planner.createBinData(bin.args).semanticSpec.datasets.find(d => d.id === bin.args.id)
        .transform[0].resolved.boundaries;
      const data = `${source}-${role}-binned-rows`;
      const expression = binCenterExpression(field, boundaries, 0, boundaries.length - 2, true);
      const domain = boundaries.slice(0, -1).map((_, i) => binCenterExpression(field, boundaries, i, i, true).constant);
      plans.set(bins, { data, domain, calls: [bin,
        { method: 'createComputedData', args: { id: data, source, as, expression } }] });
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
