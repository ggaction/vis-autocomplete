import { initialPositionBindings } from './initial-scales.js';

const fieldName = value => typeof value === 'string' ? value : value?.field;

// Follow a value through reusable summary datasets as well as inline encoding
// aggregates. A summary may retain its input field name; names alone are not a
// sufficient description of what an axis measures.
export function axisValueMeaning(encoding, data, datasets) {
  let field = fieldName(encoding);
  if (!field) return null;
  const operations = encoding?.aggregate ? [encoding.aggregate] : [];
  const seen = new Set();
  while (data && !seen.has(data)) {
    seen.add(data);
    const dataset = datasets.find(item => item.id === data);
    for (const transform of [...(dataset?.transform ?? [])].reverse()) {
      if (transform.type !== 'summary') continue;
      const aggregate = transform.aggregates.find(item => item.as === field);
      if (aggregate) { operations.unshift(aggregate.op); field = aggregate.field ?? field; }
    }
    data = dataset?.source;
  }
  return { field, operations };
}

export function creationAxisMeanings(method, args, fields, datasets, setup = []) {
  // Read prerequisite declarations, without running/re-rendering candidate
  // charts. This policy is also evaluated while hovering aggregate parameters.
  const prepared = new Map(datasets.map(dataset => [dataset.id, dataset]));
  for (const call of setup) {
    const options = call.args;
    if (!options?.id || !options.source || !/Data$/.test(call.method)) continue;
    prepared.set(options.id, { id: options.id, source: options.source,
      transform: call.method === 'createSummaryData' ? [{ type: 'summary', aggregates: options.aggregates }] : [] });
  }
  const bindings = initialPositionBindings(method, args, fields);
  return Object.fromEntries(['x', 'y'].map(axis => {
    let encoding = args[axis] ?? bindings.find(binding => binding.axis === axis)?.encoding;
    if (encoding === undefined && args.category !== undefined) {
      const categoryAxis = args.orientation === 'horizontal' ? 'y' : 'x';
      if (axis === categoryAxis) encoding = args.category;
    }
    if (encoding !== undefined && args.summary && bindings.find(binding => binding.axis === axis)?.encoding === encoding) {
      encoding = { ...(typeof encoding === 'string' ? { field: encoding } : encoding), aggregate: args.summary };
    }
    return [axis, axisValueMeaning(encoding, args.data, [...prepared.values()])];
  }));
}

export function sameAxisMeaning(a, b) {
  return Boolean(a && b && JSON.stringify(a) === JSON.stringify(b));
}
