// Data-only descriptors shared by offline indexing and browser queries.
// Names and chart encodings are never inputs to dataset similarity.
export const PROFILE_VERSION = 'dataset-statistics-v2';
export const FEATURE_BLOCKS = Object.freeze({
  shape: ['logRows', 'logColumns'],
  types: ['quantitativeFraction', 'categoricalFraction', 'temporalFraction', 'numericStringFraction', 'mixedFraction'],
  missing: ['meanMissing', 'maxMissing'],
  cardinality: ['meanLogDistinct', 'maxLogDistinct', 'meanUnique', 'medianUnique', 'categoricalLogDistinct', 'categoricalUnique'],
  distribution: ['meanEntropy', 'constantFraction', 'numericSkew', 'numericTail', 'numericZero', 'numericNonnegative'],
  relationships: ['meanAbsCorrelation', 'maxAbsCorrelation', 'correlatedPairFraction', 'jointCoverage'],
  time: ['timeUnique', 'timeRepetition'],
});
export const FEATURE_NAMES = Object.freeze(Object.values(FEATURE_BLOCKS).flat());
const sortedAverage = values => values.length ? values.reduce((a, b) => a + b / values.length, 0) : 0;
const average = values => sortedAverage([...values].sort((a, b) => a - b));
const sortedQuantile = (sorted, p) => {
  if (!sorted.length) return 0;
  const at = (sorted.length - 1) * p;
  const low = Math.floor(at), high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
};
export const quantile = (values, p) => sortedQuantile([...values].sort((a, b) => a - b), p);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value));
const numberString = value => typeof value === 'string' && /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value));
const present = value => value !== null && value !== undefined;

export function describeColumn(values, typeHint) {
  const hint = typeof typeHint === 'string' ? typeHint : typeHint?.type;
  const categoricalHint = ['nominal', 'ordinal'].includes(hint);
  const available = values.filter(present), count = available.length;
  const numbers = !categoricalHint && hint !== 'temporal' && count > 0 && available.every(v => typeof v === 'number' && Number.isFinite(v));
  const temporal = hint === 'temporal' || !categoricalHint && count > 0 && available.every(date);
  const categorical = count > 0 && available.every(v => ['string', 'boolean'].includes(typeof v));
  const numericString = !categoricalHint && hint !== 'temporal' && count > 0 && available.every(numberString);
  const type = hint ?? (numbers ? 'quantitative' : temporal ? 'temporal' : categorical ? 'nominal' : 'mixed');
  const frequencies = new Map();
  for (const value of available) {
    // Finite numeric columns need no per-cell JSON allocation. Map uses the
    // same equality as the previous encoding, including treating -0 as 0.
    const key = numbers ? value : JSON.stringify([typeof value, value]);
    frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
  }
  const distinct = frequencies.size, missing = 1 - count / Math.max(1, values.length);
  let entropy = 0, skew = 0, tail = 0, zero = 0, nonnegative = 0;
  if (numbers || numericString) {
    const raw = available.map(Number).sort((a, b) => a - b);
    const magnitude = Math.max(Math.abs(raw[0]), Math.abs(raw.at(-1))) || 1;
    const numeric = raw.map(value => value / magnitude);
    const lo = numeric[0], hi = numeric.at(-1), bins = Array(10).fill(0);
    if (hi > lo) {
      for (const value of numeric) bins[Math.min(9, Math.floor((value - lo) / (hi - lo) * 10))]++;
      entropy = -bins.filter(Boolean).reduce((sum, n) => sum + n / count * Math.log(n / count), 0) / Math.log(10);
      const q1 = sortedQuantile(numeric, 0.25), mid = sortedQuantile(numeric, 0.5), q3 = sortedQuantile(numeric, 0.75), iqr = q3 - q1;
      skew = iqr > 0 ? (q3 + q1 - 2 * mid) / iqr : 0;
      tail = numeric.filter(v => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr).length / count;
    }
    zero = numeric.filter(v => v === 0).length / count;
    nonnegative = numeric.filter(v => v >= 0).length / count;
  } else if (distinct > 1) {
    entropy = -[...frequencies.values()].sort((a, b) => a - b)
      .reduce((sum, n) => sum + n / count * Math.log(n / count), 0) / Math.log(distinct);
  }
  return { type, count, distinct, missing, unique: distinct / Math.max(1, count),
    numericString, entropy, skew, tail, zero, nonnegative };
}

