// Every entry yields ONE public ChartProgram method and ONE options object.
// More fields produce alternatives inside the same recommendation, not more ranks.
import { preferVisualFields } from './profile.js';
import { PUBLIC_ACTION_METHODS } from './action-capabilities.js';
import { extendedCandidates } from './extended-catalog.js';
import { appearanceCandidates } from './appearance-candidates.js';
import { facetCandidates } from './facet-candidates.js';
import { corpusCandidates } from './corpus-candidates.js';
export const ACTION_METHODS = PUBLIC_ACTION_METHODS;

export function generateCandidates(program, { layer, profile, actionEvidence }) {
  const candidates = [...facetCandidates(program, { layer, profile }), ...appearanceCandidates(program, { layer, profile }), ...extendedCandidates(program, { layer, profile }), ...corpusCandidates(program, { layer, profile }, actionEvidence)];
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
        labels: { fontFamily: 'Arial', fontSize } };
      // Named owners of the same channel stay in one real aggregate call.
      if (axes[channel]) axes[channel] = [...(Array.isArray(axes[channel]) ? axes[channel] : [axes[channel]]), entry];
      else axes[channel] = entry;
      axisContexts[channel] = { fieldType: encoding[channel]?.fieldType, field: encoding[channel]?.field,
        ticks: config.ticks?.count ?? 5, offset: config.labels.offset ?? 8, lineWidth: config.line?.lineWidth ?? 1 };
    }
    if (coordinate?.type === 'parallel') {
      const dimensions = encoding.parallel?.dimensions ?? [];
      axes.parallel = dimensions.map(dimension => ({ target, field: dimension.field,
        labels: { fontFamily: 'Arial', fontSize: 11 } }));
      if (!axes.parallel.length) delete axes.parallel;
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
          labels: { fontFamily: 'Arial', fontSize: config?.labels?.fontSize ?? 12 } }, inspectionTarget);
      candidates.at(-1).guideContext = { channel, title: legend.title ?? channel };
    }
    const directions = Object.entries(program.semanticSpec.guides.grid ?? {}).filter(([, grid]) =>
      grid && (!grid.coordinate || grid.coordinate === layer.coordinate));
    for (const [direction] of directions) {
      add('editGrid', 'action.editGrid', 'guide', '기존 그리드 표시 수정',
        { [direction]: { color: '#cbd5e1', lineWidth: 1.5 } });
      candidates.at(-1).guideContext = { direction, directions: directions.map(([key]) => key) };
    }
    const x = encoding.x?.title ?? encoding.x?.field ?? encoding.theta?.field;
    const y = encoding.y?.title ?? encoding.y?.field ?? encoding.r?.field ?? encoding.radius?.field;
    if (program.semanticSpec.title.text) {
      add('editTitle', 'action.editTitle', 'guide', '기존 차트 제목 수정',
        { text: program.semanticSpec.title.text, position: program.titleConfig?.position ?? 'top',
          titleStyle: { fontFamily: 'Arial', fontSize: 18 } });
    } else add('createTitle', 'guide.title', 'guide', '현재 변수로 차트 제목 추가',
      { text: x && y ? `${y} by ${x}` : profile.id });
  };
  if (!supported || (layer.coordinate && program.semanticSpec.coordinates.find(c => c.id === layer.coordinate)?.type !== 'cartesian')) {
    addCommon();
    return candidates;
  }

  for (const channel of program.markConfigs[target]?.boxPlot ? [] : ['x', 'y']) {
    let eligible = fields;
    if (mark === 'point') { /* Point positions accept nominal, ordinal and temporal fields too. */ }
    else if (channel === 'y') eligible = eligible.filter(f => f.type === 'quantitative');
    else if (mark === 'bar') eligible = eligible.filter(f => ['nominal', 'ordinal'].includes(f.type));
    else eligible = eligible.filter(f => ['temporal', 'quantitative'].includes(f.type));
    const other = channel === 'x' ? 'y' : 'x';
    eligible = eligible.filter(f => f.name !== encoding[other]?.field);
    for (const field of eligible) {
      if (field.name === encoding[channel]?.field) continue;
      const args = { target, field: field.name, fieldType: field.type };
      const current = encoding[channel];
      const sameType = current?.fieldType === field.type;
      const scaleType = field.type === 'temporal' ? 'time' : ['nominal', 'ordinal'].includes(field.type) ? 'band' : 'linear';
      const scale = program.semanticSpec.scales.find(s => s.id === current?.scale);
      if (!sameType || scale && scale.type !== scaleType && ['nominal', 'ordinal', 'temporal'].includes(field.type)) {
        const stem = `${target}-${channel}-${field.type}`;
        let id = stem;
        for (let i = 2; program.semanticSpec.scales.some(s => s.id === id); i++) id = `${stem}-${i}`;
        args.scale = { id, type: scaleType };
      }
      if (channel === 'y' && mark === 'bar' && ['nominal', 'ordinal'].includes(encoding.x?.fieldType)) args.aggregate = encoding.y?.aggregate ?? 'mean';
      if (current?.bin && field.type === 'quantitative') args.bin = { ...current.bin };
      if (mark === 'line' && channel === 'x' && field.type === 'quantitative' && encoding.y?.aggregate && !args.bin) args.bin = { maxBins: 10 };
      if (current?.aggregate && !args.aggregate) args.aggregate = current.aggregate;
      add(channel === 'x' ? 'encodeX' : 'encodeY', `encoding.${channel}`, 'encoding',
        `${channel}축에 ${field.name}${args.aggregate ? ' 평균' : ''} 표현`, args, inspectionTarget);
    }
  }

  // First establish the positional context; do not suggest statistics on a blank mark.
  if (!encoding.x || !encoding.y) return candidates;
  if (mark === 'point' && encoding.x.fieldType === 'quantitative' && encoding.y.fieldType === 'quantitative' && !program.markConfigs[target]?.regression) {
    add('createRegression', 'transform.regression', 'transform', '선형 회귀선과 95% 신뢰구간 추가',
      { target, groupBy: false, method: 'linear' }, inspectionTarget);
  }
  addCommon();
  return candidates;
}
