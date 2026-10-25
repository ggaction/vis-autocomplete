// Axis editors follow the coordinate's public guide owners. Aggregate editAxes
// remains useful, while these cards expose individual radial/parallel decisions.
const number = (path, label, value, min, max, step = 1) => ({ path, label, type: 'number', value, min, max, step });
const select = (path, label, value, choices) => ({ path, label, type: 'select', value, choices: choices.map(value => ({ value, label: value })) });
const color = (path, label, value) => ({ ...select(path, label, value, ['#000000', '#555555', '#9ca3af', '#4c78a8']), type: 'color' });
export function specializedAxisCandidates(program, layer) {
  const out = [], add = (method, args, parameters, label) => out.push({ method, args, parameters,
    category: 'style', feature: `action.${method}`, label });
  const coordinate = program.semanticSpec.coordinates.find(c => c.id === layer.coordinate);
  if (coordinate?.type === 'parallel') {
    const axes = program.guideConfigs.axis?.parallel?.axes;
    const dimensions = axes?.target === layer.id ? axes.dimensions : [];
    const numericDimensions = layer.encoding.parallel.dimensions
      .filter(dimension => dimension.fieldType === 'quantitative').map(dimension => dimension.field);
    for (const dimension of dimensions ?? []) {
      const args = { target: layer.id, field: dimension.field, ticksAndLabels: { labels: { fontSize: dimension.labels?.fontSize === 11 ? 12 : 11 } } };
      add('editParallelAxis', args, [select('field', 'Dimension', dimension.field, dimensions.map(d => d.field)),
        number('ticksAndLabels.labels.fontSize', 'Label size', args.ticksAndLabels.labels.fontSize, 8, 18),
        { ...number('ticksAndLabels.count', 'Ticks', dimension.ticks?.count ?? 5, 2, 12),
          whenPath: { path: 'field', values: numericDimensions } },
        number('line.lineWidth', 'Axis width', dimension.line?.lineWidth ?? 1, 0, 5, .25)], 'Adjust parallel axis');
    }
  }
  if (coordinate?.type !== 'polar') return out;
  for (const [id, axis] of Object.entries(program.semanticSpec.guides.axis ?? {})) {
    const channel = axis.channel ?? id;
    if (!['theta', 'radius'].includes(channel) || axis.coordinate && axis.coordinate !== layer.coordinate ||
      axis.scale !== layer.encoding[channel]?.scale) continue;
    const prefix = channel === 'theta' ? 'editThetaAxis' : 'editRadialAxis';
    const config = program.guideConfigs.axis?.[id] ?? {}, target = id === channel ? {} : { target: id };
    const size = config.labels?.fontSize === 11 ? 12 : 11;
    const discrete = ['nominal', 'ordinal'].includes(layer.encoding[channel]?.fieldType);
    add(prefix, { ...target, ticksAndLabels: { labels: { fontSize: size } } }, [
      ...(channel === 'radius' ? [number('angle', 'Angle (°)', config.layout?.angle ?? 0, -180, 180, 5)] : []),
      number('ticksAndLabels.labels.fontSize', 'Label size', size, 8, 18),
      number('line.lineWidth', 'Axis width', config.line?.lineWidth ?? 1, 0, 5, .25),
      ...(!discrete ? [number('ticksAndLabels.count', 'Ticks', config.ticks?.count ?? 5, 2, 12)] : [])],
    channel === 'theta' ? 'Adjust angular axis' : 'Adjust radial axis');
    if (config.labels) add(`${prefix}Labels`, { ...target, fontSize: size }, [
      number('fontSize', 'Label size', size, 8, 18),
      number('offset', 'Offset', config.labels.offset ?? 8, 0, 30),
      color('color', 'Text color', config.labels.color ?? '#555555')], 'Edit axis labels');
    if (config.line) add(`${prefix}Line`, { ...target, lineWidth: 1.5 }, [
      number('lineWidth', 'Axis width', 1.5, 0, 5, .25), color('color', 'Line color', config.line.color ?? '#6b7280')], 'Edit axis line');
    if (config.ticks) add(`${prefix}Ticks`, { ...target, length: 7 }, [
      number('length', 'Tick length', 7, 0, 16), number('lineWidth', 'Tick width', config.ticks.lineWidth ?? 1, 0, 5, .25),
      ...(!discrete ? [number('count', 'Ticks', config.ticks.count ?? 5, 2, 12)] : [])], 'Edit axis ticks');
    if (config.title) add(`${prefix}Title`, { ...target, text: config.title.text ?? layer.encoding[channel].field, fontSize: 14 }, [
      { path: 'text', label: 'Title', type: 'text', value: config.title.text ?? layer.encoding[channel].field },
      number('fontSize', 'Size', 14, 8, 24), color('color', 'Text color', config.title.color ?? '#555555')], 'Edit axis title');
  }
  return out;
}
