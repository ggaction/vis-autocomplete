export function selectionData(base, profile, rows, selection) {
  let program = base, data = profile.id;
  const calls = [];
  if (selection.x) {
    for (const field of [...new Set([selection.x, selection.y, selection.color].filter(Boolean))]) {
      if (!rows.some(row => row[field] === null || row[field] === undefined)) continue;
      const args = { id: `selected-rows-${calls.length + 1}`, source: data, field, noneOf: [null], nulls: 'exclude' };
      program = program.filterData(args); calls.push({ method: 'filterData', args }); data = args.id;
    }
  }
  return { program, data, calls };
}

// Genuine standalone ggaction axes: no mark, invisible points or renderer patch.
export function selectionAxes(base, profile, rows, selection = {}) {
  let program = base;
  const calls = [];
  const call = (method, args) => { program = program[method](args); calls.push({ method, args }); };
  call('createCoordinate', { id: 'selection-frame', type: 'cartesian' });
  for (const channel of ['x', 'y']) {
    const field = profile.fields.find(field => field.name === selection[channel]);
    const values = field ? rows.map(row => row[field.name]).filter(value => value !== null && value !== undefined) : [];
    const categorical = field && ['nominal', 'ordinal'].includes(field.type);
    const temporal = field?.type === 'temporal';
    let domain = [0, 1];
    if (categorical) domain = field.order ?? [...new Set(values)];
    else if (values.length) {
      const numeric = values.map(value => temporal && typeof value === 'string' ? Date.parse(value) : value);
      domain = [numeric.reduce((a, b) => Math.min(a, b), Infinity), numeric.reduce((a, b) => Math.max(a, b), -Infinity)];
      if (domain[0] === domain[1]) {
        const pad = Math.abs(domain[0]) * .05 || 1;
        domain = [domain[0] - pad, domain[1] + pad];
      }
    }
    const scale = `selection-${channel}`;
    call('createScale', { id: scale, type: categorical ? 'band' : temporal ? 'time' : 'linear', domain,
      ...(!categorical && !temporal ? { zero: false } : {}) });
    const axisArgs = { coordinate: 'selection-frame', scale,
      title: field ? { text: field.name, fontFamily: 'Arial' } : false,
      ticksAndLabels: field ? { ...(categorical ? { values: field.guideValues ?? domain } : { count: 5 }),
        labels: { fontFamily: 'Arial', fontSize: 10, ...(categorical ? { maxWidth: 55, wrap: 'word', overlap: 'allow' } : {}) } } : false };
    const method = channel === 'x' ? 'createXAxis' : 'createYAxis';
    try { call(method, axisArgs); } catch (error) {
      if (categorical || !field || !/axis labels overlap/i.test(error.message)) throw error;
      // Keep the user's numeric schema. Long epoch-sized numbers need a compact
      // display, not an implicit conversion to a date or a rejected selection.
      const fitted = structuredClone(axisArgs);
      if (!temporal) fitted.ticksAndLabels.labels.format = '.2e';
      fitted.ticksAndLabels.count = 3;
      call(method, fitted);
    }
  }
  return { program, calls };
}
