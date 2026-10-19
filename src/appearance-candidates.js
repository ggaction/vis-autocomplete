import { hasChartContext } from './chart-context.js';
import { describeAction } from 'ggaction/inspection';
import { preferVisualFields } from './profile.js';
import { actionFeatures } from './semantics.js';

// Recipes describe useful values; the library's target/type inspection owns
// compatibility. Every mark uses this path, including derived and non-Cartesian
// plots. Ranking never renders a speculative chart to discover its mark type.
const recipes = [
  ['encodeColor', 'color', ['#4c78a8', '#e45756']], ['encodeStroke', 'stroke', ['#000000', '#555555']],
  ['encodeOpacity', 'opacity', [.7, .45]], ['encodeSize', 'size', [64, 100]],
  ['encodeStrokeWidth', 'strokeWidth', [2, 3]], ['encodeStrokeDash', 'strokeDash', ['dashed', 'solid']],
  ['encodeAngle', 'angle', [30, 60]], ['encodeShape', 'shape'],
];

export function appearanceCandidates(program, { layer, profile }) {
  if (!layer) return [];
  const target = layer.id, inspectionTarget = { kind: 'mark', id: target };
  const encoding = layer.encoding ?? {}, mark = layer.mark.type;
  if (!hasChartContext(program, layer)) return [];
  const rows = program.semanticSpec.datasets.find(d => d.id === profile.id)?.values ?? [];
  const fields = preferVisualFields(profile.fields.filter(f => f.usable), 'color');
  const implicitSeries = mark === 'line' ? encoding.color?.field ?? encoding.strokeDash?.field : undefined;
  const group = encoding.group?.fields ?? (encoding.group?.field ? [encoding.group.field] : implicitSeries ? [implicitSeries] : []);
  const constantIn = (field, keys) => {
    const values = new Map();
    for (const row of rows) {
      const key = JSON.stringify(keys.map(k => row[k]));
      if (values.has(key) && values.get(key) !== row[field]) return false;
      values.set(key, row[field]);
    }
    return true;
  };
  const out = [];
  for (const [method, channel, fixedValues] of recipes) {
    const descriptor = describeAction(program, { action: method, target: inspectionTarget });
    if (!['supported', 'needs-input'].includes(descriptor.applicability)) continue;
    const types = descriptor.parameterDefinitions.find(p => p.path === 'fieldType')?.choices ?? [];
    const hasField = descriptor.parameterDefinitions.some(p => p.path === 'field');
    for (const field of hasField ? fields : []) {
      if (!types.includes(field.type)) continue;
      if (channel === 'size' && field.type !== 'quantitative') continue;
      if (channel === 'shape' && (field.distinct < 2 || field.distinct > 6)) continue;
      if (mark === 'text' && layer.source) continue;
      // A line/area appearance describes a complete path, not individual rows.
      if (['line', 'area'].includes(mark)) {
        if (mark === 'line' && ['color', 'strokeDash'].includes(channel) && !encoding.group) {
          // These two native line encodings define series. Without an explicit
          // group they must agree when both are mapped. Area does not infer this.
          const other = channel === 'color' ? encoding.strokeDash : encoding.color;
          if (other?.field && other.field !== field.name) continue;
        } else if (!constantIn(field.name, group)) continue;
        if (mark === 'line' && channel === 'color' && !['nominal', 'ordinal'].includes(field.type)) continue;
      }
      if (mark === 'arc' && channel === 'color' && ![encoding.theta?.field, encoding.color?.field].includes(field.name)) continue;
      const aggregateBar = mark === 'bar' && (encoding.x?.aggregate || encoding.y?.aggregate);
      const args = { target, field: field.name, fieldType: field.type };
      if (mark === 'bar' && channel === 'color' && field.type === 'quantitative' && aggregateBar) args.aggregate = aggregateBar;
      if (channel === 'opacity') args.scale = { range: [.25, 1] };
      if (channel === 'strokeWidth') {
        if (rows.some(row => typeof row[field.name] === 'number' && row[field.name] < 0)) continue;
        args.scale = { range: [1, 4] };
      }
      out.push({ method, args, feature: actionFeatures(method, args)[0], category: 'encoding',
        label: `${field.name}: ${channel}`, inspectionTarget });
    }
    // Two distinct constants ensure a native default/no-op cannot erase a
    // supported function when no field mapping is valid for this data grain.
    if (fixedValues && descriptor.parameterDefinitions.some(p => p.path === 'value')) for (const value of fixedValues) {
      out.push({ method, args: { target, value }, feature: actionFeatures(method, { value })[0], category: 'encoding',
        label: `Fixed ${channel}`, inspectionTarget });
    }
  }
  return out;
}
