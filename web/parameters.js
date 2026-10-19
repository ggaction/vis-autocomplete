// At most three visible parameter groups, except aggregate color (four). Native ggaction options only.
import { applyParameterDefaults } from '../src/control-defaults.js';
const select = (key, label, choices, value) => ({ key, label, type: 'select',
  choices: choices.map(v => typeof v === 'object' ? v : { value: v, label: v }), value });
const numeric = (key, label, value, min, max, step = 1) => ({ key, label, type: 'number', value, min, max, step });
const text = (key, label, value) => ({ key, label, type: 'text', value });
const fieldOf = args => args.field ?? args.expression?.operand?.field ?? args.groupBy?.[0];

export function recommendationParameters(recommendation, profile) {
  const { method, args } = recommendation;
  if (method === 'editFacetSource' && args.action) {
    const source = { ...recommendation, method: args.action.method, args: args.action.options,
      alternatives: recommendation.alternatives?.map(a => ({ ...a, method: a.args.action.method, args: a.args.action.options })) };
    const editor = recommendationParameters(source, profile);
    return { ...editor, build: values => ({ action: { method: source.method, options: editor.build(values) } }) };
  }
  const alternatives = recommendation.alternatives ?? [{ args }];
  const options = [...new Set(alternatives.map(v => fieldOf(v.args)).filter(Boolean))];
  const fields = new Map(profile.fields.map(f => [f.name, f]));
  const fieldOptions = options.map(value => ({ value, label: value, missing: fields.get(value)?.missing,
    fieldType: fields.get(value)?.type }));
  const usable = profile.fields.filter(f => f.usable);
  const quantitative = usable.filter(f => f.type === 'quantitative').map(f => f.name);
  const categories = usable.filter(f => ['nominal', 'ordinal'].includes(f.type)).map(f => f.name);
  const clone = () => structuredClone(args);
  const forField = field => structuredClone(alternatives.find(option => fieldOf(option.args) === field)?.args ?? args);
  let controls, build;

  if (method === 'createStatisticalReference') {
    const axes = [...new Set(alternatives.map(option => option.args.axis))];
    const isInterval = value => ['middle50', 'middle95'].includes(value);
    const initial = args.statistics ?
      (args.statistics?.[0]?.p === .025 ? 'middle95' : 'middle50') : args.statistic?.op ?? 'mean';
    controls = [select('axis', 'Axis', axes, args.axis), select('statistic', 'Statistic', [
      { value: 'mean', label: 'Mean' }, { value: 'median', label: 'Median' },
      { value: 'min', label: 'Minimum' }, { value: 'max', label: 'Maximum' },
      { value: 'middle50', label: 'Middle 50%' }, { value: 'middle95', label: 'Middle 95%' },
    ], initial)];
    build = v => {
      const common = { source: args.source, axis: v.axis,
        ...(args.population ? { population: args.population } : {}), ...(args.field ? { field: args.field } : {}) };
      if (isInterval(v.statistic)) {
        const p = v.statistic === 'middle95' ? .025 : .25;
        return { ...common, statistics: [{ op: 'quantile', p }, { op: 'quantile', p: 1 - p }],
          fill: '#6b7280', opacity: .18 };
      }
      return { ...common, statistic: { op: v.statistic }, stroke: '#222222', strokeWidth: 2.5, strokeDash: 'solid' };
    };
  } else if (method === 'facet') {
    controls = [select('field', 'Facet by', [...new Set(alternatives.map(a => a.args.field))], args.field),
      numeric('columns', 'Columns', args.columns ?? 3, 1, 6), numeric('gap', 'Gap', args.gap ?? 12, 0, 40)];
    build = v => ({ ...forField(v.field), data: recommendation.facetFields?.[v.field] ??
      alternatives.find(a => a.args.field === v.field)?.args.data ?? args.data,
      field: v.field, columns: v.columns, gap: v.gap });
  } else if (recommendation.parameterMode === 'presets') {
    const label = args => Object.entries(args).filter(([key]) => key !== 'target').slice(0, 3)
      .map(([key, value]) => `${key.replace(/([a-z])([A-Z])/g, '$1 $2')}${typeof value === 'object' ? '' : `: ${value}`}`).join(' · ');
    controls = alternatives.length > 1 ? [select('variant', 'Style', alternatives.map((option, value) => ({ value,
      label: label(option.args) })), 0)] : [];
    build = v => structuredClone(alternatives[v.variant ?? 0].args);
  } else if (recommendation.parameters?.length) {
    const at = (object, path) => path.split('.').reduce((v, key) => v?.[key], object);
    controls = recommendation.parameters.map((parameter, i) => ({ ...structuredClone(parameter), key: `p${i}`,
      value: at(args, parameter.path) ?? parameter.value }));
    build = values => {
      const out = clone();
      for (const [i, parameter] of recommendation.parameters.entries()) {
        for (const name of [parameter.path, ...(values[`p${i}`] !== at(args, parameter.path) ? parameter.alsoSet ?? [] : [])]) {
          const path = name.split('.'), key = path.pop();
          let node = out;
          for (const part of path) node = node[part] ??= {};
          node[key] = values[`p${i}`];
        }
      }
      return out;
    };
  } else if (['encodeX', 'encodeY'].includes(method)) {
    controls = [select('field', 'Variable', fieldOptions, args.field),
      select('scale', 'Scale', ['auto', 'linear', 'log', 'sqrt', 'symlog'], 'auto')];
    if (args.aggregate) controls.push(select('aggregate', 'Aggregation', ['mean', 'median', 'sum', 'min', 'max'], args.aggregate));
    build = v => {
      const out = forField(v.field); out.field = v.field; out.fieldType = fields.get(v.field)?.type ?? args.fieldType;
      if (v.aggregate) out.aggregate = v.aggregate;
      if (v.scale !== 'auto') out.scale = { ...out.scale, type: v.scale };
      return out;
    };
  } else if (['encodeColor', 'encodeStroke', 'encodeOpacity', 'encodeSize', 'encodeStrokeWidth'].includes(method)) {
    const color = ['encodeColor', 'encodeStroke'].includes(method);
    const size = method === 'encodeSize';
    const width = method === 'encodeStrokeWidth';
    const variable = v => v.mode === 'variable';
    const conditional = (control, when) => ({ ...control, when });
    const variableArgs = alternatives.find(option => option.args.field)?.args;
    const defaultField = args.field ?? variableArgs?.field;
    const fixedValue = args.value ?? (method === 'encodeStroke' ? '#000000' : color ? '#4c78a8' : size ? 64 : width ? 2 : 0.7);
    controls = [select('mode', 'Mode', [{ value: 'fixed', label: 'Fixed' }, { value: 'variable', label: 'Variable', disabled: !fieldOptions.length }],
      args.field ? 'variable' : 'fixed'),
      conditional(color ? { key: 'value', label: 'Color', type: 'color', value: fixedValue, choices: [...(method === 'encodeStroke' ? ['#000000'] : []), '#4c78a8', '#f58518', '#e45756', '#72b7b2', '#54a24b', '#b279a2', '#555555'].map(value => ({ value, label: value })) }
        : numeric('value', size ? 'Area (px²)' : width ? 'Stroke width' : 'Opacity', fixedValue, 0, size ? 1600 : width ? 8 : 1, size ? 1 : width ? .25 : 0.05), v => !variable(v)),
      conditional(select('field', 'Variable', fieldOptions, defaultField), variable)];
    if (color) {
      controls.push(conditional(select('palette', 'Palette', ['auto', 'tableau10', 'category10', 'viridis', 'blues', 'reds'], 'auto'), variable));
      if (alternatives.some(option => option.args.aggregate)) {
        controls.push(conditional(select('aggregate', 'Aggregation', ['mean', 'median', 'sum', 'min', 'max'], args.aggregate ?? alternatives.find(option => option.args.aggregate).args.aggregate),
          v => variable(v) && Boolean(forField(v.field).aggregate)));
      }
    } else {
      const range = variableArgs?.scale?.range ?? (size ? [20, 240] : width ? [1, 4] : [0.25, 1]);
      controls.push(conditional({ key: 'range', label: size ? 'Area range (px²)' : width ? 'Width range' : 'Opacity range', type: 'group',
        controls: [numeric('min', 'Minimum', range[0], 0, size ? 1600 : width ? 8 : 1, size ? 1 : width ? .25 : 0.05),
          numeric('max', 'Maximum', range[1], 0, size ? 1600 : width ? 8 : 1, size ? 1 : width ? .25 : 0.05)] }, variable));
    }
    build = v => {
      if (v.mode === 'fixed') return { ...(args.target ? { target: args.target } : {}), value: v.value };
      const out = forField(v.field);
      delete out.value;
      out.field = v.field;
      out.fieldType = fields.get(v.field)?.type ?? out.fieldType;
      if (color) {
        if (out.aggregate) out.aggregate = v.aggregate;
        if (v.palette !== 'auto') out.scale = { ...out.scale, palette: v.palette };
      } else {
        if (v.min > v.max) throw new Error('Minimum must be no greater than maximum.');
        out.scale = { ...out.scale, range: [v.min, v.max] };
      }
      return out;
    };
  } else if (['encodeAngle', 'encodeStrokeDash'].includes(method)) {
    const angle = method === 'encodeAngle';
    const variable = v => v.mode === 'variable';
    controls = [select('mode', 'Mode', [{ value: 'fixed', label: 'Fixed' },
      { value: 'variable', label: 'Variable', disabled: !fieldOptions.length }], args.field ? 'variable' : 'fixed'),
      { ...select('field', 'Variable', fieldOptions, args.field ?? options[0]), when: variable },
      { ...(angle ? numeric('value', 'Angle', args.value ?? 30, 0, 360, 5)
        : select('value', 'Dash', ['solid', 'dashed', 'dotted'], args.value ?? 'dashed')), when: v => !variable(v) }];
    build = v => variable(v) ? forField(v.field) : { target: args.target, value: v.value };
  } else if (method === 'encodeShape') {
    controls = [select('field', 'Variable', fieldOptions, args.field)];
    build = v => ({ ...clone(), field: v.field });
  } else if (method === 'createRegression') {
    controls = [select('method', 'Model', ['linear', 'polynomial', 'loess', 'exp'], args.method ?? 'linear'),
      numeric('level', 'Confidence level', 0.95, 0.5, 0.99, 0.01),
      select('group', 'Group', [{ value: '', label: 'All observations' }, ...categories.map(value => ({ value, label: value }))], '')];
    build = v => ({ ...clone(), method: v.method, groupBy: v.group || false,
      ...(['linear', 'polynomial'].includes(v.method) ? { level: v.level } : {}) });
  } else if (method === 'editAxes') {
    const contexts = recommendation.guideContext?.axes ?? {};
    const channels = Object.keys(args);
    const quantitativeAxis = (channel, entry) => ['quantitative', 'temporal'].includes(
      channel === 'parallel' ? fields.get(entry.field)?.type : contexts[channel]?.fieldType);
    const hasTicks = channels.some(channel => (Array.isArray(args[channel]) ? args[channel] : [args[channel]])
      .some(entry => ['x', 'y', 'parallel'].includes(channel) && quantitativeAxis(channel, entry)));
    controls = [numeric('fontSize', 'Label size', 11, 8, 18),
      numeric('offset', 'Label offset', 8, 0, 30),
      ...(hasTicks ? [numeric('ticks', 'Ticks', 5, 2, 12)] : [])];
    build = v => Object.fromEntries(channels.map(channel => {
      const edit = entry => {
        const out = structuredClone(entry); delete out.labels;
        const quantitative = quantitativeAxis(channel, entry);
        // Preserve categorical tick policies and specialized plot axis counts.
        return { ...out, ticksAndLabels: {
          ...(quantitative && v.ticks !== undefined ? { count: v.ticks } : {}),
          labels: { fontFamily: 'Arial', fontSize: v.fontSize, offset: v.offset },
        } };
      };
      return [channel, Array.isArray(args[channel]) ? args[channel].map(edit) : edit(args[channel])];
    }));
  } else if (['editXAxis', 'editYAxis', 'editThetaAxis', 'editRadialAxis'].includes(method)) {
    const context = recommendation.guideContext ?? {};
    const cartesian = ['editXAxis', 'editYAxis'].includes(method);
    const quantitativeAxis = ['quantitative', 'temporal'].includes(context.fieldType);
    controls = [numeric('fontSize', 'Label size', args.labels?.fontSize ?? 11, 8, 18),
      numeric('offset', 'Label offset', context.offset ?? 8, 0, 30)];
    if (cartesian && quantitativeAxis) controls.push(numeric('ticks', 'Ticks', context.ticks ?? 5, 2, 12));
    else if (cartesian) controls.push(select('position', 'Position', method === 'editXAxis' ? ['bottom', 'top'] : ['left', 'right'],
      method === 'editXAxis' ? 'bottom' : 'left'));
    build = v => {
      const out = clone(); delete out.labels;
      return { ...out, ...(v.position ? { position: v.position } : {}), ticksAndLabels: {
        ...(v.ticks !== undefined ? { count: v.ticks } : {}),
        labels: { fontFamily: 'Arial', fontSize: v.fontSize, offset: v.offset },
      } };
    };
  } else if (method === 'editParallelAxis') {
    const dimensions = [...new Set(alternatives.map(option => option.args.field))];
    controls = [select('field', 'Dimension', dimensions, args.field),
      numeric('fontSize', 'Label size', args.labels?.fontSize ?? 11, 8, 18)];
    build = v => ({ ...clone(), field: v.field, labels: { fontFamily: 'Arial', fontSize: v.fontSize } });
  } else if (method === 'editLegend') {
    const channels = [...new Set(alternatives.map(option => option.args.channel))];
    controls = [select('channel', 'Legend', channels, args.channel),
      select('position', 'Position', ['right', 'left', 'top', 'bottom', 'top-right', 'top-left', 'bottom-right', 'bottom-left'], args.position ?? 'right'),
      numeric('fontSize', 'Label size', args.labels?.fontSize ?? 12, 8, 18)];
    build = v => ({ ...structuredClone(alternatives.find(option => option.args.channel === v.channel)?.args ?? args),
      channel: v.channel, position: v.position, labels: { fontFamily: 'Arial', fontSize: v.fontSize } });
  } else if (method === 'editGrid') {
    const direction = recommendation.guideContext?.direction ?? Object.keys(args)[0];
    const cartesian = ['vertical', 'horizontal'].includes(direction);
    const directions = cartesian ? ['vertical', 'horizontal'] : recommendation.guideContext?.directions ?? Object.keys(args);
    const choices = directions.map(value => ({ value,
      label: cartesian ? value[0].toUpperCase() + value.slice(1) : value }));
    if (directions.length > 1) choices.push({ value: 'both', label: 'Both' });
    controls = [select('direction', 'Direction', choices, direction),
      select('color', 'Color', ['#e2e8f0', '#cbd5e1', '#9ca3af', '#6b7280'], args[direction]?.color ?? '#cbd5e1'),
      numeric('width', 'Line width', args[direction]?.lineWidth ?? 1.5, 0.25, 3, 0.25)];
    build = v => Object.fromEntries((v.direction === 'both' ? directions : [v.direction])
      .map(key => [key, { color: v.color, lineWidth: v.width }]));
  } else if (method === 'createAxes') {
    const categoricalAxis = axis => ['nominal', 'ordinal'].includes(fields.get(recommendation.axisFields?.[axis])?.type);
    controls = ['x', 'y'].map(axis => categoricalAxis(axis)
      ? numeric(`${axis}Offset`, `${axis.toUpperCase()} label offset`, 8, 2, 20)
      : numeric(`${axis}Ticks`, `${axis.toUpperCase()} ticks`, 5, 2, 12));
    controls.push(numeric('fontSize', 'Label size', 12, 8, 18));
    build = v => ({ ...clone(), ...Object.fromEntries(['x', 'y'].map(axis => [axis, { ticksAndLabels: {
      ...(!categoricalAxis(axis) ? { count: v[`${axis}Ticks`] } : {}),
      labels: { fontFamily: 'Arial', fontSize: v.fontSize,
        ...(categoricalAxis(axis) ? { offset: v[`${axis}Offset`] } : {}) },
    } }])) });
  } else if (method === 'createLegend') {
    controls = [select('position', 'Position', ['right', 'left', 'top', 'bottom'], args.position ?? 'right'),
      numeric('fontSize', 'Label size', 12, 8, 18), text('title', 'Title', args.title ?? '')];
    build = v => ({ ...clone(), position: v.position, labels: { fontFamily: 'Arial', fontSize: v.fontSize },
      ...(v.title ? { title: v.title } : {}) });
  } else if (['createTitle', 'editTitle'].includes(method)) {
    controls = [text('text', 'Title', args.text), select('position', 'Position', ['top', 'bottom', 'left', 'right'], args.position ?? 'top'),
      numeric('size', 'Font size', args.titleStyle?.fontSize ?? 16, 10, 30)];
    build = v => ({ ...clone(), text: v.text, position: v.position,
      titleStyle: { fontFamily: 'Arial', fontSize: v.size } });
  } else if (method === 'editPointMark') {
    controls = [numeric('opacity', 'Opacity', args.opacity ?? 0.7, 0.05, 1, 0.05),
      select('shape', 'Shape', ['circle', 'square', 'diamond', 'cross'], args.shape ?? 'circle'),
      numeric('strokeWidth', 'Stroke width', args.strokeWidth ?? 0, 0, 4, 0.5)];
    build = v => ({ ...clone(), opacity: v.opacity, shape: v.shape,
      ...(v.strokeWidth > 0 ? { stroke: '#4c78a8', strokeWidth: v.strokeWidth } : {}) });
  } else if (['editBarMark', 'editLineMark', 'editAreaMark'].includes(method)) {
    controls = [numeric('opacity', 'Opacity', args.opacity ?? 0.8, 0.05, 1, 0.05),
      numeric('strokeWidth', 'Stroke width', args.strokeWidth ?? 0, 0, 5, 0.5)];
    if (method === 'editBarMark') controls.push(numeric('cornerRadius', 'Corner radius', 0, 0, 12));
    build = v => ({ ...clone(), opacity: v.opacity,
      ...(method === 'editBarMark' ? { cornerRadius: v.cornerRadius } : {}),
      ...(v.strokeWidth > 0 ? { ...(method === 'editLineMark' ? {} : { stroke: '#4c78a8' }), strokeWidth: v.strokeWidth } : {}) });
  } else if (method === 'orderCategories') {
    const axes = [...new Set(alternatives.map(a => a.args.channel))];
    const sortChoices = axes.flatMap(channel => ['category', 'count', ...quantitative].map(by => ({
      value: JSON.stringify([channel, by]), label: `${channel.toUpperCase()} · ${by}` })));
    controls = [select('by', 'Sort by', sortChoices, JSON.stringify([args.channel, 'category'])),
      select('direction', 'Direction', ['ascending', 'descending'], args.direction ?? 'ascending'),
      select('aggregate', 'Aggregation', ['mean', 'sum', 'min', 'max'], 'mean')];
    build = v => {
      const [channel, by] = v.by.startsWith('[') ? JSON.parse(v.by) : [args.channel, v.by];
      return { ...clone(), channel, by: ['category', 'count'].includes(by) ? by : { field: by, aggregate: v.aggregate }, direction: v.direction };
    };
  } else if (method === 'createMarkLabels') {
    controls = [select('content', 'Label', ['value', 'category'], args.content ?? 'value'),
      numeric('fontSize', 'Font size', args.fontSize ?? 11, 8, 18),
      select('anchor', 'Position', ['center', 'insideEnd', 'outsideEnd'], 'center')];
    build = v => ({ ...clone(), content: v.content, fontSize: v.fontSize, fontFamily: 'Arial', placement: { anchor: v.anchor } });
  } else if (method === 'createComputedData') {
    controls = [select('field', 'Source variable', options, args.expression.operand.field), text('as', 'Output column', args.as)];
    build = v => ({ ...clone(), as: v.as, expression: { op: 'toNumber', operand: { field: v.field } } });
  } else if (method === 'createSummaryData') {
    controls = [select('group', 'Group', options, args.groupBy[0]),
      select('operation', 'Aggregation', ['count', 'mean', 'sum', 'median', 'min', 'max'], args.aggregates[0].op),
      select('field', 'Value', [{ value: '', label: 'Rows (count)' }, ...quantitative.map(value => ({ value, label: value }))], '')];
    build = v => ({ ...clone(), groupBy: [v.group], aggregates: [{ op: v.operation,
      ...(v.field ? { field: v.field } : {}), as: v.group === 'count' ? 'row_count' : 'count' }] });
  } else if (['createPointMark', 'createLineMark', 'createBarMark', 'createAreaMark'].includes(method)) {
    controls = [numeric('opacity', 'Opacity', 0.7, 0.1, 1, 0.1),
      numeric('strokeWidth', 'Stroke width', method === 'createLineMark' ? 2 : 0, 0, 5, 0.5)];
    build = v => ({ ...clone(), opacity: v.opacity,
      ...(v.strokeWidth > 0 ? { stroke: '#4c78a8', strokeWidth: v.strokeWidth } : {}) });
  } else {
    // A zero-parameter real action is still usable; controls are optional.
    controls = [];
    build = clone;
  }
  const defaultDecisions = applyParameterDefaults(controls, build, recommendation);
  const defaults = valuesFor(controls);
  const modes = controls.some(c => c.key === 'mode') ? ['fixed', 'variable'] : [undefined];
  for (const mode of modes) {
    const count = controls.filter(c => !c.when || c.when({ ...defaults, mode })).length;
    // A quantitative aggregate-bar color needs the fourth, independent aggregation decision.
    const limit = method === 'encodeColor' && controls.some(c => c.key === 'aggregate') ? 4 : 3;
    if (count > limit) throw new Error('Too many visible parameter groups.');
  }
  return { controls, build, defaultDecisions };
}

export function valuesFor(controls) {
  return Object.fromEntries(controls.flatMap(c => c.type === 'group' ? Object.entries(valuesFor(c.controls)) : [[c.key, structuredClone(c.value)]]));
}

export function activeControls(controls, values) {
  return controls.filter(c => !c.when || c.when(values))
    .flatMap(c => c.type === 'group' ? activeControls(c.controls, values) : [c]);
}

// A card may group native calls for one user decision. Each selected option
// still resolves to exactly one real public method plus its native arguments.
export function buildRecommendationCall(editor, values) {
  return { method: editor.method, args: editor.build(values) };
}