// A deterministic, value-based sample bounds pairwise work. Include cutoff ties
// so row reordering cannot change which observations participate.
function pairRows(rows, names) {
  if (rows.length <= 512) return rows;
  const hash = row => {
    const value = JSON.stringify(names.map(name => row[name] ?? null).map(v => JSON.stringify(v)).sort());
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  const keyed = rows.map(row => ({ row, key: hash(row) })).sort((a, b) => a.key - b.key);
  const cutoff = keyed[511].key;
  return keyed.filter(value => value.key <= cutoff).map(value => value.row);
}

export function describeDataset(rows, fieldTypes = {}) {
  if (!Array.isArray(rows)) throw new TypeError('Expected an array of data rows.');
  const normalized = rows.map(row => row && typeof row === 'object' && !Array.isArray(row) ? row : { value: row });
  const fieldNames = new Set();
  for (const row of normalized) for (const name of Object.keys(row)) fieldNames.add(name);
  const names = [...fieldNames].sort();
  const fields = names.map(name => ({ name, ...describeColumn(normalized.map(row => row[name]), fieldTypes[name]) }));
  const numeric = fields.filter(f => f.type === 'quantitative' || f.numericString);
  const categories = fields.filter(f => ['nominal', 'ordinal'].includes(f.type) && !f.numericString);
  const times = fields.filter(f => f.type === 'temporal');
  const pairs = [], coverage = [];
  // Select by statistics only, including cutoff ties so field renaming cannot
  // change the participating variables. Scalar summaries use every field/row.
  const signature = field => JSON.stringify([field.unique, field.entropy, field.missing,
    field.skew, field.tail, field.zero, field.nonnegative, field.count]);
  const signatures = new Map(numeric.map(field => [field, signature(field)]));
  const ordered = numeric.filter(field => field.distinct > 1).sort((a, b) => signatures.get(a).localeCompare(signatures.get(b)));
  const cutoff = ordered[31] && signatures.get(ordered[31]);
  const selected = cutoff ? ordered.filter((field, index) => index < 32 || signatures.get(field) === cutoff) : ordered;
  const sample = selected.length >= 2 ? pairRows(normalized, names) : [];
  for (let a = 0; a < selected.length; a++) for (let b = a + 1; b < selected.length; b++) {
    const points = sample.filter(row => present(row[selected[a].name]) && present(row[selected[b].name]))
      .map(row => [Number(row[selected[a].name]), Number(row[selected[b].name])]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    coverage.push(points.length / Math.max(1, sample.length));
    const sx = points.reduce((max, p) => Math.max(max, Math.abs(p[0])), 0) || 1;
    const sy = points.reduce((max, p) => Math.max(max, Math.abs(p[1])), 0) || 1;
    // Points already have ascending X order and sx is positive. Preserve the
    // exact summation order without sorting the same column a second time.
    const mx = sortedAverage(points.map(p => p[0] / sx)), my = average(points.map(p => p[1] / sy));
    let xx = 0, yy = 0, xy = 0;
    for (const [rawX, rawY] of points) { const x = rawX / sx, y = rawY / sy;
      xx += (x - mx) ** 2; yy += (y - my) ** 2; xy += (x - mx) * (y - my); }
    if (xx > 0 && yy > 0) pairs.push(Math.min(1, Math.abs(xy / Math.sqrt(xx * yy))));
  }
  const fraction = group => group.length / Math.max(1, fields.length);
  const values = {
    logRows: Math.log1p(rows.length), logColumns: Math.log1p(fields.length),
    quantitativeFraction: fraction(fields.filter(f => f.type === 'quantitative')),
    categoricalFraction: fraction(categories), temporalFraction: fraction(times),
    numericStringFraction: fraction(fields.filter(f => f.numericString)), mixedFraction: fraction(fields.filter(f => f.type === 'mixed')),
    meanMissing: average(fields.map(f => f.missing)), maxMissing: Math.max(0, ...fields.map(f => f.missing)),
    meanLogDistinct: average(fields.map(f => Math.log1p(f.distinct))), maxLogDistinct: Math.max(0, ...fields.map(f => Math.log1p(f.distinct))),
    meanUnique: average(fields.map(f => f.unique)), medianUnique: quantile(fields.map(f => f.unique), 0.5),
    categoricalLogDistinct: quantile(categories.map(f => Math.log1p(f.distinct)), 0.5), categoricalUnique: average(categories.map(f => f.unique)),
    meanEntropy: average(fields.map(f => f.entropy)), constantFraction: fraction(fields.filter(f => f.distinct <= 1)),
    numericSkew: average(numeric.map(f => Math.abs(f.skew))), numericTail: average(numeric.map(f => f.tail)),
    numericZero: average(numeric.map(f => f.zero)), numericNonnegative: average(numeric.map(f => f.nonnegative)),
    meanAbsCorrelation: average(pairs), maxAbsCorrelation: Math.max(0, ...pairs),
    correlatedPairFraction: pairs.length ? pairs.filter(v => v >= 0.8).length / pairs.length : 0,
    jointCoverage: average(coverage), timeUnique: average(times.map(f => f.unique)), timeRepetition: average(times.map(f => 1 - f.unique)),
  };
  return { version: PROFILE_VERSION, rowCount: rows.length, fields,
    vector: FEATURE_NAMES.map(name => values[name]) };
}

export function columnDistance(a, b) {
  const numeric = f => f.type === 'quantitative' || f.numericString;
  const typePenalty = a.type === b.type || numeric(a) && numeric(b) ? 0 : 1;
  return (typePenalty * 3 + Math.abs(a.unique - b.unique) + Math.abs(a.missing - b.missing) +
    Math.abs(a.entropy - b.entropy) + Math.abs(Math.log1p(a.distinct) - Math.log1p(b.distinct)) / 12) / 7;
}
