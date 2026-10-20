import { describeAction } from 'ggaction/inspection';
import { profileDataset } from './profile.js';
import { encodingFeature } from './semantics.js';

const categorical = type => ['nominal', 'ordinal'].includes(type);
const choices = values => values.map(value => ({ value, label: value }));
const positionMethods = { x: 'encodeX', y: 'encodeY', x2: 'encodeX2', y2: 'encodeY2', theta: 'encodeTheta', radius: 'encodeR' };

// Domain-owned derived coordinates must be edited through their semantic owner,
// not by swapping a density/quantile/bin boundary for another generated column.
export function positionOwner(program, layer) {
  const config = program.markConfigs[layer.id] ?? {};
  if (config.intervalPlot) return { method: 'editErrorBar', target: config.intervalPlot.intervalId,
    config: program.markConfigs[config.intervalPlot.intervalId].errorBar };
  for (const [key, method] of Object.entries({ boxPlot: 'editBoxPlot', violinPlot: 'editViolinPlot',
    gradientPlot: 'editGradientPlot', endpointPlot: 'editEndpointPlot', ecdfPlot: 'editECDFPlot' })) {
    if (config[key]) return { method, config: config[key] };
  }
  const dataset = program.semanticSpec.datasets.find(d => d.id === layer.data);
  const transform = dataset?.transform?.[0];
  if (['bin2d', 'horizon'].includes(transform?.type)) return {
    method: { bin2d: 'editBin2DData' }[transform.type] ?? null, dataset, transform,
  };
  return null;
}

export function positionCandidates(program, { layer, profile }) {
  if (!layer || layer.source || positionOwner(program, layer)) return [];
  const coordinate = program.semanticSpec.coordinates.find(c => c.id === layer.coordinate);
  if (coordinate?.type === 'parallel') return [];
  const channels = coordinate?.type === 'polar' ? ['theta', 'radius'] : ['x', 'y', 'x2', 'y2'];
  const target = layer.id, encoding = layer.encoding ?? {}, mark = layer.mark.type;
  const regression = program.markConfigs[target]?.regression;
  const fields = profile.fields.filter(f => f.usable), out = [];
  const rows = program.semanticSpec.datasets.find(d => d.id === layer.data)?.values ?? [];
  const radialScale = program.semanticSpec.scales.find(s => s.id === encoding.radius?.scale);
  const measured = mark === 'arc' && Boolean(radialScale?.radialMapping);
  for (const channel of channels) {
    if (channel.endsWith('2') && !encoding[channel]) continue;
    const method = positionMethods[channel], current = encoding[channel];
    const descriptor = describeAction(program, { action: method, target: { kind: 'mark', id: target } });
    if (!['supported', 'needs-input'].includes(descriptor.applicability)) continue;
    const supportedTypes = descriptor.parameterDefinitions.find(p => p.path === 'fieldType')?.choices;
    const allowed = fields.filter(f => {
      if (regression && (f.type !== 'quantitative' || f.name === encoding[channel === 'x' ? 'y' : 'x']?.field)) return false;
      // A categorical bar position needs a quantitative opposite axis. This
      // preserves both horizontal and vertical bars without inventing a second call.
      if (mark === 'bar' && ['x', 'y'].includes(channel) && f.type !== 'quantitative' &&
          encoding[channel === 'x' ? 'y' : 'x']?.fieldType !== 'quantitative') return false;
      // Re-encoding preserves these native policies. They cannot be applied to
      // categorical fields or atomically removed by the same public call.
      if (mark === 'bar' && (current?.bin || current?.aggregate) && f.type !== 'quantitative') return false;
      if (mark === 'area' && encoding[`${channel}2`] && f.type !== 'quantitative') return false;
      if (mark === 'line' && channel === 'y' && categorical(f.type) &&
          !categorical(encoding.x?.fieldType) && encoding.x?.fieldType !== 'temporal' && !encoding.x?.bin) return false;
      if (channel === 'radius') return f.type === 'quantitative' && (mark !== 'arc' || rows.every(r => Number.isFinite(r[f.name]) && r[f.name] >= 0));
      if (measured && channel === 'theta') return categorical(f.type);
      if (supportedTypes && !supportedTypes.includes(f.type)) return false;
      if (channel.endsWith('2')) return f.type === (current?.fieldType ?? 'quantitative');
      return true;
    });
    for (const field of allowed) {
      if (field.name === current?.field && !measured) continue;
      const args = { target, field: field.name, fieldType: field.type };
      if (current?.aggregate && field.type === 'quantitative') args.aggregate = current.aggregate;
      if (mark === 'bar' && channel === 'y' && encoding.x?.bin && args.aggregate === 'count' && field.name !== encoding.x.field) args.aggregate = 'mean';
      if (current?.bin && field.type === 'quantitative') args.bin = { ...current.bin };
      if (measured && channel === 'radius') Object.assign(args, { aggregate: 'sum', mapping: radialScale.radialMapping });
      const scale = program.semanticSpec.scales.find(s => s.id === current?.scale);
      const type = field.type === 'temporal' ? 'time' : categorical(field.type) ? 'band' : 'linear';
      if (current && (field.type !== current.fieldType || Array.isArray(scale?.domain) && field.name !== current.field || categorical(field.type) && !['point', 'band', 'ordinal'].includes(scale?.type))) {
        const stem = `${target}-${channel}-${field.type}`;
        let id = stem;
        for (let i = 2; program.semanticSpec.scales.some(s => s.id === id); i++) id = `${stem}-${i}`;
        args.scale = { id, type };
      }
      if (mark === 'bar' && ['x', 'y'].includes(channel) && field.type === 'quantitative' &&
          categorical(encoding[channel === 'x' ? 'y' : 'x']?.fieldType)) args.aggregate ??= 'mean';
      if (mark === 'line' && channel === 'x' && field.type === 'quantitative' && encoding.y?.aggregate && !args.bin) args.bin = { maxBins: 10 };
      out.push({ method, args, category: 'encoding', feature: encodingFeature(channel),
        label: `Encode ${channel === 'radius' ? 'R' : channel.toUpperCase()}`,
        inspectionTarget: { kind: 'mark', id: target },
        // Cartesian X/Y use their full field/scale editor; other positions use
        // native field alternatives. Never force all variants to the first type.
        ...(!['x', 'y'].includes(channel) || regression ? { positionFields: true } : {}),
        ...(measured && channel === 'radius' ? { radialContext: { measured: true, mapping: radialScale.radialMapping,
          fields: allowed.map(f => f.name) } } : {}),
      });
    }
    if (measured && channel === 'radius') for (const mapping of [radialScale.radialMapping, radialScale.radialMapping === 'area' ? 'radius-length' : 'area']) {
      out.push({ method, args: { target, aggregate: 'count', mapping },
        category: 'encoding', feature: encodingFeature(channel), label: 'Encode R',
        radialContext: { measured: true, mapping, fields: allowed.map(f => f.name) } });
    }
  }
  return out;
}

