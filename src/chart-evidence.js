import { INITIAL_PLOT_METHODS } from './plot-catalog.js';

const plots = new Set(INITIAL_PLOT_METHODS);
const marks = { point: 'createScatterPlot', circle: 'createScatterPlot', square: 'createScatterPlot',
  line: 'createLinePlot', area: 'createAreaPlot', bar: 'createBarPlot', rect: 'createHeatmap',
  arc: 'createPiePlot', boxplot: 'createBoxPlot', errorbar: 'createIntervalPlot',
  errorband: 'createIntervalPlot', tick: 'createRugPlot', text: 'createTextPlot' };
const field = value => typeof value === 'string' ? value : typeof value?.field === 'string' ? value.field : undefined;

function sourceViews(spec, inherited = {}, transforms = []) {
  if (!spec || typeof spec !== 'object') return [];
  const encoding = { ...inherited, ...spec.encoding };
  const operations = [...transforms, ...(spec.transform ?? [])];
  const children = ['layer', 'hconcat', 'vconcat', 'concat'].flatMap(key => spec[key] ?? []);
  if (spec.spec) children.push(spec.spec);
  if (children.length) return children.flatMap(child => sourceViews(child, encoding, operations));
  if (!spec.mark) return [];
  const mark = typeof spec.mark === 'string' ? spec.mark : spec.mark.type;
  let method = marks[mark];
  const positions = [encoding.x, encoding.y];
  const binned = positions.some(value => value?.bin && value.bin !== false) || operations.some(value => value.bin);
  const counted = positions.some(value => value?.aggregate === 'count') || operations.some(value =>
    value.aggregate?.some(entry => entry.op === 'count'));
  if (mark === 'bar' && binned && counted) method = 'createHistogram';
  if (mark === 'area' && operations.some(value => value.density)) method = 'createDensityPlot';
  if (mark === 'line' && operations.some(value => value.regression)) method = 'createRegressionPlot';
  const roles = Object.fromEntries(Object.entries(encoding).map(([role, value]) => [role, field(value)]).filter(([, value]) => value));
  if (method === 'createHistogram') roles.field = field(positions.find(value => value?.bin));
  const roleTypes = Object.fromEntries(Object.entries(encoding).map(([role, value]) => [role, value?.type]).filter(([, value]) => value));
  return [{ method: method ?? `unmapped:${mark}`, roles, roleTypes, basis: 'source-spec', mark,
    aggregation: encoding.y?.aggregate ?? encoding.x?.aggregate ?? null }];
}

function callRoles(options) {
  const roles = {};
  for (const key of ['x', 'y', 'color', 'theta', 'radius', 'category', 'value', 'field', 'start', 'end', 'text']) {
    const name = field(options[key]); if (name) roles[key] = name;
  }
  if (typeof options.groupBy === 'string') roles.group = options.groupBy;
  if (Array.isArray(options.dimensions)) roles.dimensions = options.dimensions.filter(v => typeof v === 'string');
  if (Array.isArray(options.wide?.fields)) roles.dimensions = options.wide.fields;
  return roles;
}

// One canonical label set per chart, never one vote per translation stage.
// Source semantics distinguish histogram/density/statistical layers from their
// low-level mark realizations; static native calls enrich roles where available.
export function extractChartEvidence(stages, source) {
  const calls = stages.flatMap(stage => stage.calls ?? []);
  const structuredViews = stages.flatMap(stage => stage.structure?.views.flatMap(view => view.layers.flatMap(layer => {
    const call = layer.call;
    const method = plots.has(call.method) ? call.method : {
      createPointMark: 'createScatterPlot', createLineMark: 'createLinePlot', createBarMark: 'createBarPlot',
      createAreaMark: 'createAreaPlot', createRectMark: 'createHeatmap', createArcMark: 'createPiePlot',
    }[call.method];
    if (!method) return [];
    const roles = callRoles(call.options);
    for (const [method, args] of Object.entries(layer.encodings)) {
      const channel = { encodeX: 'x', encodeY: 'y', encodeColor: 'color', encodeR: 'radius', encodeTheta: 'theta' }[method];
      if (channel && field(args)) roles[channel] = field(args);
    }
    return [{ method, roles, dataFiles: call.dataFiles, childPath: view.path,
      basis: 'native-program-graph', aggregation: call.options.y?.aggregate ?? null }];
  })) ?? []);

  let views = sourceViews(source);
  if (views.length) {
    // Text/rule annotations on a positioned chart are not separate starting charts.
    const primary = views.filter(view => view.mark !== 'text' && view.mark !== 'rule');
    if (primary.length) views = primary;
    views = views.map(view => {
      const candidates = structuredViews.filter(native => native.method === view.method);
      const overlap = native => Object.entries(view.roles).filter(([role, name]) => native.roles[role] === name).length;
      candidates.sort((a, b) => overlap(b) - overlap(a));
      const best = candidates.filter(native => overlap(native) === overlap(candidates[0]));
      const owners = [...new Set(best.flatMap(native => native.dataFiles ?? []))];
      const native = candidates[0];
      return { ...view, roles: { ...native?.roles, ...view.roles },
        ...(owners.length === 1 ? { dataFiles: owners } : {}) };
    });
  } else {
    // Future corpora may supply native ggaction programs without a source spec.
    views.push(...structuredViews);
    for (const call of views.length ? [] : calls) if (plots.has(call.method)) {
      views.push({ method: call.method, roles: callRoles(call.options), basis: 'native-plot', aggregation: call.options.y?.aggregate ?? null });
    }
    if (!views.length) for (const call of calls) {
      const method = { createPointMark: 'createScatterPlot', createLineMark: 'createLinePlot',
        createBarMark: 'createBarPlot', createAreaMark: 'createAreaPlot' }[call.method];
      if (!method) continue;
      const roles = {};
      for (const encoding of calls) if (/^encode[XY]$/.test(encoding.method) &&
        (!encoding.options.target || !call.options.id || encoding.options.target === call.options.id)) {
        const name = field(encoding.options); if (name) roles[encoding.method.at(-1).toLowerCase()] = name;
      }
      views.push({ method, roles, basis: 'native-mark', aggregation: null });
    }
  }
  const unique = new Map();
  for (const view of views) {
    const key = JSON.stringify([view.method, view.roles, view.aggregation, view.dataFiles]);
    if (!unique.has(key)) unique.set(key, view);
  }
  const evidence = [...unique.values()];
  const methods = [...new Set(evidence.map(view => view.method))].sort();
  return { methods: methods.length ? methods : ['unmapped:no-plot'], views: evidence,
    nativeMethods: [...new Set(calls.filter(call => plots.has(call.method)).map(call => call.method))].sort() };
}
