import { paletteChoices } from './palette-options.js';
import { defaultValues } from './plot-catalog.js';
import { resolveHistogramBins } from '../vendor/ggaction/src/grammar/histogram.js';

const categorical = type => ['nominal', 'ordinal'].includes(type);
const fieldName = value => typeof value === 'string' ? value : value?.field;
const at = (object, path) => path.split('.').reduce((node, key) => node?.[key], object);
function write(object, path, value) {
  const keys = path.split('.'), last = keys.pop();
  let node = object;
  for (const key of keys) {
    if (typeof node[key] === 'string') node[key] = { field: node[key] };
    node = node[key] ??= {};
  }
  node[last] = value;
}

// Describe the public creation function's own scale options. These are native
// plot arguments, never hidden editScale calls following the selected action.
function positions(method, args, fields) {
  const result = [];
  const add = (axis, paths, encoding, extra = {}) => {
    const field = fieldName(encoding);
    const type = encoding?.fieldType ?? fields.get(field)?.type ?? 'quantitative';
    if (categorical(type)) return; // Categorical spacing belongs to the later editor.
    result.push({ axis, paths, field, type, encoding, ...extra });
  };
  for (const axis of ['x', 'y']) if (args[axis] !== undefined) {
    if (method === 'createHorizonPlot' && axis === 'y') continue; // Normalized band height, fixed linear.
    add(axis, [`${axis}.scale`], args[axis], {
      baseline: method === 'createAreaPlot' && axis === 'y' ||
        method === 'createBarPlot' && (Boolean(args[axis]?.aggregate) || axis === 'y' && Boolean(args.x?.bin)),
      bin: args[axis]?.bin ?? (method === 'createHeatmap' && args.bin ? { maxBins: args.bin.bins } : undefined),
    });
  }
  if (['createDotPlot', 'createLollipopPlot', 'createDumbbellPlot', 'createRaincloudPlot'].includes(method)) {
    const axis = args.orientation === 'horizontal' ? 'x' : 'y';
    add(axis, method === 'createDumbbellPlot' ? ['start.scale', 'end.scale'] : ['value.scale'], args.value ?? args.start,
      { baseline: method === 'createLollipopPlot' && (args.baseline ?? 0) <= 0,
        extraFields: method === 'createDumbbellPlot' ? [fieldName(args.end)] : [] });
  }
  if (method === 'createHistogram') {
    add('x', ['xScale'], args.field, { bin: { maxBins: args.maxBins } });
    add('y', ['yScale'], null, { baseline: true });
  }
  if (method === 'createDensityPlot') {
    add('x', ['valueScale'], args.field, { estimatedExtent: true });
    add('y', ['densityScale'], null, { baseline: true });
  }
  return result;
}

export function withInitialScales(definition, profile, rows) {
  const fields = new Map(profile.fields.map(field => [field.name, field]));
  const defaults = defaultValues(definition), initial = definition.build(defaults);
  const bindings = positions(definition.method, initial, fields);
  const implicitColor = ['createPiePlot', 'createRosePlot', 'createRadialBarPlot'].includes(definition.method)
    ? { field: fieldName(initial.category), fieldType: 'nominal' } : null;
  const color = initial.color ?? implicitColor;
  const colorType = definition.colorBinField ? 'quantitative'
    : color?.fieldType ?? fields.get(fieldName(color))?.type ?? 'quantitative';
  const numericFields = new Map();
  const numbers = field => {
    if (!numericFields.has(field)) numericFields.set(field, rows.map(row => row[field]).filter(Number.isFinite));
    return numericFields.get(field);
  };
  let cachedKey, cachedControls;
  const controlsFor = values => {
    const args = definition.build({ ...defaults, ...values });
    const currentBindings = positions(definition.method, args, fields);
    const key = JSON.stringify(currentBindings);
    if (key === cachedKey) return cachedControls;
    cachedKey = key;
    return cachedControls = bindings.map(binding => {
      const current = currentBindings.find(item => item.axis === binding.axis) ?? binding;
      const values = [current.field, ...(current.extraFields ?? [])].flatMap(numbers);
      let positive = values.length > 0 && values.every(value => value > 0);
      if (positive && current.bin) {
        try { positive = resolveHistogramBins({ values, bin: current.bin }).boundaries.every(value => value > 0); }
        catch { positive = false; }
      }
      // A density kernel can extend below the observed minimum.
      const logReason = current.baseline ? 'This chart needs a zero baseline. Use symlog to retain zero.'
        : current.estimatedExtent ? 'The estimated density can extend through zero.'
          : !positive ? 'Log requires strictly positive values, including bin boundaries.' : undefined;
      const choices = current.type === 'temporal'
        ? [{ value: 'time', label: 'Time' }]
        : [{ value: 'linear', label: 'Linear' }, { value: 'log', label: 'Log', disabled: Boolean(logReason), reason: logReason },
          { value: 'sqrt', label: 'Sqrt' }, { value: 'symlog', label: 'Symlog' }];
      return { key: `${binding.axis}Scale`, label: `${binding.axis.toUpperCase()} scale`, type: 'select', section: 'scales',
        defaultPolicy: 'context', value: at(initial, binding.paths[0])?.type ?? (binding.type === 'temporal' ? 'time' : 'linear'), choices };
    });
  };
  const scaleControls = [...controlsFor(defaults)];
  if (color && color !== false) scaleControls.push({ key: 'palette', label: 'Color palette', type: 'select', section: 'scales',
    value: color.scale?.palette ?? color.palette ?? (categorical(colorType) ? 'tableau10' : 'blues'),
    choices: paletteChoices(colorType) });
  if (!scaleControls.length) return definition;
  return { ...definition, controls: [...definition.controls, ...scaleControls],
    resolveScaleControls: values => controlsFor(values),
    build(values = {}) {
      const args = definition.build(values);
      for (const binding of bindings) {
        const type = values[`${binding.axis}Scale`] ?? scaleControls.find(c => c.key === `${binding.axis}Scale`).value;
        for (const path of binding.paths) {
          const scale = { ...at(args, path), type };
          if (['log', 'time'].includes(type)) delete scale.zero;
          write(args, path, scale);
        }
      }
      if (color && color !== false) {
        args.color ??= { ...implicitColor };
        write(args, 'color.scale.palette', values.palette ?? scaleControls.find(c => c.key === 'palette').value);
        delete args.color.palette;
      }
      return args;
    } };
}
