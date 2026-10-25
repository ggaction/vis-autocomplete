import { getPlotComposition } from 'ggaction/inspection';
import { overlayCandidates } from './overlay-candidates.js';
import { positionCandidates, ownedPositionCandidates } from './position-candidates.js';
// Every entry yields ONE public ChartProgram method and ONE options object.
// More fields produce alternatives inside the same recommendation, not more ranks.
import { preferVisualFields } from './profile.js';
import { PUBLIC_ACTION_METHODS } from './action-capabilities.js';
import { extendedCandidates } from './extended-catalog.js';
import { appearanceCandidates } from './appearance-candidates.js';
import { facetCandidates } from './facet-candidates.js';
import { corpusCandidates } from './corpus-candidates.js';
import { DEFAULT_TITLE_FONT_SIZE } from './parameter-defaults.js';
import { recommendationCategory } from './recommendation-groups.js';
import { regressionContext as inspectRegressionContext } from './regression-context.js';
import { focusMarkEditors } from './mark-editor-policy.js';
export const ACTION_METHODS = PUBLIC_ACTION_METHODS;

export function generateCandidates(program, { layer, profile, actionEvidence, regressionContext }) {
  return focusMarkEditors(candidateRecipes(program, { layer, profile, actionEvidence, regressionContext })).map(candidate => ({
    ...candidate, category: recommendationCategory(candidate),
  }));
}

