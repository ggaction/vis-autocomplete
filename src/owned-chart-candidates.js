import { profileDataset } from './profile.js';
import { paletteChoices } from './palette-options.js';

const select = (path, label, value, values) => ({ path, label, type: 'select', value,
  choices: values.map(value => typeof value === 'object' ? value : { value, label: String(value) }) });
const number = (path, label, value, min, max, step = 1) => ({ path, label, type: 'number', value, min, max, step });
const fieldName = value => typeof value === 'string' ? value : value?.field;
const aggregate = ['mean', 'median', 'sum', 'min', 'max'];
const kernels = ['gaussian', 'epanechnikov', 'uniform', 'triangular'];
const round = value => Number(value.toPrecision(3));

// Native owner editors expose statistical/model decisions separately from role
// selection. Each returned card still invokes exactly one public action.
export function ownedChartCandidates(program, { layer, profile, owner }) {
  const out = [], target = owner?.target ?? layer.id;
  const source = owner?.source ? profileDataset(program, owner.source) : profile;
  const fields = source.fields.filter(f => f.usable), q = fields.filter(f => f.type === 'quantitative');
  const groups = fields.filter(f => ['nominal', 'ordinal'].includes(f.type) && f.distinct > 1);
  const add = (method, category, args, parameters, feature, label) => out.push({ method, category, args, parameters, feature, label });
  if (owner?.radar && owner.method && owner.transform?.type === 'fold') {
    const dimensions = [...owner.transform.fields].reverse();
    add('editRadarPlot', 'encoding', { target, wide: { fields: dimensions } },
      [{ path: 'wide.fields', label: 'Dimensions and order', type: 'multiselect', minimum: 2,
        value: dimensions, choices: q.map(field => ({ value: field.name, label: field.name })) }],
      'encoding.radarDimensions', 'Edit radar dimensions');
  }
  if (owner?.method === 'editBoxPlot') {
    const box = owner.config;
    // Statistical decisions and appearance remain separate cards, but corpus
    // recipes use these same explicit controls instead of opaque object labels.
    if (!box.summary) add('editBoxPlot', 'transform', { target, whisker: { type: box.whisker.type, ...(box.whisker.type === 'tukey' ? { factor: box.whisker.factor } : {}) } }, [
      select('whisker.type', 'Whiskers', box.whisker.type, [{ value: 'tukey', label: 'Tukey (IQR)' }, { value: 'minmax', label: 'Minimum / maximum' }]),
      { ...number('whisker.factor', 'IQR factor', box.whisker.factor ?? 1.5, .1, 5, .1), whenPath: { path: 'whisker.type', values: ['tukey'] } },
      { ...select('outliers', 'Outliers', box.outliers, [{ value: true, label: 'Show' }, { value: false, label: 'Hide' }]), whenPath: { path: 'whisker.type', values: ['tukey'] } },
      select('whisker.caps', 'Whisker caps', box.whisker.caps ?? true, [{ value: true, label: 'Show' }, { value: false, label: 'Hide' }]),
    ], 'action.editBoxPlot', 'Adjust box statistics');
    const pixelWidth = typeof box.width === 'object';
    add('editBoxPlot', 'style', { target, box: { opacity: box.box.opacity } }, [
      number(pixelWidth ? 'width.pixels' : 'width.band', pixelWidth ? 'Box width (px)' : 'Box width (band)', pixelWidth ? box.width.pixels : box.width, pixelWidth ? 1 : .05, pixelWidth ? 60 : .95, pixelWidth ? 1 : .05),
      number('box.opacity', 'Box opacity', box.box.opacity, .05, 1, .05),
      number('box.strokeWidth', 'Box outline width', box.box.strokeWidth, 0, 6, .25),
      number('median.strokeWidth', 'Median line width', box.median.strokeWidth, 0, 6, .25),
    ], 'action.editBoxPlot', 'Edit box appearance');
  }
  if (owner?.method === 'editHorizon') {
    const t = owner.transform;
    const values = program.semanticSpec.datasets.find(d => d.id === owner.source)?.values.map(r => r[t.y.field]).filter(Number.isFinite) ?? [0, 1];
    const min = Math.min(...values), max = Math.max(...values), span = Math.max(1, max - min);
    const amplitude = Math.max(Math.abs(min - t.baseline), Math.abs(max - t.baseline), Number.EPSILON);
    const bands = t.bands === 3 ? 4 : 3;
    add('editHorizon', 'transform', { target, bands }, [number('bands', 'Bands', bands, 1, 6),
      number('baseline', 'Baseline', t.baseline, Math.min(min, t.baseline), Math.max(max, t.baseline), round(span / 100)),
      select('resolve', 'Band extent', t.resolve, [{value:'shared',label:'Shared across series'},{value:'independent',label:'Independent by series'}]),
      select('extent', 'Amplitude extent', t.extent, [{value:'auto',label:'Automatic'},
        {value:amplitude,label:'Full data amplitude'}, {value:amplitude * 2,label:'Twice data amplitude'}])],
    'transform.horizon', 'Adjust horizon bands');
    const positive = (t.palette.positive.name ?? t.palette.positive) === 'blues' ? 'greens' : 'blues';
    add('editHorizon', 'encoding', { target, palette: { positive } }, [
      select('palette.positive', 'Positive palette', positive, paletteChoices('quantitative')),
      select('palette.negative', 'Negative palette', t.palette.negative.name ?? t.palette.negative, paletteChoices('quantitative'))],
    'encoding.horizonPalette', 'Adjust horizon colors');
  }
  if (['editViolinPlot', 'editRaincloudPlot', 'editDensity'].includes(owner?.method)) {
    const config = owner.config ?? {}, density = config.density || owner.transform;
    const dataset = program.semanticSpec.datasets.find(d => d.id === layer.data), transform = dataset?.transform?.find(t => t.type === 'density');
    const bandwidth = transform?.resolved?.bandwidth ?? 1, prefix = owner.method === 'editDensity' ? '' : 'density.';
    const args = owner.method === 'editDensity' ? { target, bandwidth: round(bandwidth * 1.25) } : { target, density: { bandwidth: round(bandwidth * 1.25) } };
    const parameters = [number(`${prefix}bandwidth`, 'Bandwidth', round(bandwidth * 1.25), round(Math.max(.000001, bandwidth / 20)), round(bandwidth * 5), round(bandwidth / 20)),
      select(`${prefix}kernel`, 'Kernel', density.kernel ?? 'gaussian', kernels),
      select(`${prefix}normalization`, 'Density', density.normalization ?? 'unit', [{value:'unit',label:'Normalized density'},{value:'count',label:'Count weighted density'}])];
    if (owner.method === 'editRaincloudPlot') parameters.push(select('side', 'Density side', config.side, ['before', 'after']));
    else if (owner.method === 'editViolinPlot' && !config.split) parameters.push(select('density.side', 'Density side', density.side ?? 'both', config.orientation === 'horizontal' ? ['both','top','bottom'] : ['both','left','right']));
    add(owner.method, 'transform', args, parameters, `transform.${owner.method}.density`, 'Adjust density');
  }
  const regression = program.markConfigs[layer.id]?.regression;
  if (regression) {
    const parameters = regression.parameters ?? {}, method = parameters.method === 'loess' ? 'linear' : 'loess';
    add('editRegression', 'transform', { target: layer.id, method }, [
      select('method', 'Model', method, ['linear', 'polynomial', 'loess', 'exp']),
      select('groupBy', 'Fit', regression.groupBy || false, [{value:false,label:'All observations'}, ...groups.map(f=>({value:f.name,label:`By ${f.name}`}))]),
      {...number('degree','Degree',parameters.degree ?? 2,1,6),whenPath:{path:'method',values:['polynomial']}},
      {...number('span','Span',parameters.span ?? .5,.1,1,.05),whenPath:{path:'method',values:['loess']}},
      {...number('robustIterations','Robust iterations',parameters.robustIterations ?? 0,0,5),whenPath:{path:'method',values:['loess']}},
      {...select('interval','Interval',parameters.interval ?? false,[{value:false,label:'None'},{value:'mean',label:'Mean confidence'},{value:'prediction',label:'Prediction'}]),whenPath:{path:'method',values:['linear','polynomial']}}
    ], 'transform.regression', 'Adjust regression');
  }
  if (owner?.method === 'editEndpointPlot') {
    const config = owner.config, args = { target, summary: config.summary === 'mean' ? 'median' : 'mean' };
    const parameters = [select('summary', 'Aggregation', args.summary, aggregate)];
    if (config.kind === 'lollipop' || config.baseline !== undefined) {
      const field = fieldName(config.roles.value), values = program.semanticSpec.datasets.find(d=>d.id===owner.source)?.values.map(r=>r[field]).filter(Number.isFinite) ?? [0,1];
      const low = Math.min(0,...values), high = Math.max(1,...values);
      parameters.push(number('baseline', 'Baseline', config.baseline ?? 0, low, high, round((high-low)/100)));
    }
    add('editEndpointPlot', 'transform', args, parameters, 'transform.endpointSummary', 'Adjust endpoint summary');
  }
  if (owner?.method === 'editECDFPlot') {
    const config = owner.config.options, rows = program.semanticSpec.datasets.find(d=>d.id===owner.source)?.values ?? [];
    const weights = q.filter(f=>rows.every(r=>Number.isFinite(r[f.name])&&r[f.name]>=0)&&rows.some(r=>r[f.name]>0));
    for (const field of q) add('editECDFPlot', 'encoding', { target, field:field.name }, [
      select('field','Variable',field.name,q.map(f=>f.name)),
      select('groupBy','Group by',config.groupBy?.[0] ?? false,[{value:false,label:'None'},...groups.map(f=>({value:f.name,label:f.name}))]),
      {...select('weight','Weight',config.weight ?? false,[{value:false,label:'Equal observations'},...weights.map(f=>({value:f.name,label:f.name}))]),distinctFrom:'field'}
    ],'encoding.ecdfRoles','Edit ECDF variables');
  }
  if (layer.encoding?.parallel) {
    for (const dimension of layer.encoding.parallel.dimensions) {
      const scale = program.semanticSpec.scales.find(s=>s.id===dimension.scale), field = fields.find(f=>f.name===dimension.field);
      const rows = program.semanticSpec.datasets.find(d=>d.id===layer.data)?.values ?? [];
      const values = rows.map(r=>r[dimension.field]).filter(Number.isFinite);
      const nonPositive = rows.some(r=>!(r[dimension.field]>0));
      add('editParallelScale','encoding',{target:layer.id,dimension:dimension.field,reverse:!scale.reverse},[
        select('dimension','Dimension',dimension.field,layer.encoding.parallel.dimensions.map(d=>d.field)),
        select('type','Scale',scale.type, (field?.type==='quantitative'?['linear','log','sqrt','symlog']:['point','band']).map(type=>({value:type,label:type,disabled:type==='log'&&nonPositive,reason:type==='log'&&nonPositive?'Log requires positive values.':undefined}))),
        select('reverse','Direction',!scale.reverse,[{value:false,label:'Normal'},{value:true,label:'Reverse'}]),
        select('domain','Domain',scale.domain ?? 'auto',[{value:'auto',label:'Automatic'},...(values.length?[{value:[Math.min(...values),Math.max(...values)],label:'Full data extent'}]:[])])
      ],'encoding.parallelScale','Adjust parallel scale');
    }
  }
  return out;
}
