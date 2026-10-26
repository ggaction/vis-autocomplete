import { describeAction } from 'ggaction/inspection';
import { profileDataset } from './profile.js';
import { encodingFeature } from './semantics.js';
import { chartOwner } from './chart-owner.js';
import { ownedChartCandidates } from './owned-chart-candidates.js';
import { MAX_GENERATED_ITEMS } from '../vendor/ggaction/src/core/validation.js';

const categorical = type => ['nominal', 'ordinal'].includes(type);
const choices = values => values.map(value => ({ value, label: value }));
const positionMethods = { x: 'encodeX', y: 'encodeY', x2: 'encodeX2', y2: 'encodeY2', theta: 'encodeTheta', radius: 'encodeR' };

// Domain-owned derived coordinates must be edited through their semantic owner,
// not by swapping a density/quantile/bin boundary for another generated column.
export const positionOwner = chartOwner;

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
    const unavailable = [];
    const reject = (field, reason) => { unavailable.push({ value: field.name, label: field.name, disabled: true, reason }); return false; };
    const packing = program.materializationConfigs.pointPacking?.[target];
    const jitter = program.materializationConfigs.jitters?.[target];
    const sourceData = program.semanticSpec.datasets.find(data => data.id === layer.data);
    const completion = sourceData?.transform?.find(transform => transform.type === 'complete');
    const allowed = fields.filter(f => {
      if (f.type === 'quantitative' && f.missing && layer.mark.missing !== 'skip')
        return reject(f, 'This positional encoding needs finite values. Filter missing observations first.');
      if (mark === 'bar' && ['x', 'y'].includes(channel) && f.type === 'quantitative' &&
          encoding[channel === 'x' ? 'y' : 'x']?.fieldType === 'quantitative' && !current?.bin && !encoding[channel === 'x' ? 'y' : 'x']?.bin)
        return reject(f, 'Bars need a categorical or binned position opposite their measure.');
      if (mark === 'arc' && channel === 'theta' && categorical(f.type)) {
        for (const paint of ['color', 'stroke', 'opacity', 'strokeWidth', 'strokeDash']) {
          const painted = encoding[paint]?.field;
          if (!painted) continue;
          const byCategory = new Map();
          for (const row of rows) {
            const key = row[f.name];
            if (byCategory.has(key) && byCategory.get(key) !== row[painted])
              return reject(f, `Each sector needs one ${paint} value. Choose a category consistent with ${painted}, or change that encoding first.`);
            byCategory.set(key, row[painted]);
          }
        }
      }
      if (mark === 'area' && completion && completion.key === current?.field && f.name !== current.field &&
          layer.layout?.mode && layer.layout.mode !== 'overlay') {
        const opposite = channel === 'x' ? 'y' : 'x';
        if ([encoding[opposite]?.field, encoding[`${opposite}2`]?.field].includes(f.name))
          return reject(f, 'Stacking needs separate position and measurement fields for completed rows. Choose another field or Overlay layout.');
        if (completion.groupBy.includes(f.name))
          return reject(f, 'A series needs multiple positions; its grouping field cannot also be its position.');
        const sourceRows = program.semanticSpec.datasets.find(data => data.id === sourceData.source)?.values ?? [];
        const keys = sourceRows.map(row => JSON.stringify([...completion.groupBy, f.name].map(field => row[field])));
        if (new Set(keys).size !== keys.length)
          return reject(f, 'This field has duplicate positions within a series. Reaggregate the original observations first, or use Overlay layout.');
      }
      if ((packing?.channel === channel || jitter?.channel === channel && jitter.maxOffset?.band !== undefined) && !categorical(f.type))
        return reject(f, 'This axis defines categorical slots for packing or band jitter. Choose a category field.');
      if (mark === 'line' && current?.aggregate && f.type !== 'quantitative')
        return reject(f, 'This axis summarizes numeric measurements. Choose a numeric field, or change the chart mapping.');
      if (mark === 'arc' && channel === 'theta' && f.type === 'temporal')
        return reject(f, 'Sectors require categories or numeric weights, not a temporal position.');
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
      if (mark === 'line' && channel === 'x' && encoding.y?.aggregate && categorical(f.type)) {
        const seriesFields = encoding.group?.fields ?? (encoding.group?.field ? [encoding.group.field]
          : categorical(encoding.color?.fieldType) ? [encoding.color.field] : []);
        const positions = new Map();
        for (const row of rows) {
          const key = JSON.stringify(seriesFields.map(field => row[field]));
          if (!positions.has(key)) positions.set(key, new Set());
          positions.get(key).add(row[f.name]);
        }
        if ([...positions.values()].some(values => values.size < 2)) return false;
      }
      if (channel === 'radius') return f.type === 'quantitative' && (mark !== 'arc' || rows.every(r => Number.isFinite(r[f.name]) && r[f.name] >= 0));
      if (measured && channel === 'theta') return categorical(f.type);
      if (supportedTypes && !supportedTypes.includes(f.type)) return false;
      if (channel.endsWith('2')) return f.type === (current?.fieldType ?? 'quantitative');
      return true;
    });
    for (const field of allowed) {
      // The Cartesian editor also changes aggregation, bins and scale. Keep
      // its current variable available so those edits do not rebind the data.
      if (field.name === current?.field && !measured && (!['x', 'y'].includes(channel) || regression)) continue;
      const args = { target, field: field.name, fieldType: field.type };
      if (current?.aggregate && field.type === 'quantitative' && !(mark === 'arc' && channel === 'theta')) args.aggregate = current.aggregate;
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
      out.push({ method, args, category: 'encoding', feature: encodingFeature(channel),
        unavailableFields: unavailable,
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
  const owner = positionOwner(program, layer), target = owner?.target ?? layer.id;
  const out = ownedChartCandidates(program, { layer, profile, owner });
  const parameter = (path, label, value, fields) => ({ path, label, value, type: 'select', choices: choices(fields) });
  const add = (method, args, parameters, feature, label) => out.push({ method, args, parameters, category: 'encoding', feature, label });
  if (owner?.config && owner.method !== 'editBoxPlot') {
    const config = owner.config, source = profileDataset(program, config.source);
    const q = source.fields.filter(f => f.usable && f.type === 'quantitative').map(f => f.name);
    const categories = source.fields.filter(f => f.usable && ['nominal', 'ordinal'].includes(f.type)).map(f => f.name);
    if (owner.method === 'editRaincloudPlot') {
      const categoryFields = [...new Set([config.category.field, ...categories])];
      for (const category of categoryFields) for (const field of q.filter(f => f !== category)) {
        add(owner.method, { target, missing: 'skip', category: { field: category, fieldType: category === config.category.field ? config.category.fieldType : 'nominal' },
          value: { field, fieldType: 'quantitative' },
          ...(config.color?.field === config.category.field ? { color: { ...config.color, field: category } } : {}) },
        [{ ...parameter('category.field', 'Category', category, categoryFields),
          ...(config.color?.field === config.category.field ? { alsoSet: ['color.field'] } : {}) },
          parameter('value.field', 'Measure', field, q)],
        'encoding.raincloudRoles', 'Edit raincloud variables');
      }
    } else if (['editViolinPlot', 'editGradientPlot'].includes(owner.method)) {
      const categoryAxis = config.orientation === 'horizontal' ? 'y' : 'x', valueAxis = categoryAxis === 'x' ? 'y' : 'x';
      const categoryFields = [...new Set([config.category, ...categories])].filter(field => field !== config.split?.field);
      const rows = program.semanticSpec.datasets.find(data => data.id === config.source)?.values ?? [];
      const categoryChoices = categoryFields.map(field => {
        const groups = new Set(rows.map(row => JSON.stringify([row[field], ...(config.split ? [row[config.split.field]] : [])]))).size;
        const disabled = groups * (config.density?.steps ?? 100) > MAX_GENERATED_ITEMS;
        return { value: field, label: field, disabled, ...(disabled ? { reason: 'Too many groups at the current density resolution.' } : {}) };
      });
      for (const { value: category } of categoryChoices.filter(choice => !choice.disabled)) for (const field of q.filter(f => f !== category)) {
        const args = { target, [categoryAxis]: { field: category, fieldType: category === config.category ? config.categoryType : 'nominal' },
          [valueAxis]: { field, fieldType: 'quantitative' } };
        add(owner.method, args,
          [{ ...parameter(`${categoryAxis}.field`, 'Category', category, categoryFields), choices: categoryChoices, distinctFrom: `${valueAxis}.field` },
            { ...parameter(`${valueAxis}.field`, 'Measure', field, q), distinctFrom: `${categoryAxis}.field` }],
          `action.${owner.method}`, 'Edit distribution variables');
      }
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
      for (const field of q.filter(f => paths.length === 1 || f !== roles.end.field)) add(owner.method, { target, missing: 'skip', [paths[0]]: { field, fieldType: 'quantitative' } },
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