function candidateRecipes(program, { layer, profile, actionEvidence, regressionContext }) {
  const candidates = [...overlayCandidates(program, layer), ...ownedPositionCandidates(program, { layer, profile }), ...positionCandidates(program, { layer, profile }), ...facetCandidates(program, { layer, profile }), ...appearanceCandidates(program, { layer, profile }), ...extendedCandidates(program, { layer, profile })];
  // Corpus defaults already feed the parameter editors. A second opaque preset
  // card must not bypass the same mark's coordinate/grain-aware editor.
  const editors = new Set(candidates.filter(candidate => /^edit.*Mark$/.test(candidate.method))
    .map(candidate => `${candidate.method}:${candidate.args.target}`));
  candidates.push(...corpusCandidates(program, { layer, profile }, actionEvidence)
    .filter(candidate => !editors.has(`${candidate.method}:${candidate.args.target}`)));
  const add = (method, feature, category, label, args, inspectionTarget) => {
    candidates.push({ method, feature, category, label, args, inspectionTarget });
  };
  const fields = preferVisualFields(profile.fields.filter(f => f.usable));
  if (!profile.rowCount || !fields.length) return candidates;
  if (!layer) {
    const dataIds = new Set(program.semanticSpec.datasets.map(d => d.id));
    const newId = label => {
      let id = label;
      for (let n = 2; dataIds.has(id); n++) id = `${label}${n}`;
      return id;
    };
    for (const field of fields.filter(f => f.numericString)) {
      let as = `${field.name}_number`;
      for (let n = 2; profile.fields.some(f => f.name === as); n++) as = `${field.name}_number${n}`;
      const args = { id: newId(`${profile.id}_numeric`), source: profile.id, as,
        expression: { op: 'toNumber', operand: { field: field.name } } };
      add('createComputedData', 'action.createComputedData', 'transform',
        `${field.name} 숫자 문자열을 수치 열로 변환`, args, { kind: 'data', id: profile.id });
      candidates.at(-1).groupTarget = profile.id;
    }
    if (!fields.some(f => f.type === 'quantitative')) {
      for (const field of fields.filter(f => ['nominal', 'ordinal'].includes(f.type) && f.distinct <= 50)) {
        const args = { id: newId(`${profile.id}_counts`), source: profile.id, groupBy: [field.name],
          aggregates: [{ op: 'count', as: field.name === 'count' ? 'row_count' : 'count' }] };
        add('createSummaryData', 'transform.aggregate', 'transform', `${field.name}별 행 수 집계`,
          args, { kind: 'data', id: profile.id });
        candidates.at(-1).groupTarget = profile.id;
      }
    }
    const availableIds = new Set(program.semanticSpec.layers.map(l => l.id));
    for (const [method, mark] of [['createPointMark', 'point'], ['createLineMark', 'line'],
      ['createBarMark', 'bar'], ['createAreaMark', 'area']]) {
      if (mark === 'bar' && !fields.some(f => ['nominal', 'ordinal'].includes(f.type))) continue;
      if (!fields.some(f => f.type === 'quantitative')) continue;
      let id = `${mark}s`;
      for (let n = 2; availableIds.has(id); n++) id = `${mark}s${n}`;
      add(method, `mark.${mark}`, 'mark', `${mark} 마크 만들기`, { id, data: profile.id,
        ...(['point', 'bar'].includes(mark) ? { missing: 'skip' } : {}) });
    }
    return candidates;
  }
  const target = layer.id;
  const inspectionTarget = { kind: 'mark', id: target };
  const mark = layer.mark?.type;
  const encoding = layer.encoding ?? {};
  const supported = ['point', 'line', 'bar', 'area'].includes(mark);
  const addCommon = () => {
    const coordinate = program.semanticSpec.coordinates.find(c => c.id === layer.coordinate);
    const axes = {}, axisContexts = {};
    for (const [id, axis] of Object.entries(program.semanticSpec.guides.axis ?? {})) {
      const channel = axis.channel ?? id;
      if (!['x', 'y', 'theta', 'radius'].includes(channel) ||
          axis.coordinate && axis.coordinate !== layer.coordinate ||
          axis.scale !== encoding[channel]?.scale) continue;
      const config = program.guideConfigs.axis?.[id];
      if (!config?.labels) continue;
      const fontSize = config.labels.fontSize === 11 ? 12 : 11;
      const entry = { ...(['x', 'y'].includes(channel) ? { target: id } : {}),
        labels: { fontSize } };
      // Named owners of the same channel stay in one real aggregate call.
      if (axes[channel]) axes[channel] = [...(Array.isArray(axes[channel]) ? axes[channel] : [axes[channel]]), entry];
      else axes[channel] = entry;
      axisContexts[channel] = { visibility: config.visibility ?? {}, fieldType: encoding[channel]?.fieldType, field: encoding[channel]?.field,
        position: axis.position ?? config.line?.position ?? config.labels?.position ?? config.ticks?.position ?? config.title?.position, ticks: config.ticks?.count ?? 5, offset: config.labels.offset ?? 8, lineWidth: config.line?.lineWidth ?? 1 };
    }
    if (coordinate?.type === 'parallel') {
      const dimensions = encoding.parallel?.dimensions ?? [];
      axes.parallel = dimensions.map(dimension => ({ target, field: dimension.field,
        labels: { fontSize: 11 } }));
      if (!axes.parallel.length) delete axes.parallel;
      else {
        const retained = program.guideConfigs.axis?.parallel?.axes?.dimensions ?? [];
        axisContexts.parallel = { visibility: Object.fromEntries(['all','line','ticks','labels','title'].map(part =>
          [part, retained.every(dimension => dimension.visibility?.[part] !== false)])) };
      }
    }
    if (Object.keys(axes).length) {
      add('editAxes', 'action.editAxes', 'guide', '기존 축 표시 수정', axes);
      candidates.at(-1).guideContext = { axes: axisContexts };
    }
    for (const [key, legend] of Object.entries(program.semanticSpec.guides.legend ?? {})) {
      const scales = [legend.scale, ...(legend.scales ?? [])].filter(Boolean);
      const channels = ['color', 'size', 'shape', 'stroke', 'strokeWidth', 'strokeDash', 'opacity']
        .filter(channel => encoding[channel]?.scale && scales.includes(encoding[channel].scale));
      if (!channels.length) continue;
      const config = program.guideConfigs.legend?.[key] ?? Object.values(program.guideConfigs.legend ?? {})
        .find(value => value.target === target && (scales.includes(value.scale) || value.channels?.some(c => channels.includes(c))));
      const channel = channels[0];
      add('editLegend', 'action.editLegend', 'guide', '기존 범례의 배치와 글자 수정',
        { target, channel, position: config?.position === 'top-right' ? 'right' : 'top-right',
          labels: { fontSize: config?.labels?.fontSize ?? 12 } }, inspectionTarget);
      candidates.at(-1).guideContext = { visibility: config?.visibility ?? {}, channel, title: legend.title ?? channel,
        categorical: ['nominal', 'ordinal'].includes(encoding[channel]?.fieldType),
        sharedFacetLegend: Boolean(program.compositionSpec?.facet && program.compositionSpec.facet.guides.legend !== false),
        itemCount: program.resolvedScales[encoding[channel]?.scale]?.domain?.length ?? 1,
        overflow: config?.overflow ?? false };
    }
    const directions = Object.entries(program.semanticSpec.guides.grid ?? {}).filter(([, grid]) =>
      grid && (!grid.coordinate || grid.coordinate === layer.coordinate));
    for (const [direction] of directions) {
      add('editGrid', 'action.editGrid', 'guide', '기존 그리드 표시 수정',
        { [direction]: { color: '#cbd5e1', lineWidth: 1.5 } });
      candidates.at(-1).guideContext = { visible: program.guideConfigs.grid?.[direction]?.visible !== false, direction, directions: directions.map(([key]) => key) };
    }
    // Titles describe the public measurement roles, never materialized aliases
    // such as a violin's density sampling value or an endpoint's summary field.
    const composition = getPlotComposition(program, { target: layer.derivedBindings?.overlay?.source ?? target });
    const role = channel => {
      if (encoding[channel]?.title) return encoding[channel].title;
      const semantic = composition.channels[channel], operations = semantic?.measurement?.operations ?? [];
      if (operations.includes('density')) return 'Density';
      if (operations.includes('probability')) return 'Cumulative probability';
      if (operations.includes('cumulative-count')) return 'Cumulative count';
      if (operations.includes('count')) return 'Count';
      return semantic?.field ?? encoding[channel]?.field;
    };
    const x = role('x') ?? role('theta');
    const y = role('y') ?? role('radius');
    if (program.semanticSpec.title.text) {
      add('editTitle', 'action.editTitle', 'guide', '기존 차트 제목 수정',
        { text: program.semanticSpec.title.text, position: program.titleConfig?.position ?? 'top',
          ...(program.semanticSpec.title.subtitle !== undefined ? { subtitle: program.semanticSpec.title.subtitle } : {}),
          subtitleStyle: { ...program.titleConfig?.subtitleStyle },
          titleStyle: { ...program.titleConfig?.titleStyle,
            fontSize: program.titleConfig?.titleStyle?.fontSize ?? DEFAULT_TITLE_FONT_SIZE } });
    } else add('createTitle', 'guide.title', 'guide', '현재 변수로 차트 제목 추가',
      { text: x && y ? `${y} ${['Density', 'Cumulative probability', 'Cumulative count'].includes(y) ? 'of' : 'by'} ${x}` : profile.id,
        titleStyle: { fontSize: DEFAULT_TITLE_FONT_SIZE } });
  };
  if (!supported || (layer.coordinate && program.semanticSpec.coordinates.find(c => c.id === layer.coordinate)?.type !== 'cartesian')) {
    addCommon();
    return candidates;
  }

  // First establish the positional context; do not suggest statistics on a blank mark.
  if (!encoding.x || !encoding.y) return candidates;
  if (mark === 'point' && encoding.x.fieldType === 'quantitative' && encoding.y.fieldType === 'quantitative' && !program.markConfigs[target]?.regression) {
    const context = regressionContext ?? inspectRegressionContext(program, layer, profile);
    const groupBy = context?.defaultGroup || false;
    add('createRegression', 'transform.regression', 'transform', '선형 회귀선과 95% 신뢰구간 추가',
      { target, groupBy, method: 'linear', ...(context?.groups[groupBy || '']?.minRows < 3 ? { interval: false } : {}) }, inspectionTarget);
  }
  addCommon();
  return candidates;
}