// Rebind source variables at the facade that owns all dependent marks/data.
export function ownedPositionCandidates(program, { layer, profile }) {
  if (!layer) return [];
  const target = layer.id, owner = positionOwner(program, layer), out = [];
  const parameter = (path, label, value, fields) => ({ path, label, value, type: 'select', choices: choices(fields) });
  const add = (method, args, parameters, feature, label) => out.push({ method, args, parameters, category: 'encoding', feature, label });
  if (owner?.config && owner.method !== 'editBoxPlot') {
    const config = owner.config, source = profileDataset(program, config.source);
    const q = source.fields.filter(f => f.usable && f.type === 'quantitative').map(f => f.name);
    const categories = source.fields.filter(f => f.usable && ['nominal', 'ordinal'].includes(f.type)).map(f => f.name);
    if (['editViolinPlot', 'editGradientPlot'].includes(owner.method)) {
      const categoryAxis = config.orientation === 'horizontal' ? 'y' : 'x', valueAxis = categoryAxis === 'x' ? 'y' : 'x';
      const categoryFields = [...new Set([config.category, ...categories])];
      for (const category of categoryFields) for (const field of q.filter(f => f !== category)) {
        const args = { target, [categoryAxis]: { field: category, fieldType: category === config.category ? config.categoryType : 'nominal' },
          [valueAxis]: { field, fieldType: 'quantitative' } };
        add(owner.method, args,
          [{ ...parameter(`${categoryAxis}.field`, 'Category', category, categoryFields), distinctFrom: `${valueAxis}.field` },
            { ...parameter(`${valueAxis}.field`, 'Measure', field, q), distinctFrom: `${categoryAxis}.field` }],
          `action.${owner.method}`, 'Edit distribution variables');
      }
    } else if (owner.method === 'editECDFPlot') {
      for (const field of q) add(owner.method, { target, field }, [parameter('field', 'Variable', field, q)], 'action.editECDFPlot', 'ECDF variable');
    } else if (owner.method === 'editErrorBar') {
      const valueAxis = config.orientation === 'vertical' ? 'y' : 'x', categoryAxis = valueAxis === 'y' ? 'x' : 'y';
      const positions = source.fields.filter(f => f.usable && f.type === config.positionFieldType).map(f => f.name);
      const transform = program.semanticSpec.datasets.find(d => d.id === config.data)?.transform?.[0];
      if (transform?.type === 'interval') for (const field of q) add(owner.method, { target: owner.target,
        [valueAxis]: { field, center: transform.center, extent: transform.extent,
          ...(transform.method ? { method: transform.method } : {}), ...(transform.level ? { level: transform.level } : {}) } },
        [parameter(`${categoryAxis}.field`, 'Position', config.positionField, positions), parameter(`${valueAxis}.field`, 'Measure', field, q)],
        'action.editErrorBar', 'Interval variables');
    } else if (owner.method === 'editEndpointPlot') {
      const roles = config.roles, paths = roles.value ? ['value'] : ['start', 'end'];
      for (const field of q.filter(f => paths.length === 1 || f !== roles.end.field)) add(owner.method, { target, [paths[0]]: { field, fieldType: 'quantitative' } },
        [parameter('category.field', 'Category', roles.category.field, categories),
          ...paths.map(path => ({ ...parameter(`${path}.field`, path === 'value' ? 'Value' : path, path === paths[0] ? field : roles[path].field, q),
            ...(paths.length === 2 ? { distinctFrom: `${path === 'start' ? 'end' : 'start'}.field` } : {}) }))], 'action.editEndpointPlot', 'Endpoint variables');
    }
  }
  if (layer.encoding?.parallel) {
    const dimensions = layer.encoding.parallel.dimensions.map(d => d.field);
    const available = profile.fields.filter(f => f.usable && f.type === 'quantitative').map(f => f.name);
    if (available.length >= 2) add('encodeParallelCoordinates', { target, dimensions: [...dimensions].reverse() },
      [{ path: 'dimensions', label: 'Dimensions', type: 'multiselect', minimum: 2, value: [...dimensions].reverse(), choices: choices(available) }], 'encoding.parallel', 'Parallel dimensions');
  }
  return out;
}
