const choice = (path, label, value, values) => ({ path, label, type: 'select', value,
  choices: values.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) })) });

export function overlayCandidates(program, layer) {
  if (!layer) return [];
  const binding = layer.derivedBindings?.overlay;
  if (binding) {
    const source = program.semanticSpec.layers.find(item => item.id === binding.source);
    const stacked = source?.mark.type === 'bar' && ['stack', 'fill', 'diverging'].includes(source.layout?.mode);
    const series = choice('series', 'Follow', binding.series ?? 'source', ['source', 'total']);
    series.choices = series.choices.map(option => ({ ...option,
      ...(option.value === 'total' && !stacked ? { disabled: true,
        reason: 'Total follows the combined endpoint of stacked bars. Stack the source series first.' } : {}) }));
    return [{ method: 'editOverlay', category: 'encoding', feature: 'action.editOverlay',
      label: 'Edit overlay', args: { target: layer.id, missing: binding.missing === 'break' ? 'connect' : 'break' },
      parameters: [series, choice('missing', 'Missing values', binding.missing, ['break', 'connect']),
        choice('orderBy', 'Order by', binding.orderBy ?? 'x', ['x', 'y'])] }];
  }
  if (layer.source || !['point', 'bar', 'line', 'area'].includes(layer.mark.type) ||
      !layer.encoding?.x || !layer.encoding?.y ||
      program.semanticSpec.coordinates.find(c => c.id === layer.coordinate)?.type !== 'cartesian') return [];
  const used = new Set(program.semanticSpec.layers.map(l => l.id));
  let id = 'overlay';
  for (let n = 2; used.has(id); n++) id = `overlay${n}`;
  const stacked = layer.mark.type === 'bar' && ['stack', 'fill', 'diverging'].includes(layer.layout?.mode);
  const orderBy = layer.mark.type === 'bar' && ['nominal', 'ordinal'].includes(layer.encoding.y.fieldType) ? 'y' : 'x';
  return ['line', 'point'].map(type => ({ method: 'createOverlay', category: 'encoding', feature: 'action.createOverlay',
    label: 'Add overlay', args: { id, source: layer.id, type, basis: 'visibleItems', series: 'source',
      missing: 'break', orderBy }, nextContext: { target: id }, parameters: [
      choice('type', 'Overlay', type, ['line', 'point']),
      ...(stacked ? [choice('series', 'Follow', 'source', ['source', 'total'])] : []),
      choice('missing', 'Missing values', 'break', ['break', 'connect']),
      choice('orderBy', 'Order by', orderBy, ['x', 'y']),
    ] })).filter(candidate => describeAction(program, { action: candidate.method, options: candidate.args }).applicability === 'supported');
}
import { describeAction } from 'ggaction/inspection';
