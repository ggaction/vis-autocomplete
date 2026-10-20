import { canGroupBar, barGrain, positionScaleContext } from './mark-grain.js';
import { hasChartContext } from './chart-context.js';
import { profileDataset } from './profile.js';
import { binnedPositionExpression } from './plot-aggregation.js';
import { dataEditors } from './action-capabilities.js';

const title = name => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^(edit|encode|create) /, '').replace(/^./, s => s.toUpperCase());
const number = (path, label, value, min, max, step = 1) => ({ path, label, type: 'number', value, min, max, step });
const choices = (path, label, value, values) => ({ path, label, type: 'select', value,
  choices: values.map(v => typeof v === 'object' ? v : { value: v, label: String(v) }) });
const text = (path, label, value) => ({ path, label, type: 'text', value });
const font = size => ({ fontFamily: 'Arial', fontSize: size });
const aggregateOps = ['mean', 'median', 'sum', 'min', 'max'];

// Bind options to actual resource owners, not corpus IDs or guessed names.
// These families cover fine-grained corpus actions and all corresponding native
// editors. Corpus frequencies still supply every score, without a coverage bonus.
export function extendedCandidates(program, { layer, profile }) {
  if (!hasChartContext(program, layer)) return [];
  const out = [], target = layer.id, encoding = layer.encoding ?? {}, mark = layer.mark?.type;
  const fields = profile.fields.filter(f => f.usable), quantitative = fields.filter(f => f.type === 'quantitative');
  const rows = program.semanticSpec.datasets.find(d => d.id === profile.id)?.values ?? [];
  const coordinateType = program.semanticSpec.coordinates.find(c => c.id === layer.coordinate)?.type;
  const categories = fields.filter(f => ['nominal', 'ordinal'].includes(f.type) && f.distinct > 1);
  const add = (method, category, args, parameters = [], feature = `action.${method}`, label = title(method)) => {
    out.push({ method, category, args, parameters, feature, label });
  };
  const style = (method, args, parameters, feature) => add(method, 'style', args, parameters, feature);
  const box = program.markConfigs[target]?.boxPlot;
  if (box) {
    const source = profileDataset(program, box.source), horizontal = box.orientation === 'horizontal';
    const categoryChannel = horizontal ? 'y' : 'x', measureChannel = horizontal ? 'x' : 'y';
    const categoryFields = source.fields.filter(f => f.usable && (['nominal', 'ordinal'].includes(f.type) || f.name === box.category));
    const measureFields = source.fields.filter(f => f.usable && f.type === 'quantitative');
    for (const measure of measureFields) {
      if (measure.name === box.measure && categoryFields.length === 1) continue;
      const category = categoryFields.find(f => f.name !== box.category) ?? categoryFields[0];
      const args = { target, [categoryChannel]: { field: category.name, fieldType: encoding[categoryChannel].fieldType }, [measureChannel]: { field: measure.name, fieldType: 'quantitative' } };
      add('editBoxPlot', 'encoding', args, [choices(`${categoryChannel}.field`, 'Category', category.name, categoryFields.map(f => f.name)), choices(`${measureChannel}.field`, 'Measure', measure.name, measureFields.map(f => f.name))], 'encoding.boxRoles', 'Box plot variables');
    }
  }
  // Position ordering and final-item labels do not depend on the four basic
  // Cartesian mark types. A heatmap cell or polar category is equally eligible.
  for (const channel of ['x', 'y', 'theta']) {
    if (!['nominal', 'ordinal'].includes(encoding[channel]?.fieldType)) continue;
    const current = encoding[channel].categoryOrder;
    add('orderCategories', 'transform', { target, channel, by: 'category',
      direction: current?.direction === 'ascending' ? 'descending' : 'ascending' }, [], 'action.orderCategories', 'Sort categories');
  }
  for (const channel of ['x', 'y']) {
    if (!['point', 'bar', 'rule'].includes(mark) || !['nominal', 'ordinal'].includes(encoding[channel]?.fieldType)) continue;
    for (const field of categories.filter(f => f.name !== encoding[channel].field && f.complete)) {
      const method = channel === 'x' ? 'encodeXOffset' : 'encodeYOffset';
      add(method, 'encoding', { target, field: field.name, fieldType: field.type },
        [choices('field', 'Group within band', field.name, categories.filter(f => f.name !== encoding[channel].field && f.complete).map(f => f.name))],
        `encoding.${channel}Offset`, `Offset ${channel.toUpperCase()}`);
    }
  }
  const groupFields = categories.filter(f => f.complete && (mark !== 'bar' || canGroupBar(program, layer, f.name)));
  if (['bar', 'line', 'area'].includes(mark)) for (const field of groupFields) {
    add('encodeGroup', 'encoding', { target, field: field.name },
      [choices('field', 'Series', field.name, groupFields.map(f => f.name))], 'encoding.group');
  }
  if (['point', 'bar', 'rect', 'arc', 'rule'].includes(mark) &&
      !program.semanticSpec.layers.some(l => l.source === target && program.markConfigs[l.id]?.labelAuthoring)) {
    const semantic = ['bar', 'arc'].includes(mark);
    const field = encoding.color?.field ?? encoding.y?.field ?? encoding.x?.field;
    if (semantic || fields.some(f => f.name === field)) {
      const args = { source: target, ...(semantic ? { content: 'value' } : { field }),
        fontFamily: 'Arial', fontSize: 11, placement: { anchor: semantic ? 'outsideEnd' : 'center' } };
      add('createMarkLabels', 'guide', args, semantic ? [] : [choices('field', 'Label variable', field, fields.map(f => f.name)),
        number('fontSize', 'Label size', 11, 8, 18)], 'action.createMarkLabels', 'Add value labels');
    }
  }

  const removable = ['color', 'stroke', 'size', 'shape', 'opacity', 'strokeWidth', 'strokeDash'].filter(c => encoding[c]);
  if (removable.length) add('removeEncoding', 'encoding', { target, channel: removable[0] },
    [choices('channel', 'Channel', removable[0], removable)], 'action.removeEncoding', 'Remove encoding');
  if (program.markConfigs[target]?.markFilter) add('removeMarkFilter', 'transform', { target }, [], 'action.removeMarkFilter', 'Restore filtered values');
  const regression = program.markConfigs[target]?.regression;
  if (regression) {
    const method = regression.parameters?.method === 'loess' ? 'linear' : 'loess';
    add('editRegression', 'transform', { target, method },
      [choices('method', 'Model', method, ['linear', 'polynomial', 'loess'])],
      'transform.regression', 'Adjust regression');
  }

  // The style family is based on the real mark type, including heatmap/arc/text/
  // rule/tick marks. A default opacity is not a reason to hide all mark editing.
  const editor = `edit${mark?.[0]?.toUpperCase()}${mark?.slice(1)}Mark`;
  if (['point', 'bar', 'line', 'area', 'rect', 'arc', 'rule', 'text', 'tick'].includes(mark)) {
    const opacity = program.markConfigs[target]?.opacity === .8 ? .7 : .8;
    style(editor, { target, opacity }, [number('opacity', 'Opacity', opacity, .05, 1, .05)],
      `style.${mark}.opacity`);
  }
  if (mark === 'text' && !layer.source) for (const field of fields) add('encodeText', 'encoding', { target, field: field.name },
    [choices('field', 'Text', field.name, fields.map(f => f.name))], 'encoding.text');
  if (coordinateType === 'polar') {
    for (const [channel, method] of [['theta', 'encodeTheta'], ['radius', 'encodeR']]) {
      const current = encoding[channel];
      if (!current?.field || mark === 'arc') continue;
      for (const field of quantitative.filter(f => f.complete && f.name !== current.field)) {
        add(method, 'encoding', { target, field: field.name, fieldType: 'quantitative' },
          [choices('field', 'Variable', field.name, quantitative.filter(f => f.complete).map(f => f.name))], `encoding.${channel === 'radius' ? 'r' : channel}`);
      }
    }
  }
  if (coordinateType === 'parallel') {
    for (const dimension of encoding.parallel?.dimensions ?? []) style('editParallelScale', { target, dimension: dimension.field, reverse: true },
      [choices('reverse', 'Direction', true, [{ value: false, label: 'Normal' }, { value: true, label: 'Reversed' }])]);
  }
  if (mark === 'bar') {
    add('encodeBarWidth', 'encoding', { target, pixels: 12 }, [number('pixels', 'Bar width', 12, 2, 40)], 'action.encodeBarWidth');
  }
  if (['line', 'area'].includes(mark) && coordinateType === 'cartesian') {
    for (const field of quantitative.filter(f => f.complete && !encoding.x?.bin && !encoding.y?.aggregate && !program.semanticSpec.datasets.find(d => d.id === layer.data)?.source)) {
      add('encodePathOrder', 'transform', { target, field: field.name, order: 'ascending' },
        [choices('field', 'Order by', field.name, quantitative.filter(f => f.complete).map(f => f.name)),
          choices('order', 'Order', 'ascending', ['ascending', 'descending'])]);
    }
  }
  const group = encoding.group?.field ?? (['nominal', 'ordinal'].includes(encoding.color?.fieldType) ? encoding.color?.field : undefined);
  if (group && ['bar', 'area'].includes(mark) && !program.markConfigs[target]?.horizon) {
    const numericBar = mark === 'bar' && !encoding.x?.bin &&
      !['x', 'y'].some(c => ['nominal', 'ordinal', 'temporal'].includes(encoding[c]?.fieldType));
    if (!numericBar) for (const mode of (mark === 'bar' ? ['group', 'stack', 'fill', 'overlay'] : ['stack', 'fill', 'overlay', 'center'])) {
      if (mode !== layer.layout?.mode) add('layoutSeries', 'transform', { target, mode },
        [choices('mode', 'Layout', mode, mark === 'bar' ? ['group', 'stack', 'fill', 'overlay'] : ['stack', 'fill', 'overlay', 'center'])]);
    }
  }

  if (box) {
    const channel = box.orientation === 'horizontal' ? 'y' : 'x';
    const groups = [...new Set(rows.map(row => row[box.category]))];
    if (groups.length > 1) add('filterMarks', 'transform', { target, channel, op: 'eq', value: groups[0], mode: 'replace' },
      [choices('value', `Keep ${box.category}`, groups[0], groups)], 'transform.filter', 'Filter box groups');
  }
  // Filtering works on final mark items and preserves native aggregation,
  // provenance, scales and dependency replay. No unused filtered dataset.
  if (!box && program.markConfigs[target]?.itemFilterable !== false && ['point', 'bar', 'rect', 'arc', 'rule', 'tick'].includes(mark)) {
    for (const channel of ['x', 'y']) {
      if (encoding[channel]?.fieldType !== 'quantitative') continue;
      const field = encoding[channel].field;
      // Aggregated marks live in the displayed scale domain, not the raw column.
      const domain = program.resolvedScales[encoding[channel].scale]?.domain;
      const values = (mark === 'bar' ? barGrain(program, layer).values?.[channel] ?? rows.map(r => r[field]) : encoding[channel].aggregate || encoding[channel].bin ? domain ?? [] : rows.map(r => r[field])).filter(Number.isFinite).sort((a, b) => a - b);
      if (values.length < 2 || values[0] === values.at(-1)) continue;
      const value = values[Math.floor(values.length / 4)], min = values[0], max = values.at(-1);
      add('filterMarks', 'transform', { target, channel, op: 'gte', value, mode: 'replace' },
        [choices('channel', 'Channel', channel, ['x', 'y'].filter(c => encoding[c]?.fieldType === 'quantitative')),
          choices('op', 'Keep values', 'gte', [{ value: 'gte', label: 'At least' }, { value: 'lte', label: 'At most' }]),
          number('value', 'Threshold', value, min, max, (max - min) / 100)], 'transform.filter', 'Filter values');
    }
  }

  if (mark === 'point' && coordinateType === 'cartesian') {
    if (!program.materializationConfigs.pointPacking?.[target]) add('jitterPoints', 'transform', { target, channel: 'x', maxOffset: { pixels: 4 }, seed: 0 },
      [choices('channel', 'Direction', 'x', [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'both', label: 'Both' }]),
        number('maxOffset.pixels', 'Spread', 4, 1, 16)]);
    const packingChannel = ['x', 'y'].find(c => ['nominal', 'ordinal'].includes(encoding[c]?.fieldType));
    if (packingChannel && !program.materializationConfigs.jitters?.[target]) add('packPoints', 'transform', { target, channel: packingChannel, maxOffset: { pixels: 20 }, padding: 1, overflow: 'overlap' },
      [number('maxOffset.pixels', 'Spread', 20, 4, 40), number('padding', 'Padding', 1, 0, 4, .5)]);
  }
  for (const axis of ['x', 'y']) {
    if (encoding[axis]?.fieldType !== 'quantitative') continue;
    add('createStatisticalReference', 'transform', { source: target, axis, population: 'visibleItems', statistic: { op: 'mean' },
      stroke: '#222222', strokeWidth: 2.5, strokeDash: 'solid' }, [], 'action.createStatisticalReference', 'Add statistic');
  }
  if (['line', 'area'].includes(mark) && group && rows.some(r => r[group] != null)) {
    const values = [...new Set(rows.map(r => r[group]).filter(v => v != null))];
    add('filterMarks', 'transform', { target, field: group, op: 'eq', value: values[0], mode: 'replace' },
      [choices('value', 'Keep series', values[0], values)], 'transform.filter', 'Filter series');
  }
  if (['line', 'bar'].includes(mark) && encoding.x?.fieldType === 'quantitative' && encoding.y?.aggregate) {
    const bins = encoding.x.bin?.maxBins === 12 ? 10 : 12;
    add('encodeX', 'transform', { target, field: encoding.x.field, fieldType: 'quantitative', bin: { maxBins: bins } },
      [number('bin.maxBins', 'X bins (maximum)', bins, 2, 24)], 'transform.bin', 'Bin X');
  }
  if (!box && ['line', 'bar'].includes(mark) && encoding.y?.fieldType === 'quantitative' &&
      (mark === 'line' && (encoding.x?.bin || ['nominal', 'ordinal', 'temporal'].includes(encoding.x?.fieldType)) || mark === 'bar' && (encoding.x?.bin || ['nominal', 'ordinal', 'temporal'].includes(encoding.x?.fieldType)))) {
    const op = encoding.y.aggregate === 'mean' ? 'sum' : 'mean';
    add('encodeY', 'transform', { target, field: encoding.y.field, fieldType: 'quantitative', aggregate: op },
      [choices('aggregate', 'Y aggregation', op, aggregateOps)], 'transform.aggregate', 'Aggregate Y');
  }
  const coordinate = program.semanticSpec.coordinates.find(c => c.id === layer.coordinate);
  if (coordinate?.type === 'cartesian') add('createAnnotation', 'style', { source: target, x: (program.resolvedScales[encoding.x?.scale]?.domain ?? [0])[0],
    y: (program.resolvedScales[encoding.y?.scale]?.domain ?? [0])[0],
    text: 'Note', fontFamily: 'Arial', fontSize: 13 },
    [text('text', 'Text', 'Note'), number('fontSize', 'Size', 13, 8, 24)]);
  if (coordinate?.type === 'cartesian') style('editCoordinate', { target: coordinate.id, aspect: { mode: 'frame', ratio: 1 } },
    [number('aspect.ratio', 'Width / height', 1, .5, 2, .1)]);
  style('editCanvas', { background: '#fafafa' }, [{ path: 'background', label: 'Background', type: 'color', value: '#fafafa',
    choices: ['#ffffff', '#fafafa', '#f3f4f6', '#e5e7eb'].map(value => ({ value, label: value })) }]);

  for (const [id, axis] of Object.entries(program.semanticSpec.guides.axis ?? {})) {
    const channel = axis.channel ?? id;
    if (!['x', 'y'].includes(channel) || axis.coordinate && axis.coordinate !== layer.coordinate || axis.scale !== encoding[channel]?.scale) continue;
    const prefix = `edit${channel.toUpperCase()}Axis`, current = program.guideConfigs.axis?.[id] ?? {};
    const discrete = ['nominal', 'ordinal'].includes(encoding[channel]?.fieldType);
    const size = current.labels?.fontSize === 11 ? 12 : 11;
    style(prefix, { target: id, labels: font(size) }, [number('labels.fontSize', 'Label size', size, 8, 18)]);
    style(`${prefix}Labels`, { target: id, ...font(size) }, [number('fontSize', 'Label size', size, 8, 18),
      number('offset', 'Offset', 8, 0, 30)]);
    style(`${prefix}Line`, { target: id, color: '#6b7280', lineWidth: 1.5 }, [number('lineWidth', 'Width', 1.5, .25, 3, .25)]);
    style(`${prefix}Ticks`, { target: id, length: 7 }, [number('length', 'Tick length', 7, 0, 16)]);
    style(`${prefix}TicksAndLabels`, { target: id, ...(!discrete ? { count: 6 } : {}), labels: font(size) },
      [...(!discrete ? [number('count', 'Ticks', 6, 2, 12)] : []), number('labels.fontSize', 'Label size', size, 8, 18)]);
    if (current.title) style(`${prefix}Title`, { target: id, text: current.title?.text ?? encoding[channel]?.field ?? channel, ...font(14) },
      [text('text', 'Title', current.title?.text ?? encoding[channel]?.field ?? channel), number('fontSize', 'Size', 14, 8, 24)]);
  }
  for (const direction of ['horizontal', 'vertical']) {
    if (!program.semanticSpec.guides.grid?.[direction]) continue;
    style(`edit${direction[0].toUpperCase()}${direction.slice(1)}Grid`, { color: '#cbd5e1', lineWidth: 1.5 },
      [number('lineWidth', 'Width', 1.5, .25, 3, .25)]);
  }
  // Focused scale editors are safer than changing a position scale's type in
  // place. They retain ownership and current field/aggregation policies.
  for (const channel of ['x', 'y', 'theta', 'radius', 'color', 'stroke', 'size', 'opacity', 'shape', 'strokeWidth', 'strokeDash', 'xOffset']) {
    const binding = encoding[channel];
    if (!binding?.scale) continue;
    const method = `edit${channel === 'radius' ? 'R' : channel[0].toUpperCase() + channel.slice(1)}Scale`;
    const scale = program.semanticSpec.scales.find(s => s.id === binding.scale);
    if (!scale) continue;
    if (['color', 'stroke'].includes(channel)) {
      const palette = ['nominal', 'ordinal'].includes(binding.fieldType) ? 'category10' : 'blues';
      style(method, { target, palette }, [choices('palette', 'Palette', palette,
        ['nominal', 'ordinal'].includes(binding.fieldType) ? ['category10', 'tableau10'] : ['blues', 'reds', 'viridis'])]);
    } else if (['x', 'y', 'theta', 'radius', 'xOffset'].includes(channel) && !(channel === 'radius' && mark === 'arc')) {
      const direction = choices('reverse', 'Direction', !scale.reverse, [{ value: false, label: 'Normal' }, { value: true, label: 'Reversed' }]);
      if (['x', 'y'].includes(channel) && binding.fieldType === 'quantitative') {
        const values = rows.map(row => row[binding.field]).filter(Number.isFinite);
        const baseline = positionScaleContext(program, layer, profile).zeroBaseline[channel];
        const positive = values.length > 0 && values.every(v => v > 0);
        const types = ['linear', { value: 'log', label: 'Log', disabled: baseline || !positive, reason: baseline ? 'This mark requires a zero baseline. Use symlog to retain zero.' : 'Log requires a strictly positive field.' }, 'sqrt', 'symlog'];
        style(method, { target, type: scale.type, reverse: !scale.reverse }, [choices('type', 'Scale', scale.type, types), direction]);
      } else style(method, { target, reverse: !scale.reverse }, [direction]);
    } else if (channel === 'shape') style(method, { target, range: ['square', 'circle', 'diamond', 'cross', 'triangle-up', 'triangle-down'].slice(0,
      program.resolvedScales[binding.scale]?.domain?.length ?? 3) });
    else if (channel === 'strokeDash') style(method, { target, reverse: !scale.reverse });
    else {
      const range = channel === 'size' ? [20, 240] : channel === 'opacity' ? [.25, .9] : [1, 5];
      style(method, { target, range }, [number('range.0', 'Minimum', range[0], channel === 'opacity' ? .05 : 0, channel === 'size' ? 1600 : channel === 'opacity' ? 1 : 10, channel === 'opacity' ? .05 : 1),
        number('range.1', 'Maximum', range[1], 0, channel === 'size' ? 1600 : channel === 'opacity' ? 1 : 10, channel === 'opacity' ? .05 : 1)]);
    }
  }
  const covered = new Set(Object.values(program.semanticSpec.guides.legend ?? {}).flatMap(l => [l.scale, ...(l.scales ?? [])]));
  for (const channel of ['color', 'stroke', 'size', 'shape', 'opacity', 'strokeWidth', 'strokeDash']) {
    if (!encoding[channel]?.scale || !covered.has(encoding[channel].scale)) continue;
    const owner = { target, channel };
    style('editLegendLabels', { ...owner, ...font(13) }, [number('fontSize', 'Label size', 13, 8, 18)]);
    style('editLegendTitle', { ...owner, title: encoding[channel]?.field ?? channel, ...font(14) },
      [text('title', 'Title', encoding[channel]?.field ?? channel), number('fontSize', 'Size', 14, 8, 24)]);
    style('editLegendLayout', { ...owner, position: 'top-right' }, [choices('position', 'Position', 'top-right',
      ['right', 'left', 'top', 'bottom', 'top-right', 'top-left', 'bottom-right', 'bottom-left'])]);
    style('editLegendBorder', { ...owner, border: { color: '#9ca3af', lineWidth: 1, padding: 8 } },
      [number('border.padding', 'Padding', 8, 0, 20), number('border.lineWidth', 'Width', 1, .25, 3, .25)]);
    style('editLegendBlock', { ...owner, gap: 12 }, [number('gap', 'Gap', 12, 1, 30)]);
    if (!['nominal', 'ordinal'].includes(encoding[channel].fieldType) && ['color', 'stroke'].includes(channel)) style('editLegendSymbols', { ...owner, gradient: { length: 100, thickness: 14 } },
      [number('gradient.length', 'Length', 100, 40, 180), number('gradient.thickness', 'Thickness', 14, 4, 25)]);
  }

  // Derived charts are not restricted to their last three output columns.
  // Traverse the complete live ancestry and expose native editors on its owners.
  const datasets = new Map(program.semanticSpec.datasets.map(d => [d.id, d]));
  let dataset = datasets.get(layer.data); const visited = new Set();
  while (dataset?.source && !visited.has(dataset.id)) {
    visited.add(dataset.id);
    const transform = dataset.transform?.[0], method = dataEditors[transform?.type];
    const sourceProfile = profileDataset(program, dataset.source), sourceFields = sourceProfile.fields.filter(f => f.usable);
    const q = sourceFields.filter(f => f.type === 'quantitative').map(f => f.name);
    const args = { target: dataset.id, dependents: 'recompute' };
    // Only explicit public data owners may be edited; chart-owned statistics
    // are revised using their native chart editor instead.
    const creator = transform?.type === 'filter' ? 'filterData' : method?.replace(/^edit/, 'create');
    const owned = creator && program.trace.children.some(n => n.op === creator && n.args.id === dataset.id) ||
      Object.values(program.materializationConfigs.data ?? {}).some(owners => Object.values(owners).some(o => o?.current === dataset.id));
    if (method && owned) {
      if (transform.type === 'summary') {
        for (const [index, aggregate] of transform.aggregates.entries()) {
          const values = [...new Set([aggregate.field, ...q].filter(f => f && !transform.groupBy.includes(f)))];
          for (const field of values) for (const op of aggregateOps) {
            if (field === aggregate.field && op === aggregate.op) continue;
            const as = aggregate.as;
            // Keep live output aliases. Native guide inference follows the
            // aggregate's source field, while all consumers keep their binding.
            add(method, 'transform', { ...args, aggregates: transform.aggregates.map((a, i) => i === index ? { ...a, field, op, as } : { ...a }) },
              [choices(`aggregates.${index}.field`, 'Value', field, values),
                choices(`aggregates.${index}.op`, 'Y aggregation', op, aggregateOps)], 'transform.aggregate', 'Aggregate values');
          }
        }
      } else if (transform.type === 'filter') {
        // Preserve the field and null exclusion used during selection setup.
        // Revise the *live source*, so every dependent summary/path recomputes.
        const field = sourceFields.find(f => f.name === transform.field && f.type === 'quantitative');
        const values = datasets.get(dataset.source)?.values.map(r => r[field?.name]).filter(Number.isFinite).sort((a, b) => a - b) ?? [];
        if (field && values[0] < values.at(-1)) {
          const threshold = values[Math.floor(values.length / 4)];
          add(method, 'transform', { ...args, field: field.name, predicate: { op: 'gte', value: threshold }, nulls: 'exclude' },
            [choices('predicate.op', 'Keep values', 'gte', [{ value: 'gte', label: 'At least' }, { value: 'lte', label: 'At most' }]),
              number('predicate.value', field.name, threshold, values[0], values.at(-1), (values.at(-1) - values[0]) / 100)], 'transform.filter', `Filter ${field.name}`);
        }
      } else if (transform.type === 'computed' && quantitative.some(f => f.name === transform.as)) {
        const referenced = new Set();
        const visit = value => { if (!value || typeof value !== 'object') return;
          if (value.field) referenced.add(value.field); Object.values(value).forEach(visit); };
        visit(transform.expression);
        const binOwner = program.semanticSpec.datasets.find(d => d.source === dataset.source && d.transform?.[0]?.type === 'bin' && referenced.has(d.transform[0].field));
        if (binOwner && transform.expression?.op === 'if') {
          const bin = binOwner.transform[0], values = datasets.get(dataset.source).values.map(row => row[bin.field]).filter(Number.isFinite);
          const domain = values.reduce((d, v) => [Math.min(d[0], v), Math.max(d[1], v)], [Infinity, -Infinity]), bins = bin.maxBins === 12 ? 10 : 12;
          add('editComputedData', 'transform', { ...args, expression: binnedPositionExpression(bin.field, domain, bins) }, [], 'transform.bin', 'Bin X');
          out.at(-1).binRecipe = { field: bin.field, domain, bins };
        } else for (const field of q.filter(f => referenced.has(f))) add(method, 'transform', { ...args,
          expression: { op: 'multiply', left: { field }, right: { constant: 1.1 } } },
          [number('expression.right.constant', 'Multiplier', 1.1, .25, 2, .05)], 'action.createComputedData', 'Compute values');
      } else if (transform.type === 'bin') {
        if (!transform.boundaries && !transform.step) add(method, 'transform', { ...args, maxBins: transform.maxBins === 12 ? 10 : 12 },
          [number('maxBins', 'Bins (maximum)', transform.maxBins === 12 ? 10 : 12, 2, 24)], 'transform.bin');
      } else if (transform.type === 'bin2d') add(method, 'transform', { ...args, bins: 12 }, [number('bins', 'Bins', 12, 2, 24)], 'transform.bin');
      else if (transform.type === 'timeUnit') add(method, 'transform', { ...args, unit: transform.unit === 'month' ? 'year' : 'month' },
        [choices('unit', 'Time unit', transform.unit === 'month' ? 'year' : 'month', ['year', 'quarter', 'month', 'week', 'day'])]);
      else if (transform.type === 'regression') add(method, 'transform', { ...args, method: transform.method === 'linear' ? 'loess' : 'linear' },
        [choices('method', 'Model', transform.method === 'linear' ? 'loess' : 'linear', ['linear', 'loess', 'polynomial'])], 'transform.regression');
      else if (transform.type === 'sort') add(method, 'transform', { ...args, sortBy: transform.sortBy.map(k => ({ ...k, order: k.order === 'descending' ? 'ascending' : 'descending' })) },
        [choices('sortBy.0.order', 'Order', transform.sortBy[0]?.order === 'descending' ? 'ascending' : 'descending', ['ascending', 'descending'])]);
      else if (transform.type === 'stack') add(method, 'transform', { ...args, mode: transform.mode === 'fill' ? 'stack' : 'fill' },
        [choices('mode', 'Stack', transform.mode === 'fill' ? 'stack' : 'fill', ['stack', 'fill'])]);
      else if (transform.type === 'impute') add(method, 'transform', { ...args, method: 'mean' }, [choices('method', 'Missing values', 'mean', ['mean', 'forward', 'backward'])]);
      else if (transform.type === 'complete') add(method, 'transform', { ...args,
        fill: { ...transform.fill, ...Object.fromEntries(q.filter(f => f !== transform.key && !transform.groupBy?.includes(f)).map(f => [f, 0])) } });
      else if (transform.type === 'window' && transform.operations?.some(o => o.field)) add(method, 'transform', { ...args,
        operations: transform.operations.map(o => o.field ? { ...o, op: o.op === 'mean' ? 'sum' : 'mean' } : o) },
        [choices('operations.0.op', 'Window', transform.operations[0].op === 'mean' ? 'sum' : 'mean', ['mean', 'sum', 'min', 'max'])]);
    }
    dataset = datasets.get(dataset.source);
  }
  return out;
}
