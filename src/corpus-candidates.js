import { hasChartContext } from './chart-context.js';
import { actionFeatures } from './semantics.js';
import { arcMarkCandidates } from './arc-candidates.js';

const styleKeys = new Set(['opacity', 'fill', 'stroke', 'strokeWidth', 'strokeDash', 'cornerRadius', 'radius', 'shape',
  'fontSize', 'fontFamily', 'fontWeight', 'align', 'baseline', 'dx', 'dy', 'curve', 'closed', 'padAngle',
  'innerRadius', 'outerRadius', 'width', 'whisker', 'outliers', 'box', 'median', 'outlier', 'caps', 'capSize',
  'boundaries', 'placement', 'rotation', 'length']);

// Corpus literals supply style recipes. Resource IDs and field names are never
// replayed from an unrelated chart. Each recipe is rebound to an existing owner
// and checked by ggaction before it becomes an alternative.
export function corpusCandidates(program, { layer }, evidence) {
  if (!evidence?.methods || !hasChartContext(program, layer)) return [];
  const candidates = [], mark = layer.mark?.type, config = program.markConfigs[layer.id] ?? {};
  for (const record of evidence.methods) {
    const { method } = record;
    if (!record.public || !/^edit/.test(method)) continue;
    let targets = [];
    const markMatch = method.match(/^edit(Point|Bar|Line|Area|Rect|Arc|Rule|Text|Tick)Mark$/);
    if (markMatch && markMatch[1].toLowerCase() === mark) targets = [layer.id];
    else if (method === 'editBoxPlot' && config.boxPlot) targets = [layer.id];
    else if (method === 'editErrorBar' && config.errorBar) targets = [layer.id];
    else if (method === 'editErrorBand' && config.errorBand) targets = [layer.id];
    else if (method === 'editErrorBandBoundary' && config.errorBandBoundary) targets = [layer.id];
    else if (method === 'editMarkLabelPlacement') targets = program.semanticSpec.layers
      .filter(l => l.source === layer.id && program.markConfigs[l.id]?.labelAuthoring).map(l => l.id);
    if (!targets.length) continue;
    for (const template of record.templates.slice(0, 4)) {
      if (method === 'editArcMark') {
        candidates.push(...arcMarkCandidates(program, layer, template.args));
        continue;
      }
      const patch = Object.fromEntries(Object.entries(template.args).filter(([key]) => styleKeys.has(key)));
      if (layer.encoding?.color || layer.encoding?.stroke) {
        if (mark === 'line') delete patch.stroke;
        else delete patch.fill;
      }
      if (mark !== 'line' && patch.strokeWidth > 0 && patch.stroke === undefined && !layer.encoding?.stroke &&
          !(config.stroke ?? config.barAppearance?.stroke)) patch.stroke = '#4c78a8';
      if (!Object.keys(patch).length) continue;
      for (const target of targets) {
        const args = { target, ...structuredClone(patch) };
        candidates.push({ method, args, category: 'style', feature: actionFeatures(method, args)[0] ?? `action.${method}`,
          parameterMode: 'presets', label: method.replace(/^edit/, 'Adjust ').replace(/([a-z])([A-Z])/g, '$1 $2') });
      }
    }
  }
  return candidates;
}
