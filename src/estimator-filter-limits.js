// Filters upstream of statistical transforms must preserve the observations
// required by every live consumer. Compute order-statistic bounds without
// fitting distributions during candidate enumeration.
export function estimatorFilterLimits(program, editedData, field, inputRows) {
  const datasets = new Map(program.semanticSpec.datasets.map(dataset => [dataset.id, dataset]));
  const dependsOn = data => {
    const seen = new Set();
    while (data && !seen.has(data.id)) {
      if (data.id === editedData) return true;
      seen.add(data.id); data = datasets.get(data.source);
    }
    return false;
  };
  const constraints = [];
  for (const dataset of datasets.values()) {
    if (!dependsOn(datasets.get(dataset.source))) continue;
    for (const transform of dataset.transform ?? []) {
      if (transform.type === 'density') constraints.push({ field: transform.field,
        groupBy: transform.groupBy, rows: 2, distinct: 2 });
      if (transform.type === 'interval') constraints.push({ field: transform.field,
        groupBy: transform.groupBy, rows: ['stdev', 'stderr', 'ci'].includes(transform.extent) ? 2 : 1, distinct: 1 });
    }
  }
  if (!constraints.length) return undefined;
  const finite = inputRows.filter(row => Number.isFinite(row[field]));
  if (!finite.length) return undefined;
  const low = Math.min(...finite.map(row => row[field])), high = Math.max(...finite.map(row => row[field]));
  let minLte = low, maxGte = high;
  for (const constraint of constraints) {
    const groupFields = Array.isArray(constraint.groupBy) ? constraint.groupBy : constraint.groupBy ? [constraint.groupBy] : [];
    const groups = new Map();
    for (const row of finite.filter(row => Number.isFinite(row[constraint.field]))) {
      const key = JSON.stringify(groupFields.map(name => row[name]));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const critical = (rows, direction) => {
      const seen = new Set(), sorted = [...rows].sort((a, b) => direction * (a[field] - b[field]));
      for (let i = 0; i < sorted.length; i++) {
        seen.add(sorted[i][constraint.field]);
        if (i + 1 >= constraint.rows && seen.size >= constraint.distinct) return sorted[i][field];
      }
    };
    for (const group of groups.values()) {
      const gte = critical(group, -1), lte = critical(group, 1);
      // An existing constant group can be valid with a fixed shared extent.
      // It imposes a nonempty-input bound instead of pretending variation exists.
      const highBoundary = gte ?? Math.max(...group.map(row => row[field]));
      const lowBoundary = lte ?? Math.min(...group.map(row => row[field]));
      maxGte = Math.min(maxGte, highBoundary); minLte = Math.max(minLte, lowBoundary);
    }
  }
  return { gte: { min: low, max: maxGte }, lte: { min: minLte, max: high } };
}
