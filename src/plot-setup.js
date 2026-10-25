// Plot recipes are reusable templates. Their private datasets must be freshly
// instantiated when adding a chart to an existing view, even if a template's
// original name already exists there with identical or different contents.
// Rewrite only dataset declarations/references, never fields, output column
// names, expressions or literal user values that happen to match an ID.
export function instantiatePlotData(options, setup, datasets, namespace) {
  const occupied = new Set(datasets.map(dataset => dataset.id)), names = new Map();
  const createsData = call => call.method === 'filterData' || /^create.*Data$/.test(call.method);
  for (const call of setup) {
    if (!createsData(call) || typeof call.args.id !== 'string') continue;
    const original = call.args.id;
    if (names.has(original)) throw new Error(`Plot setup declares dataset "${original}" twice.`);
    const base = `${namespace}-${original}`;
    let id = base;
    for (let n = 2; occupied.has(id); n++) id = `${base}-${n}`;
    names.set(original, id); occupied.add(id);
  }
  const reference = id => names.get(id) ?? id;
  return {
    options: { ...options, ...(options.data === undefined ? {} : { data: reference(options.data) }) },
    calls: setup.map(call => !createsData(call) ? call : { ...call, args: { ...call.args,
      ...(call.args.id === undefined ? {} : { id: reference(call.args.id) }),
      ...(call.args.source === undefined ? {} : { source: reference(call.args.source) }) } }),
  };
}
