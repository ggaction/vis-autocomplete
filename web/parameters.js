import { scopeRecommendationCall } from '../src/composition-context.js';
import { paletteChoices } from '../src/palette-options.js';
// At most four visible parameter groups. Native ggaction options only.
import { binnedPositionExpression } from '../src/plot-aggregation.js';
import { applyParameterDefaults } from '../src/control-defaults.js';
import { defaultFacetColumns } from '../src/facet-layout.js';
import { DEFAULT_TITLE_FONT_SIZE, DEFAULT_SUBTITLE_FONT_SIZE } from '../src/parameter-defaults.js';
const select = (key, label, choices, value) => ({ key, label, type: 'select',
  choices: choices.map(v => typeof v === 'object' ? v : { value: v, label: v }), value });
const numeric = (key, label, value, min, max, step = 1) => ({ key, label, type: 'number', value, min, max, step });
const text = (key, label, value) => ({ key, label, type: 'text', value });
const fieldOf = args => args.field ?? args.expression?.operand?.field ?? args.groupBy?.[0];

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const conditional = (control, keyForPath) => control.whenPath ? {
  ...control, when: values => control.whenPath.values.some(value => sameValue(value, values[keyForPath(control.whenPath.path)])),
} : control;

// Initial chart choices use the same dependent-control rules as follow-up
// actions, without serializing functions through corpus/worker data.
export function initialParameters(spec) {
  if (spec.resolveDefinition) {
    const editors = new Map();
    const editorFor = values => {
      const key = JSON.stringify(['x', 'y', 'color'].map(role => values[`mapping_${role}`] ?? spec.values[`mapping_${role}`] ?? ''));
      if (!editors.has(key)) editors.set(key, initialParameters({ ...spec.resolveDefinition(values), fieldSelection: true }));
      if (editors.size > 48) editors.delete(editors.keys().next().value);
      return editors.get(key);
    };
    const normalizeValues = (input, changedKey) => {
      const mapping = spec.normalizeMapping(input, changedKey), editor = editorFor(mapping);
      return editor.normalizeValues({ ...editor.values, ...mapping }, changedKey);
    };
    const resolved = values => { const normalized = normalizeValues(values); return { editor: editorFor(normalized), values: normalized }; };
    // Resolve field choices only for mounted cards, not every offscreen plot.
    return { ...spec, controls: [], normalizeValues,
      resolveControls: input => { const { editor, values } = resolved(input); return editor.resolveControls(values); },
      build: input => { const { editor, values } = resolved(input); return editor.build(values); },
      setup: input => { const { editor, values } = resolved(input); return editor.setup?.(values) ?? []; },
      usage: input => { const { editor, values } = resolved(input); return editor.usage(values); } };
  }
  const controls = spec.controls.map(c => conditional(c, path => path));
  const resolveFlatControls = values => {
    const scales = spec.resolveScaleControls?.(values) ?? [];
    const dynamic = spec.resolveControls?.(values) ?? [];
    return controls.map(c => ({ ...c, ...(scales.find(control => control.key === c.key) ?? {}),
      ...(dynamic.find(control => control.key === c.key) ?? {}), ...(c.distinctFrom ? {
    choices: c.choices.map(choice => ({ ...choice,
      disabled: Boolean(choice.disabled || choice.value === values[c.distinctFrom]),
      reason: choice.value === values[c.distinctFrom] ? 'These roles must use different fields.' : choice.reason })),
  } : {}),
    ...(spec.regressionOptions && c.key === 'degree' ? {
      max: Math.max(1, Math.min(c.max, spec.regressionOptions[values.fit ?? 'all'].minDistinctX - 1,
        spec.regressionOptions[values.fit ?? 'all'].minRows - (values.interval === false ? 1 : 2))),
    } : {}),
    ...(spec.regressionOptions && c.key === 'interval' ? {
      choices: c.choices.map(choice => ({ ...choice, ...(choice.value !== false &&
        spec.regressionOptions[values.fit ?? 'all'].minRows < (values.method === 'polynomial' ? (values.degree ?? 2) + 2 : 3) ? {
          disabled: true, reason: 'Each fit needs an additional observation to estimate an interval.',
        } : {}) })),
    } : {}),
    ...(spec.regressionOptions && c.key === 'method' ? {
      choices: c.choices.map(choice => ({ ...choice,
        ...(choice.value === 'exp' && !spec.regressionOptions.positiveY ? {
          disabled: true, reason: 'Exponential regression requires strictly positive Y values.',
        } : {}) })),
    } : {}),
    }));
  };
  const groupScales = controls => {
    if (spec.fieldSelection || spec.method === 'createRadarPlot') {
      const mappingKeys = new Set(['dimensions', 'group', 'color', 'category', 'start', 'end']);
      const sections = [
        ['mapping', 'Variables', c => c.section === 'mapping' || mappingKeys.has(c.key)],
        ['settings', 'Chart settings', c => c.section !== 'scales' && c.section !== 'mapping' && !mappingKeys.has(c.key)],
        ['scales', 'Scales & palette', c => c.section === 'scales']];
      return sections.flatMap(([key, label, predicate]) => { const children = controls.filter(predicate);
        return children.length ? [{ key, label, type: 'group', controls: children }] : []; });
    }
    const scales = controls.filter(c => c.section === 'scales');
    return [...controls.filter(c => c.section !== 'scales'), ...(scales.length ? [
      { key: 'scales', label: 'Scales & palette', type: 'group', controls: scales },
    ] : [])];
  };
  const resolveControls = values => groupScales(resolveFlatControls(values));
  const normalizeValues = (input, changedKey) => {
    const values = { ...input };
    for (const c of controls) {
      if (!c.distinctFrom || values[c.key] !== values[c.distinctFrom]) continue;
      const replace = changedKey === c.key ? controls.find(other => other.key === c.distinctFrom) : c;
      values[replace.key] = replace.choices.find(choice => !choice.disabled && choice.value !== values[c.key])?.value;
    }
    for (const c of resolveFlatControls(values)) {
      if (c.type === 'select' && (c.choices.some(choice => sameValue(choice.value, values[c.key]) && choice.disabled) ||
          spec.fieldSelection && !c.choices.some(choice => sameValue(choice.value, values[c.key])))) {
        values[c.key] = c.choices.find(choice => !choice.disabled)?.value;
      }
      if (c.type === 'number' && Number.isFinite(values[c.key])) values[c.key] = Math.max(c.min, Math.min(c.max, values[c.key]));
    }
    return values;
  };
  return { ...spec, controls: groupScales(controls), resolveControls, normalizeValues,
    build: values => spec.build(normalizeValues(values)),
    ...(spec.setup ? { setup: values => spec.setup(normalizeValues(values)) } : {}) };
}

export function recommendationParameters(recommendation, profile) {
  if (recommendation.editingScope) {
    const local = recommendation.localRecommendation ?? recommendation;
    const editor = recommendationParameters({ ...local, editingScope: undefined, localRecommendation: undefined }, profile);
    const scope = recommendation.editingScope;
    if (!scope.all || !scope.fields) return { ...editor, parameterMethod: local.method, editingScope: scope };
    const permitted = new Set(scope.fields);
    const flatten = controls => controls.flatMap(control => control.controls ? flatten(control.controls) : [control]);
    const restrict = controls => {
      const field = flatten(controls).find(control => control.key === 'field');
      if (!field?.choices) return controls;
      const available = field.choices.some(choice => !choice.disabled && permitted.has(choice.value));
      const visit = control => control.controls ? { ...control, controls: control.controls.map(visit) } :
        !['field', 'mode'].includes(control.key) ? control : { ...control, choices: control.choices.map(choice => {
          const unavailable = control.key === 'field' ? !permitted.has(choice.value) : choice.value === 'variable' && !available;
          return unavailable ? { ...choice, disabled: true, reason: 'Choose one chart to use variables that are not shared by every target.' } : choice;
        }) };
      return controls.map(visit);
    };
    const resolveControls = values => restrict(editor.resolveControls(values));
    const normalizeValues = (values, key) => {
      const next = editor.normalizeValues(values, key), controls = flatten(resolveControls(next));
      const field = controls.find(control => control.key === 'field');
      if (field?.choices.some(choice => choice.value === next.field && choice.disabled))
        next.field = field.choices.find(choice => !choice.disabled)?.value;
      const mode = controls.find(control => control.key === 'mode');
      if (mode?.choices.some(choice => choice.value === next.mode && choice.disabled))
        next.mode = mode.choices.find(choice => !choice.disabled)?.value;
      return next;
    };
    const values = normalizeValues(editor.values ?? valuesFor(editor.controls));
    return { ...editor, parameterMethod: local.method, editingScope: scope, values, controls: resolveControls(values),
      resolveControls, normalizeValues, build: values => editor.build(normalizeValues(values)) };
  }
  const { method, args } = recommendation;
  if (method === 'editFacetSource' && args.action) {
    const source = { ...recommendation, method: args.action.method, args: args.action.options,
      alternatives: recommendation.alternatives?.map(a => ({ ...a, method: a.args.action.method, args: a.args.action.options })) };
    const editor = recommendationParameters(source, profile);
    return { ...editor, build: values => ({ action: { method: source.method, options: editor.build(values) } }) };
  }
  // Corpus recipes choose defaults, not a less capable editor for the same function.
  if (recommendation.parameterMode === 'presets') {
    const schema = recommendation.alternatives?.find(option => option.parameters?.length);
    if (schema) return recommendationParameters({ ...recommendation, parameterMode: undefined,
      parameters: schema.parameters }, profile);
  }
  const alternatives = recommendation.alternatives ?? [{ args }];
  const options = [...new Set(alternatives.map(v => fieldOf(v.args)).filter(Boolean))];
  const fields = new Map(profile.fields.map(f => [f.name, f]));
  const facetCount = field => recommendation.facetFieldCounts?.[field] ?? fields.get(field)?.distinct ?? args.columns ?? 1;
  const validFieldOptions = options.map(value => ({ value, label: recommendation.fieldLabels?.[value] ?? value, missing: fields.get(value)?.missing,
    fieldType: fields.get(value)?.type }));
  const fieldOptions = [...validFieldOptions, ...(recommendation.unavailableFields ?? []).filter(f => !options.includes(f.value)).map(f => ({ ...f, label: recommendation.fieldLabels?.[f.value] ?? f.label }))];
  const usable = profile.fields.filter(f => f.usable);
  const quantitative = usable.filter(f => f.type === 'quantitative').map(f => f.name);
  const categories = usable.filter(f => ['nominal', 'ordinal'].includes(f.type)).map(f => f.name);
  const clone = () => structuredClone(args);
  const legendBlocks = recommendation.guideContext?.legendBlocks ?? alternatives.map(option => ({ args: option.args, context: option.guideContext ?? recommendation.guideContext ?? {} }));
  const legendBlockFor = values => legendBlocks.find(block => block.args.channel === (values.channel ?? args.channel));
  const legendContextFor = values => values.channel === 'all' ? {
    visibility: Object.fromEntries(['all', 'labels', 'titleStyle'].map(part => [part, legendBlocks.every(block => block.context.visibility?.[part] !== false)])),
    itemSpacing: legendBlocks.some(block => block.context.itemSpacing !== false),
  } : legendBlockFor(values)?.context ?? recommendation.guideContext ?? {};
  const forField = field => structuredClone(alternatives.find(option => fieldOf(option.args) === field)?.args ?? args);
  const statisticAxis = values => recommendation.statisticalContext?.axes?.[values.axis ?? args.axis];
  const statisticGroups = values => {
    const populations = statisticAxis(values)?.populations;
    if (!populations) return recommendation.statisticalContext?.groupFields ?? [];
    return [...new Map(populations.filter(population => !population.disabled).flatMap(population => population.groups).map(field => [field.name, field])).values()];
  };
  let controls, build;
  let normalize = values => ({ ...values });
  let resolve = () => controls;

  if (method === 'editArcMark' && recommendation.arcContext) {
    const context = recommendation.arcContext;
    const geometry = args.innerRadius !== undefined || args.padAngle !== undefined;
    if (geometry) {
      const radius = args.innerRadius ?? context.innerRadius, pixels = radius?.unit === 'px';
      const gapStep = context.maxGap >= .1 ? .1 : Number((context.maxGap / 10).toPrecision(1));
      const gap = Math.min(context.maxGap, Number((args.padAngle ?? context.padAngle).toPrecision(3)));
      controls = [
        ...(context.innerEditable ? [numeric('innerRadius', pixels ? 'Inner radius (px)' : 'Hole size (%)',
          pixels ? radius.value : radius * 100, 0, pixels ? context.maxInnerPixels
            : Math.max(95, typeof context.innerRadius === 'number' ? context.innerRadius * 100 : 0), pixels ? 1 : 5)] : []),
        numeric('padAngle', 'Slice gap (°)', gap, 0, context.maxGap, gapStep),
      ];
      build = v => ({ target: args.target, ...(context.innerEditable ? {
        innerRadius: pixels ? { unit: 'px', value: v.innerRadius } : v.innerRadius / 100,
      } : {}), padAngle: v.padAngle });
    } else {
      const stroke = args.stroke ?? context.stroke, bordered = v => v.border;
      controls = [numeric('opacity', 'Opacity', args.opacity ?? context.opacity, .05, 1, .05),
        ...(!context.strokeMapped ? [select('border', 'Outline', [{ value: true, label: 'On' }, { value: false, label: 'Off' }], stroke !== false && stroke !== 'none')] : []),
        { ...numeric('strokeWidth', 'Stroke width', args.strokeWidth ?? context.strokeWidth, 0, 6, .25),
          when: context.strokeMapped ? undefined : bordered },
        ...(!context.strokeMapped ? [{ ...select('stroke', 'Stroke color', ['#000000', '#ffffff', '#555555', '#4c78a8', '#e45756'],
          typeof stroke === 'string' && stroke !== 'none' ? stroke : '#000000'), type: 'color', when: bordered }] : []),
      ];
      const initial = valuesFor(controls);
      build = v => {
        const out = clone();
        if (Object.hasOwn(args, 'opacity') || v.opacity !== initial.opacity) out.opacity = v.opacity;
        if (context.strokeMapped) {
          if (Object.hasOwn(args, 'strokeWidth') || v.strokeWidth !== initial.strokeWidth) out.strokeWidth = v.strokeWidth;
        } else if (!v.border) {
          if (Object.hasOwn(args, 'stroke') || v.border !== initial.border) out.stroke = false;
          delete out.strokeWidth;
        } else if (Object.hasOwn(args, 'stroke') || Object.hasOwn(args, 'strokeWidth') ||
            ['border', 'stroke', 'strokeWidth'].some(key => v[key] !== initial[key])) {
          out.stroke = v.stroke; out.strokeWidth = v.strokeWidth;
        }
        return out;
      };
    }
  } else if (recommendation.guideContext?.colorScale) {
    const context = recommendation.guideContext.colorScale, quantitative = context.fieldType === 'quantitative';
    const domain = context.resolvedDomain?.filter(Number.isFinite) ?? [];
    const lo = domain.length ? Math.min(...domain) : 0, hi = domain.length ? Math.max(...domain) : 1;
    const span = Math.max(hi - lo, Math.abs(hi) * .01, .01), step = Number((span / 100).toPrecision(2));
    const custom = Array.isArray(context.domain);
    controls = [select('palette', 'Palette', paletteChoices(context.fieldType), args.palette),
      select('reverse', 'Direction', [{ value: false, label: 'Normal' }, { value: true, label: 'Reversed' }], context.reverse),
      ...(quantitative ? [select('scaleType', 'Scale', [{ value: 'sequential', label: 'Linear' },
        { value: 'log', label: 'Log', disabled: !context.valuesPositive || lo <= 0,
          reason: !context.valuesPositive || lo <= 0 ? 'Log requires a strictly positive domain.' : undefined },
        { value: 'sqrt', label: 'Square root' }, { value: 'symlog', label: 'Symmetric log' }], context.type),
      { key: 'colorDomain', label: 'Domain & center', type: 'group', controls: [
        select('domainMode', 'Domain', [{ value: 'auto', label: 'Automatic' }, { value: 'custom', label: 'Custom' }], custom ? 'custom' : 'auto'),
        { ...numeric('domainMin', 'Minimum', custom ? Math.min(...context.domain) : lo, lo - span, hi + span, step), when: v => v.domainMode === 'custom' },
        { ...numeric('domainMax', 'Maximum', custom ? Math.max(...context.domain) : hi, lo - span, hi + span, step), when: v => v.domainMode === 'custom' },
        { ...select('centerMode', 'Center', [{ value: 'auto', label: 'Automatic' }, { value: 'custom', label: 'Custom' }], Number.isFinite(context.midpoint) ? 'custom' : 'auto'), when: v => v.scaleType === 'sequential' },
        { ...numeric('midpoint', 'Midpoint', Number.isFinite(context.midpoint) ? context.midpoint : lo < 0 && hi > 0 ? 0 : (lo + hi) / 2, lo, hi, step),
          when: v => v.scaleType === 'sequential' && v.centerMode === 'custom' },
      ] }] : [])];
    build = v => ({ ...clone(), palette: v.palette, reverse: v.reverse,
      ...(quantitative ? { type: v.scaleType, domain: v.domainMode === 'custom' ? [v.domainMin, v.domainMax] : 'auto',
        midpoint: v.scaleType === 'sequential' && v.centerMode === 'custom' ? v.midpoint : 'auto' } : {}) });
  } else if (recommendation.binRecipe) {
    const recipe = recommendation.binRecipe;
    controls = [numeric('bins', 'X bins (maximum)', recipe.bins, 2, 24)];
    build = v => ({ ...clone(), expression: binnedPositionExpression(recipe.field, recipe.domain, v.bins) });
  } else if (recommendation.radialContext?.measured) {
    const fields = recommendation.radialContext.fields;
    controls = [select('aggregate', 'Aggregate', [{ value: 'sum', label: 'Sum', disabled: !fields.length }, { value: 'count', label: 'Count' }], args.aggregate ?? 'sum'),
      { ...select('field', 'Variable', fields, args.field ?? fields[0]), when: v => v.aggregate !== 'count' },
      select('mapping', 'Measure by', [{ value: 'area', label: 'Area' }, { value: 'radius-length', label: 'Radius length' }], args.mapping)];
    build = v => ({ target: args.target, aggregate: v.aggregate, mapping: v.mapping,
      ...(v.aggregate === 'count' ? {} : { field: v.field, fieldType: 'quantitative' }) });
  } else if (recommendation.positionFields) {
    controls = [select('field', 'Variable', fieldOptions, args.field)];
    build = v => forField(v.field);
  } else if (method === 'createStatisticalReference') {
    const axes = recommendation.statisticalContext?.axisChoices ?? [...new Set(alternatives.map(option => option.args.axis))];
    const isInterval = value => ['middle50', 'middle95'].includes(value);
    const initial = args.statistics ?
      (args.statistics?.[0]?.p === .025 ? 'middle95' : 'middle50') : args.statistic?.op ?? 'mean';
    controls = [select('axis', 'Axis', axes, args.axis), select('statistic', 'Statistic', [
      { value: 'mean', label: 'Mean' }, { value: 'median', label: 'Median' },
      { value: 'min', label: 'Minimum' }, { value: 'max', label: 'Maximum' },
      { value: 'middle50', label: 'Middle 50%' }, { value: 'middle95', label: 'Middle 95%' },
    ], initial), select('population', 'Population', statisticAxis(args)?.populations ?? [{ value: 'visibleItems', label: 'Visible marks',
      disabled: recommendation.statisticalContext?.series, reason: recommendation.statisticalContext?.series ? 'A line or area represents a series. Use its bound rows.' : undefined },
      { value: 'boundData', label: 'All bound rows' }], args.population ?? 'visibleItems'),
      select('groupBy', 'Group by', [{ value: '', label: 'None' },
        ...statisticGroups(args).map(field => ({ value: field.name, label: field.name }))], args.groupBy ?? '')];
    build = v => {
      const population = statisticAxis(v)?.populations.find(population => population.value === v.population);
      const common = { ...(args.id ? { id: args.id } : {}), source: args.source, axis: v.axis,
        population: v.population === 'observations' ? 'boundData' : v.population, ...(v.groupBy ? { groupBy: v.groupBy } : {}),
        ...(population?.field ?? args.field ? { field: population?.field ?? args.field } : {}) };
      if (isInterval(v.statistic)) {
        const p = v.statistic === 'middle95' ? .025 : .25;
        return { ...common, statistics: [{ op: 'quantile', p }, { op: 'quantile', p: 1 - p }],
          fill: '#6b7280', opacity: .18 };
      }
      return { ...common, statistic: { op: v.statistic }, strokeWidth: 2.5, strokeDash: 'solid' };
    };
  } else if (method === 'facet') {
    controls = [select('field', 'Facet by', [...new Set(alternatives.map(a => a.args.field))], args.field),
      { ...numeric('columns', 'Columns', defaultFacetColumns(facetCount(args.field)), 1, Math.max(6, facetCount(args.field))), defaultPolicy: 'context' },
      numeric('gap', 'Minimum gap', args.gap ?? 12, 0, Math.max(40, args.gap ?? 12))];
    build = v => {
      const variants = alternatives.filter(a => a.args.field === v.field);
      // Partition edits do not change guide ownership or scale resolution.
      // In particular legend:false means child-local legends, not no legends.
      return { ...clone(), data: recommendation.facetFields?.[v.field] ?? variants[0]?.args.data ?? args.data,
        field: v.field, columns: v.columns, gap: v.gap };
    };
  } else if (recommendation.parameterMode === 'presets') {
    const label = args => Object.entries(args).filter(([key]) => key !== 'target').slice(0, 3)
      .map(([key, value]) => `${key.replace(/([a-z])([A-Z])/g, '$1 $2')}${typeof value === 'object' ? '' : `: ${value}`}`).join(' · ');
    controls = alternatives.length > 1 ? [select('variant', 'Style', alternatives.map((option, value) => ({ value,
      label: label(option.args) })), 0)] : [];
    build = v => structuredClone(alternatives[v.variant ?? 0].args);
  } else if (recommendation.parameters?.length) {
    const at = (object, path) => path.split('.').reduce((v, key) => v?.[key], object);
    controls = recommendation.parameters.map((parameter, i) => conditional({ ...structuredClone(parameter), key: `p${i}`,
      value: at(args, parameter.path) ?? parameter.value,
      ...(parameter.path === 'gap' && parameter.type === 'number' ? { max: Math.max(parameter.max, at(args, 'gap') ?? 0) } : {}) },
    path => `p${recommendation.parameters.findIndex(p => p.path === path)}`));
    build = values => {
      const out = clone();
      for (const [i, parameter] of recommendation.parameters.entries()) {
        if (controls[i].when && !controls[i].when(values)) {
          const path = parameter.path.split('.'), key = path.pop();
          const parent = path.reduce((value, part) => value?.[part], out);
          if (parent) delete parent[key];
          continue;
        }
        if (parameter.omitUnchanged && at(args, parameter.path) === undefined &&
            JSON.stringify(values[`p${i}`]) === JSON.stringify(parameter.value)) continue;
        for (const name of [parameter.path, ...(values[`p${i}`] !== at(args, parameter.path) ? parameter.alsoSet ?? [] : [])]) {
          const path = name.split('.'), key = path.pop();
          let node = out;
          for (const part of path) node = node[part] ??= {};
          node[key] = values[`p${i}`];
        }
      }
      for (const parameter of recommendation.parameters) {
        if (at(out, parameter.path) === undefined) continue;
        for (const [key, value] of Object.entries(parameter.requires ?? {})) {
          if (out[key] === undefined) out[key] = structuredClone(value);
        }
        for (const key of parameter.includeWith ?? []) {
          const i = recommendation.parameters.findIndex(p => p.path === key);
          if (i >= 0 && out[key] === undefined) out[key] = values[`p${i}`];
        }
      }
      if (method === 'editECDFPlot') {
        const group = out.groupBy;
        out.color = group === false ? false : { field: Array.isArray(group) ? group[0] : group, fieldType: 'nominal' };
      }
      if (method === 'editBoxPlot' && out.width) {
        if (recommendation.parameters.some(parameter => parameter.path === 'width.band')) delete out.width.pixels;
        else if (recommendation.parameters.some(parameter => parameter.path === 'width.pixels')) delete out.width.band;
      }
      return out;
    };
  } else if (['encodeX', 'encodeY'].includes(method)) {
    controls = [select('field', 'Variable', fieldOptions, args.field),
      select('scale', 'Scale', ['auto', 'linear', 'log', 'sqrt', 'symlog'], 'auto')];
    if (alternatives.some(a => a.args.aggregate)) controls.push({
      ...select('aggregate', 'Aggregation', ['mean', 'median', 'sum', 'min', 'max'], args.aggregate ?? 'mean'),
      when: v => Boolean(forField(v.field).aggregate),
    });
    build = v => {
      const out = forField(v.field); out.field = v.field; out.fieldType = fields.get(v.field)?.type ?? args.fieldType;
      if (v.aggregate && out.aggregate) out.aggregate = v.aggregate;
      if (v.scale !== 'auto') {
        const axis = method === 'encodeX' ? 'x' : 'y';
        const binding = recommendation.positionScaleContext?.bindings?.[axis];
        // A scale edit for the same positional meaning retains its identity,
        // including source marks and statistical references sharing that axis.
        let id = binding?.field === v.field ? binding.scale : undefined;
        if (!id) {
          const stem = `${args.target ?? 'plot'}-${axis}-${v.scale}`;
          id = stem;
          const ids = recommendation.scaleIds ?? [];
          for (let suffix = 2; ids.includes(id); suffix++) id = `${stem}-${suffix}`;
        }
        out.scale = { ...out.scale, id, type: v.scale };
        if (['log', 'time', 'utc'].includes(v.scale)) delete out.scale.zero;
      }
      return out;
    };
  } else if (['encodeColor', 'encodeStroke', 'encodeOpacity', 'encodeSize', 'encodeStrokeWidth'].includes(method)) {
    const color = ['encodeColor', 'encodeStroke'].includes(method);
    const size = method === 'encodeSize';
    const width = method === 'encodeStrokeWidth';
    const variable = v => v.mode === 'variable';
    const conditional = (control, when) => ({ ...control, when });
    const variableArgs = alternatives.find(option => option.args.field)?.args;
    const defaultField = args.field ?? variableArgs?.field;
    const fixedValue = args.value ?? (method === 'encodeStroke' ? '#000000' : color ? '#4c78a8' : size ? 64 : width ? 2 : 0.7);
    controls = [select('mode', 'Mode', [{ value: 'fixed', label: 'Fixed' }, { value: 'variable', label: 'Variable', disabled: !validFieldOptions.length }],
      args.field ? 'variable' : 'fixed'),
      conditional(color ? { key: 'value', label: 'Color', type: 'color', value: fixedValue, choices: [...(method === 'encodeStroke' ? ['#000000'] : []), '#4c78a8', '#f58518', '#e45756', '#72b7b2', '#54a24b', '#b279a2', '#555555'].map(value => ({ value, label: value })) }
        : numeric('value', size ? 'Area (px²)' : width ? 'Stroke width' : 'Opacity', fixedValue, 0, size ? 1600 : width ? 8 : 1, size ? 1 : width ? .25 : 0.05), v => !variable(v)),
      conditional(select('field', 'Variable', fieldOptions, defaultField), variable)];
    if (color) {
      controls.push(conditional(select('palette', 'Palette', paletteChoices(fields.get(defaultField)?.type, { auto: true }), args.scale?.palette ?? 'auto'), variable));
      if (alternatives.some(option => option.args.aggregate)) {
        controls.push(conditional(select('aggregate', 'Aggregation', ['mean', 'median', 'sum', 'min', 'max'], args.aggregate ?? alternatives.find(option => option.args.aggregate).args.aggregate),
          v => variable(v) && Boolean(forField(v.field).aggregate)));
      }
    } else {
      const range = variableArgs?.scale?.range ?? (size ? [20, 240] : width ? [1, 4] : [0.25, 1]);
      controls.push(conditional({ key: 'range', label: size ? 'Area range (px²)' : width ? 'Width range' : 'Opacity range', type: 'group',
        controls: [numeric('min', 'Minimum', range[0], 0, size ? 1600 : width ? 8 : 1, size ? 1 : width ? .25 : 0.05),
          numeric('max', 'Maximum', range[1], 0, size ? 1600 : width ? 8 : 1, size ? 1 : width ? .25 : 0.05)] }, variable));
    }
    build = v => {
      if (v.mode === 'fixed') return { ...(args.target ? { target: args.target } : {}), value: v.value };
      const out = forField(v.field);
      delete out.value;
      out.field = v.field;
      out.fieldType = fields.get(v.field)?.type ?? out.fieldType;
      if (color) {
        if (out.aggregate) out.aggregate = v.aggregate;
        if (v.palette !== 'auto') out.scale = { ...out.scale, palette: v.palette };
      } else {
        if (v.min > v.max) throw new Error('Minimum must be no greater than maximum.');
        out.scale = { ...out.scale, range: [v.min, v.max] };
      }
      return out;
    };
  } else if (['encodeAngle', 'encodeStrokeDash', 'encodeShape'].includes(method)) {
    const angle = method === 'encodeAngle', shape = method === 'encodeShape';
    const variable = v => v.mode === 'variable';
    controls = [select('mode', 'Mode', [{ value: 'fixed', label: 'Fixed' },
      { value: 'variable', label: 'Variable', disabled: !validFieldOptions.length }], args.field ? 'variable' : 'fixed'),
      { ...select('field', 'Variable', fieldOptions, args.field ?? options[0]), when: variable },
      { ...(angle ? numeric('value', 'Angle', args.value ?? 30, 0, 360, 5)
        : shape ? select('value', 'Shape', ['circle', 'square', 'diamond', 'triangle-up', 'triangle-down', 'triangle-left', 'triangle-right', 'plus', 'cross', 'star', 'hexagon', 'wye', 'wedge', 'arrow'], args.value ?? 'circle')
        : select('value', 'Dash', ['solid', 'dashed', 'dotted'], args.value ?? 'dashed')), when: v => !variable(v) }];
    build = v => variable(v) ? forField(v.field) : { target: args.target, value: v.value };
  } else if (method === 'createRegression') {
    const context = recommendation.regressionContext;
    const groups = context ? Object.keys(context.groups).filter(Boolean) : categories;
    const group = Object.hasOwn(args, 'groupBy') ? args.groupBy || '' : context?.defaultGroup ?? '';
    const canEstimateInterval = v => !context || context.groups[v.group || '']?.minRows >= (v.method === 'polynomial' ? (v.degree ?? 2) + 2 : 3);
    controls = [select('method', 'Model', ['linear', 'polynomial', 'loess', 'exp'], args.method ?? 'linear'),
      { ...select('group', 'Group', [{ value: '', label: 'All observations' }, ...groups.map(value => ({ value, label: value }))], group), defaultPolicy: 'context' },
      { key: 'modelSettings', label: 'Model settings', type: 'group', when: v => ['polynomial', 'loess'].includes(v.method), controls: [
        { ...numeric('degree', 'Degree', args.degree ?? 2, 1, 6), when: v => v.method === 'polynomial' },
        { ...numeric('span', 'Span', args.span ?? .5, .1, 1, .05), when: v => v.method === 'loess' },
        { ...numeric('robustIterations', 'Robust iterations', args.robustIterations ?? 0, 0, 5), when: v => v.method === 'loess' },
      ] },
      { key: 'uncertainty', label: 'Interval', type: 'group', when: v => ['linear', 'polynomial'].includes(v.method), controls: [
        select('interval', 'Interval', [{ value: false, label: 'None' }, { value: 'mean', label: 'Mean confidence' },
          { value: 'prediction', label: 'Prediction' }], args.interval ?? 'mean'),
        { ...numeric('level', 'Confidence level', args.level ?? .95, .5, .99, .01), when: v => v.interval !== false && canEstimateInterval(v) },
      ] }];
    build = v => {
      const out = { ...clone(), method: v.method, groupBy: v.group || false };
      delete out.level; delete out.interval; delete out.confidence; delete out.confidenceMethod; delete out.band;
      if (v.method === 'polynomial') out.degree = v.degree;
      else delete out.degree;
      if (v.method === 'loess') { out.span = v.span; out.robustIterations = v.robustIterations; }
      else { delete out.span; delete out.robustIterations; }
      if (['linear', 'polynomial'].includes(v.method)) {
        if (canEstimateInterval(v) && v.interval !== false) { out.level = v.level; out.interval = v.interval; }
        else out.interval = false;
      }
      else if (v.method === 'exp') out.interval = false;
      return out;
    };
  } else if (method === 'editAxes') {
    const contexts = recommendation.guideContext?.axes ?? {};
    const channels = Object.keys(args);
    const quantitativeAxis = (channel, entry) => ['quantitative', 'temporal'].includes(
      channel === 'parallel' ? fields.get(entry.field)?.type : contexts[channel]?.fieldType);
    const hasTicks = channels.some(channel => (Array.isArray(args[channel]) ? args[channel] : [args[channel]])
      .some(entry => ['x', 'y', 'parallel'].includes(channel) && quantitativeAxis(channel, entry)));
    controls = [{ ...numeric('fontSize', 'Label size', 11, 8, 18), section: 'Labels' },
      { ...numeric('offset', 'Label offset', 8, 0, 30), section: 'Labels' },
      numeric('lineWidth', 'Axis width', Object.values(contexts)[0]?.lineWidth ?? 1, 0, 5, .25),
      ...(hasTicks ? [numeric('ticks', 'Ticks', 5, 2, 12)] : []),
      ...channels.filter(channel => ['x', 'y'].includes(channel) && !Array.isArray(args[channel])).map(channel => ({
        ...select(`${channel}Position`, `${channel.toUpperCase()} position`, channel === 'x' ? ['bottom', 'top'] : ['left', 'right'],
          contexts[channel]?.position ?? (channel === 'x' ? 'bottom' : 'left')), section: 'Position', defaultPolicy: 'context',
      }))];
    build = v => Object.fromEntries(channels.map(channel => {
      const edit = entry => {
        const out = structuredClone(entry); delete out.labels;
        const quantitative = quantitativeAxis(channel, entry);
        // Preserve categorical tick policies and specialized plot axis counts.
        return { ...out, ...(v[`${channel}Position`] ? { position: v[`${channel}Position`] } : {}), line: { ...(out.line || {}), lineWidth: v.lineWidth }, ticksAndLabels: {
          ...(quantitative && v.ticks !== undefined ? { count: v.ticks } : {}),
          labels: { fontSize: v.fontSize, offset: v.offset },
        } };
      };
      return [channel, Array.isArray(args[channel]) ? args[channel].map(edit) : edit(args[channel])];
    }));
  } else if (['editXAxis', 'editYAxis', 'editThetaAxis', 'editRadialAxis'].includes(method)) {
    const context = recommendation.guideContext ?? {};
    const cartesian = ['editXAxis', 'editYAxis'].includes(method);
    const quantitativeAxis = ['quantitative', 'temporal'].includes(context.fieldType);
    controls = [numeric('fontSize', 'Label size', args.labels?.fontSize ?? 11, 8, 18),
      numeric('offset', 'Label offset', context.offset ?? 8, 0, 30),
      numeric('lineWidth', 'Axis width', args.line?.lineWidth ?? context.lineWidth ?? 1, 0, 5, .25)];
    if (cartesian && quantitativeAxis) controls.push(numeric('ticks', 'Ticks', context.ticks ?? 5, 2, 12));
    if (cartesian) controls.push(select('position', 'Position', method === 'editXAxis' ? ['bottom', 'top'] : ['left', 'right'],
      args.position ?? context.position ?? (method === 'editXAxis' ? 'bottom' : 'left')));
    if (cartesian && quantitativeAxis) controls.slice(0, 2).forEach(c => { c.section = 'Labels'; });
    build = v => {
      const out = clone(); delete out.labels;
      return { ...out, line: { ...(out.line || {}), lineWidth: v.lineWidth }, ...(v.position ? { position: v.position } : {}), ticksAndLabels: {
        ...(v.ticks !== undefined ? { count: v.ticks } : {}),
        labels: { fontSize: v.fontSize, offset: v.offset },
      } };
    };
  } else if (method === 'editParallelAxis') {
    const dimensions = [...new Set(alternatives.map(option => option.args.field))];
    controls = [select('field', 'Dimension', dimensions, args.field),
      numeric('fontSize', 'Label size', args.labels?.fontSize ?? 11, 8, 18),
      numeric('offset', 'Label offset', args.labels?.offset ?? 8, 0, 30),
      numeric('lineWidth', 'Axis width', args.line?.lineWidth ?? 1, 0, 5, .25)];
    build = v => ({ ...clone(), field: v.field, line: { ...args.line, lineWidth: v.lineWidth },
      labels: { ...args.labels, fontSize: v.fontSize, offset: v.offset } });
  } else if (method === 'editLegend') {
    const channels = [...new Set(legendBlocks.map(block => block.args.channel).filter(Boolean))];
    const legendContext = legendContextFor({});
    controls = [select('channel', 'Legend', [...(channels.length > 1 ? [{ value: 'all', label: channels.length === 2 ? 'Both' : 'All' }] : []), ...channels], args.channel),
      select('position', 'Position', ['right', 'left', 'top', 'bottom', 'top-right', 'top-left', 'bottom-right', 'bottom-left'], args.position ?? 'right'),
      { key: 'appearance', label: 'Appearance', type: 'group', controls: [
        numeric('fontSize', 'Label size', args.labels?.fontSize ?? 12, 8, 18),
        { ...numeric('itemGap', 'Item gap', args.itemGap ?? legendContext.itemGap ?? 18, 4, 30), when: v => legendContextFor(v).itemSpacing !== false }] },
      ...([recommendation, ...alternatives].some(option => option.guideContext?.categorical) ? [{ key: 'entries', label: 'Entries', type: 'group', when: v => legendContextFor(v).categorical, controls: [
        { ...select('showAll', 'Entries', [{ value: true, label: 'Show all' }, { value: false, label: 'Limit' }], !legendContext.overflow), defaultPolicy: 'context' },
        { ...numeric('maxItems', 'Maximum entries', legendContext.overflow?.maxItems ?? Math.min(6, legendContext.itemCount ?? 6), 1,
          Math.max(1, legendContext.itemCount ?? 30)), when: v => !v.showAll, defaultPolicy: 'context' },
      ] }] : [])];
    build = v => v.channel === 'all' ? {
      target: args.target, channel: 'all', position: v.position,
      // Choosing Both and moving it must not overwrite differing appearance.
      ...(v.legendEdits?.includes('fontSize') || v.fontSize !== valuesFor(controls).fontSize ? { labels: { fontSize: v.fontSize } } : {}),
      ...(v.legendEdits?.includes('itemGap') || v.itemGap !== valuesFor(controls).itemGap ? { itemGap: v.itemGap } : {}),
    } : ({ ...structuredClone(legendBlockFor(v)?.args ?? args),
      channel: v.channel, position: v.position,
      ...(legendContextFor(v).itemSpacing !== false ? { itemGap: v.itemGap } : {}), labels: { fontSize: v.fontSize },
      ...(legendContextFor(v).categorical ? { overflow: v.showAll ? false : { maxItems: v.maxItems, summary: 'ellipsis-count' } } : {}) });
  } else if (method === 'editGrid') {
    const direction = recommendation.guideContext?.direction ?? Object.keys(args)[0];
    const cartesian = ['vertical', 'horizontal'].includes(direction);
    const directions = cartesian ? ['vertical', 'horizontal'] : recommendation.guideContext?.directions ?? Object.keys(args);
    const choices = directions.map(value => ({ value,
      label: cartesian ? value[0].toUpperCase() + value.slice(1) : value }));
    if (directions.length > 1) choices.push({ value: 'both', label: 'Both' });
    controls = [select('direction', 'Direction', choices, direction),
      select('color', 'Color', ['#e2e8f0', '#cbd5e1', '#9ca3af', '#6b7280'], args[direction]?.color ?? '#cbd5e1'),
      numeric('width', 'Line width', args[direction]?.lineWidth ?? 1.5, 0, 4, .25),
      select('dash', 'Line style', [{ value: [], label: 'Solid' }, { value: [6, 4], label: 'Dashed' }, { value: [2, 3], label: 'Dotted' }], args[direction]?.strokeDash ?? [])];
    // Direction chooses visible grids, not just which existing grid to restyle.
    // Visibility keeps the previous direction style available when switched back.
    build = v => Object.fromEntries(directions.map(key => [key,
      v.direction === 'both' || v.direction === key
        ? { ...clone()[key], visible: true, color: v.color, lineWidth: v.width, strokeDash: v.dash }
        : { visible: false }]));
  } else if (method === 'createAxes') {
    const categoricalAxis = axis => ['nominal', 'ordinal'].includes(fields.get(recommendation.axisFields?.[axis])?.type);
    controls = ['x', 'y'].map(axis => categoricalAxis(axis)
      ? numeric(`${axis}Offset`, `${axis.toUpperCase()} label offset`, 8, 2, 20)
      : numeric(`${axis}Ticks`, `${axis.toUpperCase()} ticks`, 5, 2, 12));
    controls.push(numeric('fontSize', 'Label size', 12, 8, 18));
    build = v => ({ ...clone(), ...Object.fromEntries(['x', 'y'].map(axis => [axis, { ticksAndLabels: {
      ...(!categoricalAxis(axis) ? { count: v[`${axis}Ticks`] } : {}),
      labels: { fontSize: v.fontSize,
        ...(categoricalAxis(axis) ? { offset: v[`${axis}Offset`] } : {}) },
    } }])) });
  } else if (method === 'createLegend') {
    controls = [select('position', 'Position', ['right', 'left', 'top', 'bottom'], args.position ?? 'right'),
      numeric('fontSize', 'Label size', 12, 8, 18), text('title', 'Title', args.title ?? '')];
    build = v => ({ ...clone(), position: v.position, labels: { fontSize: v.fontSize },
      ...(v.title ? { title: v.title } : {}) });
  } else if (['createTitle', 'editTitle'].includes(method)) {
    controls = [text('text', 'Title', args.text), text('subtitle', 'Subtitle', args.subtitle || ''),
      { key: 'fontSizes', label: 'Font size', type: 'group', controls: [
        { ...numeric('size', 'Title size', args.titleStyle?.fontSize ?? DEFAULT_TITLE_FONT_SIZE, 10, 30),
          ...(method === 'editTitle' ? { defaultPolicy: 'context' } : {}) },
        { ...numeric('subtitleSize', 'Subtitle size', args.subtitleStyle?.fontSize ?? DEFAULT_SUBTITLE_FONT_SIZE, 8, 30),
          ...(method === 'editTitle' ? { defaultPolicy: 'context' } : {}) },
      ] },
      select('position', 'Position', recommendation.compositionContext?.facet ? ['top'] : ['top', 'bottom', 'left', 'right'], args.position ?? 'top')];
    build = v => {
      const next = { ...clone(), text: v.text, position: v.position,
        titleStyle: { ...args.titleStyle, fontSize: v.size,
          fontWeight: args.titleStyle?.fontWeight ?? 'bold' },
        subtitleStyle: { ...args.subtitleStyle, fontSize: v.subtitleSize } };
      if (recommendation.titleWrapBounds) {
        const extent = recommendation.titleWrapBounds[['top', 'bottom'].includes(v.position) ? 'width' : 'height'];
        next.maxWidth = Math.min(args.maxWidth ?? extent, extent);
        next.wrap = args.wrap ?? 'word';
      }
      if (v.subtitle.trim()) next.subtitle = v.subtitle;
      else if (method === 'editTitle') next.subtitle = false;
      else delete next.subtitle;
      return next;
    };
  } else if (method === 'editPointMark') {
    controls = [numeric('opacity', 'Opacity', args.opacity ?? 0.7, 0.05, 1, 0.05),
      select('shape', 'Shape', ['circle', 'square', 'diamond', 'cross'], args.shape ?? 'circle'),
      numeric('strokeWidth', 'Stroke width', args.strokeWidth ?? 0, 0, 4, 0.5)];
    build = v => ({ ...clone(), opacity: v.opacity, shape: v.shape,
      ...(v.strokeWidth > 0 ? { stroke: '#4c78a8', strokeWidth: v.strokeWidth } : {}) });
  } else if (['editBarMark', 'editLineMark', 'editAreaMark'].includes(method)) {
    controls = [numeric('opacity', 'Opacity', args.opacity ?? 0.8, 0.05, 1, 0.05),
      numeric('strokeWidth', 'Stroke width', args.strokeWidth ?? 0, 0, 5, 0.5)];
    if (method === 'editBarMark') controls.push(numeric('cornerRadius', 'Corner radius', 0, 0, 12));
    build = v => ({ ...clone(), opacity: v.opacity,
      ...(method === 'editBarMark' ? { cornerRadius: v.cornerRadius } : {}),
      ...(v.strokeWidth > 0 ? { ...(method === 'editLineMark' ? {} : { stroke: '#4c78a8' }), strokeWidth: v.strokeWidth } : {}) });
  } else if (method === 'orderCategories') {
    const axes = [...new Set(alternatives.map(a => a.args.channel))];
    const sortChoices = axes.flatMap(channel => ['category', 'count', ...quantitative].map(by => ({
      value: JSON.stringify([channel, by]), label: `${channel.toUpperCase()} · ${by}` })));
    controls = [select('by', 'Sort by', sortChoices, JSON.stringify([args.channel, 'category'])),
      select('direction', 'Direction', ['ascending', 'descending'], args.direction ?? 'ascending'),
      select('aggregate', 'Aggregation', ['mean', 'sum', 'min', 'max'], 'mean')];
    build = v => {
      const [channel, by] = v.by.startsWith('[') ? JSON.parse(v.by) : [args.channel, v.by];
      return { ...clone(), channel, by: ['category', 'count'].includes(by) ? by : { field: by, aggregate: v.aggregate }, direction: v.direction };
    };
  } else if (method === 'createMarkLabels') {
    controls = [select('content', 'Label', ['value', 'category'], args.content ?? 'value'),
      numeric('fontSize', 'Font size', args.fontSize ?? 11, 8, 18),
      select('anchor', 'Position', ['center', 'insideEnd', 'outsideEnd'], args.placement?.anchor ?? 'outsideEnd'),
      numeric('gap', 'Gap', args.placement?.gap ?? 4, 0, 16)];
    build = v => ({ ...clone(), content: v.content, fontSize: v.fontSize, placement: { ...args.placement, anchor: v.anchor, gap: v.gap } });
  } else if (method === 'createComputedData') {
    controls = [select('field', 'Source variable', options, args.expression.operand.field), text('as', 'Output column', args.as)];
    build = v => ({ ...clone(), as: v.as, expression: { op: 'toNumber', operand: { field: v.field } } });
  } else if (method === 'createSummaryData') {
    controls = [select('group', 'Group', options, args.groupBy[0]),
      select('operation', 'Aggregation', ['count', 'mean', 'sum', 'median', 'min', 'max'], args.aggregates[0].op),
      select('field', 'Value', [{ value: '', label: 'Rows (count)' }, ...quantitative.map(value => ({ value, label: value }))], '')];
    build = v => ({ ...clone(), groupBy: [v.group], aggregates: [{ op: v.operation,
      ...(v.field ? { field: v.field } : {}), as: v.group === 'count' ? 'row_count' : 'count' }] });
  } else if (['createPointMark', 'createLineMark', 'createBarMark', 'createAreaMark'].includes(method)) {
    controls = [numeric('opacity', 'Opacity', 0.7, 0.1, 1, 0.1),
      numeric('strokeWidth', 'Stroke width', method === 'createLineMark' ? 2 : 0, 0, 5, 0.5)];
    build = v => ({ ...clone(), opacity: v.opacity,
      ...(v.strokeWidth > 0 ? { stroke: '#4c78a8', strokeWidth: v.strokeWidth } : {}) });
  } else {
    // A zero-parameter real action is still usable; controls are optional.
    controls = [];
    build = clone;
  }
  // Keep argument construction flat; grouping only changes the visible editor.
  // Visibility values stay flat for argument construction. The display grouping
  // below moves each switch to the heading for the part it actually controls.
  const axisEditors = ['editAxes', 'editXAxis', 'editYAxis', 'editThetaAxis', 'editRadialAxis', 'editParallelAxis'];
  let gridVisibility;
  const toggle = (control, key, label, caption, value = true) => {
    if (!control) return;
    control.toggles = [...(control.toggles ?? []), { key, label, caption, value, defaultPolicy: 'context' }];
  };
  const leaves = controls.flatMap(c => c.type === 'group' ? c.controls : [c]);
  if (axisEditors.includes(method)) {
    const contexts = method === 'editAxes' ? Object.values(recommendation.guideContext?.axes ?? {}) : [recommendation.guideContext ?? {}];
    const enabled = part => contexts.every(context => context.visibility?.[part] !== false);
    toggle(leaves[0], 'guideVisible', 'Axes', 'Axes', enabled('all'));
    toggle(leaves.find(c => /Label size/i.test(c.label)), 'labelsVisible', 'Labels', '', enabled('labels'));
    toggle(leaves.find(c => /Axis width/i.test(c.label)), 'lineVisible', 'Axis line', '', enabled('line'));
    toggle(leaves.find(c => c.label === 'Ticks'), 'ticksVisible', 'Ticks', '', enabled('ticks'));
    toggle(leaves.find(c => /offset/i.test(c.label)) ?? leaves[0], 'titlesVisible', 'Titles', 'Titles', enabled('title'));
    const baseBuild = build;
    const apply = (out, v) => ({ ...out, visible: v.guideVisible,
      ...(v.lineVisible === undefined ? {} : { line: { ...(out.line || {}), visible: v.lineVisible } }),
      title: { ...(out.title || {}), visible: v.titlesVisible },
      ...(out.ticksAndLabels ? { ticksAndLabels: { ...out.ticksAndLabels,
        labels: { ...out.ticksAndLabels.labels, visible: v.labelsVisible },
        ...(v.ticksVisible === undefined ? {} : { ticks: { ...out.ticksAndLabels.ticks, visible: v.ticksVisible } }),
      } } : { labels: { ...out.labels, visible: v.labelsVisible },
        ...(v.ticksVisible === undefined ? {} : { ticks: { ...out.ticks, visible: v.ticksVisible } }) }),
    });
    build = v => {
      const out = baseBuild(v);
      return method === 'editAxes' ? Object.fromEntries(Object.entries(out).map(([channel, entry]) =>
        [channel, Array.isArray(entry) ? entry.map(item => apply(item, v)) : apply(entry, v)])) : apply(out, v);
    };
  } else if (method === 'editLegend') {
    const visibility = recommendation.guideContext?.visibility ?? {};
    toggle(leaves[0], 'guideVisible', 'Legend', 'Legend', visibility.all !== false);
    toggle(leaves.find(c => /Label size/i.test(c.label)), 'labelsVisible', 'Labels', '', visibility.labels !== false);
    toggle(leaves.find(c => c.key === 'position'), 'titlesVisible', 'Title', 'Title', visibility.titleStyle !== false);
    const baseBuild = build;
    build = v => {
      const out = baseBuild(v), visibility = legendContextFor(v).visibility ?? {};
      const changed = (key, part) => v.channel !== 'all' || v.legendEdits?.includes(key) || v[key] !== (visibility[part] !== false);
      return { ...out, ...(changed('guideVisible', 'all') ? { visible: v.guideVisible } : {}),
        ...(changed('labelsVisible', 'labels') ? { labels: { ...out.labels, visible: v.labelsVisible } } : {}),
        ...(changed('titlesVisible', 'titleStyle') ? { titleStyle: { ...out.titleStyle, visible: v.titlesVisible } } : {}) };
    };
  } else if (['editGrid', 'editHorizontalGrid', 'editVerticalGrid', 'editThetaGrid', 'editRadialGrid'].includes(method)) {
    // Grid visibility belongs to the whole editor, never to whichever parameter
    // happens to be first (often Width). Keep it outside slider definitions.
    gridVisibility = { key: 'guideVisible', label: 'Grid', caption: '',
      value: recommendation.guideContext?.visible !== false, defaultPolicy: 'context' };
    const baseBuild = build;
    build = v => { const out = baseBuild(v); return method === 'editGrid'
      ? Object.fromEntries(Object.entries(out).map(([direction, style]) => [direction, { ...style, visible: v.guideVisible && style.visible !== false }]))
      : { ...out, visible: v.guideVisible }; };
  }
  const groupControls = list => {
    if (gridVisibility) return [{ key: 'grid', label: 'Grid', type: 'group',
      toggles: [gridVisibility], controls: list }];
    const seen = new Set();
    const grouped = list.flatMap(control => {
      if (!control.section) return [control];
      if (seen.has(control.section)) return [];
      seen.add(control.section);
      return [{ key: `section-${control.section}`, label: control.section, type: 'group',
        controls: list.filter(child => child.section === control.section) }];
    });
    if (['editAxes', 'editXAxis', 'editYAxis'].includes(method)) {
      const position = grouped.findIndex(control => control.key === 'section-Position' || control.key === 'position' || control.path === 'position');
      if (position > 1) grouped.splice(1, 0, grouped.splice(position, 1)[0]);
    }
    const allControls = list.flatMap(c => c.type === 'group' ? c.controls : [c]);
    const switches = new Map(allControls.flatMap(c => c.toggles ?? []).map(toggle => [toggle.key, { ...toggle, caption: '' }]));
    if (!switches.size) return grouped;
    const without = (control, keys) => ({ ...control,
      toggles: control.toggles?.filter(toggle => !keys.includes(toggle.key)),
      ...(control.type === 'group' ? { controls: control.controls.map(child => without(child, keys)) } : {}),
    });
    const section = (key, label, children, toggleKey) => ({ key, label, type: 'group', controls: children,
      ...(switches.has(toggleKey) ? { toggles: [switches.get(toggleKey)] } : {}),
    });
    if (axisEditors.includes(method)) {
      const clean = allControls.map(c => without(c, ['guideVisible', 'labelsVisible', 'titlesVisible']));
      const labels = clean.filter(c => /Label size|Label offset/i.test(c.label));
      const positions = clean.filter(c => /position/i.test(c.label));
      const axes = clean.filter(c => !labels.includes(c) && !positions.includes(c));
      return [section('axes', 'Axes', axes, 'guideVisible'),
        ...(positions.length ? [section('section-Position', 'Position', positions)] : []),
        ...(labels.length ? [section('section-Labels', 'Labels', labels, 'labelsVisible')] : []),
        section('axis-titles', 'Titles', [], 'titlesVisible')];
    }
    if (method === 'editLegend') {
      return grouped.map(control => {
        const clean = without(control, ['guideVisible', 'labelsVisible', 'titlesVisible']);
        if (control.key === 'channel') return { ...clean, toggles: [switches.get('guideVisible')] };
        if (control.key !== 'appearance') return clean;
        return { ...clean, controls: clean.controls.map(child => child.key === 'fontSize'
          ? section('legend-labels', 'Labels', [child], 'labelsVisible') : child).concat(
          section('legend-title', 'Title', [], 'titlesVisible')) };
      });
    }
    return grouped;
  };
  const defaultDecisions = applyParameterDefaults(controls, build, recommendation);
  const defaults = valuesFor(groupControls(controls));
  const modes = controls.some(c => c.key === 'mode') ? ['fixed', 'variable'] : [undefined];
  for (const mode of modes) {
    const count = groupControls(controls.filter(c => !c.when || c.when({ ...defaults, mode }))).length;
    if (count > 4) throw new Error('Too many visible parameter groups.');
  }
  // Dependent numeric bounds and model controls share one pure contract. Hover
  // normalizes values; callers rerender control structure only after a click.
  const flat = list => list.flatMap(c => c.type === 'group' ? flat(c.controls) : [c]);
  const generic = recommendation.parameters ?? [];
  const channelIndex = generic.findIndex(p => p.path === 'channel');
  const thresholdIndex = generic.findIndex(p => p.path === 'value');
  const rangeIndices = ['range.0', 'range.1'].map(path => generic.findIndex(p => p.path === path));
  const facetIndices = ['rows.field', 'columns.field'].map(path => generic.findIndex(p => p.path === path));
  const parallelDimensionIndex = generic.findIndex(p => p.path === 'dimension');
  const parallelVariant = values => alternatives.find(a => a.args.dimension === values[`p${parallelDimensionIndex}`]);
  const channelVariant = values => alternatives.find(a => a.args.channel === values[`p${channelIndex}`]);
  resolve = values => {
    let resolved = controls.map(c => ({ ...c, ...(c.controls ? { controls: c.controls.map(child => ({ ...child })) } : {}) }));
    if (method === 'editLegend') resolved = resolved.map(control => control.key === 'entries'
      ? { ...control, controls: control.controls.map(child => child.key === 'maxItems'
        ? { ...child, max: Math.max(1, legendContextFor(values).itemCount ?? 30) } : child) } : control);
    if (recommendation.guideContext?.sharedFacetLegend) resolved = resolved.map(control => control.key === 'position' || control.path === 'position'
      ? { ...control, choices: control.choices.map(choice => ({ ...choice, disabled: choice.value.includes('-'),
        ...(choice.value.includes('-') ? { reason: 'A shared facet legend is placed outside the panels: left, right, top, or bottom.' } : {}) })) } : control);
    if (recommendation.guideContext?.colorScale?.fieldType === 'quantitative') {
      const context = recommendation.guideContext.colorScale;
      const domain = values.domainMode === 'custom' ? [values.domainMin, values.domainMax] : context.resolvedDomain;
      const epsilon = Math.max(Math.abs(domain?.[1] - domain?.[0]) || 0, .000001) / 1000;
      resolved = resolved.map(c => c.key === 'colorDomain' ? { ...c, controls: c.controls.map(child => child.key === 'midpoint'
        ? { ...child, min: domain[0] + epsilon, max: domain[1] - epsilon }
        : child.key === 'domainMin' ? { ...child, max: values.domainMax - epsilon, ...(values.scaleType === 'log' ? { min: epsilon } : {}) }
          : child.key === 'domainMax' ? { ...child, min: values.domainMin + epsilon } : child) } : c);
    }
    if (method === 'createStatisticalReference') {
      const axis = statisticAxis(values);
      const group = (axis?.populations.find(p => p.value === 'visibleItems')?.groups ?? recommendation.statisticalContext?.groupFields)?.find(field => field.name === values.groupBy);
      const requiresRows = recommendation.statisticalContext?.series || group?.visibleItems === false;
      resolved = resolved.map(c => c.key === 'population' ? { ...c, choices: (axis?.populations ?? c.choices).map(choice => choice.value === 'visibleItems'
        ? { ...choice, disabled: Boolean(choice.disabled || requiresRows || values.groupBy && !group), reason: requiresRows || values.groupBy && !group ? 'This grouping needs the bound rows because a visible mark can contain several group values.' : choice.reason } : choice) }
        : c.key === 'groupBy' && axis ? { ...c, choices: [{ value: '', label: 'None' }, ...statisticGroups(values).map(field => ({ value: field.name, label: field.name }))] } : c);
    }
    if (method === 'facet') resolved = resolved.map(c => c.key === 'columns' ? { ...c, max: Math.max(6, facetCount(values.field)) } : c);
    for (const [i, parameter] of generic.entries()) {
      if (parameter.rangeBy) {
        const index = generic.findIndex(p => p.path === parameter.rangeBy.path);
        const range = parameter.rangeBy.values[values[`p${index}`]];
        if (range) resolved[i] = { ...resolved[i], ...range };
      }
      if (!parameter.distinctFrom) continue;
      const other = generic.findIndex(p => p.path === parameter.distinctFrom);
      resolved[i] = { ...resolved[i], choices: resolved[i].choices.map(c => ({ ...c,
        disabled: c.value === values[`p${other}`], reason: c.value === values[`p${other}`] ? 'These roles must use different fields.' : undefined })) };
    }
    if (method === 'filterMarks' && channelIndex >= 0 && thresholdIndex >= 0) {
      const parameter = channelVariant(values)?.parameters?.find(p => p.path === 'value');
      if (parameter) resolved[thresholdIndex] = { ...resolved[thresholdIndex], min: parameter.min, max: parameter.max, step: parameter.step };
    }
    if (method === 'editParallelScale' && parallelDimensionIndex >= 0) {
      const variant = parallelVariant(values);
      resolved = resolved.map((control, i) => {
        const parameter = variant?.parameters?.find(p => p.path === generic[i].path);
        return parameter?.choices ? { ...control, choices: structuredClone(parameter.choices) } : control;
      });
    }
    if (method === 'facetGrid' && facetIndices.every(i => i >= 0)) {
      for (const [i, other] of [facetIndices, [...facetIndices].reverse()]) resolved[i] = { ...resolved[i], choices: resolved[i].choices.map(c => ({ ...c, disabled: c.value === values[`p${other}`], ...(c.value === values[`p${other}`] ? { reason: 'Rows and columns must use different fields.' } : {}) })) };
    }
    if (['encodeX', 'encodeY'].includes(method) && !generic.length) {
      const type = fields.get(values.field)?.type;
      const baseline = recommendation.positionScaleContext?.zeroBaseline?.[method === 'encodeX' ? 'x' : 'y'];
      const nonPositive = recommendation.positionScaleContext?.nonPositiveFields?.includes(values.field);
      const nonPositiveBin = recommendation.positionScaleContext?.nonPositiveBins?.[method === 'encodeX' ? 'x' : 'y']?.includes(values.field);
      resolved = resolved.map(c => c.key === 'scale' ? { ...c, choices: c.choices.map(o => ({ ...o,
        disabled: o.value !== 'auto' && type !== 'quantitative' || o.value === 'log' && Boolean(baseline || nonPositive || nonPositiveBin),
        reason: o.value !== 'auto' && type !== 'quantitative' ? 'This field uses a categorical or time scale.' : o.value === 'log' && baseline ? 'This mark requires a zero baseline. Use symlog to retain zero.' : o.value === 'log' && nonPositiveBin ? 'Bin boundaries include zero or negative values. Use symlog to retain them.' : o.value === 'log' && nonPositive ? 'Log requires a strictly positive field.' : undefined })) } : c);
    }
    if (['createRegression', 'editRegression'].includes(method) && recommendation.regressionContext) {
      const context = recommendation.regressionContext;
      const groupIndex = generic.findIndex(parameter => parameter.path === 'groupBy');
      const groupKey = method === 'editRegression' ? `p${groupIndex}` : 'group';
      const current = context.groups[(values[groupKey] ?? context.currentGroup) || ''];
      const modelKey = method === 'createRegression' ? 'method' : `p${generic.findIndex(parameter => parameter.path === 'method')}`;
      const degreeKey = method === 'createRegression' ? 'degree' : `p${generic.findIndex(parameter => parameter.path === 'degree')}`;
      const intervalKey = method === 'createRegression' ? 'interval' : `p${generic.findIndex(parameter => parameter.path === 'interval')}`;
      const resolveRegression = c => c.controls ? { ...c, controls: c.controls.map(resolveRegression) }
        : c.key === modelKey ? { ...c, choices: c.choices.map(choice => {
        const reason = current?.minDistinctX < 2 ? 'Each regression group needs more distinct X values for this model.'
          : choice.value === 'exp' && !current?.positiveY ? 'Exponential regression requires strictly positive Y values.'
          : choice.value === 'loess' && current?.loessWork > context.workLimit ? 'LOESS exceeds the computation budget for these rows. Choose grouped fits, linear, or polynomial regression.' : undefined;
        return { ...choice, disabled: Boolean(reason), reason };
      }) } : c.key === groupKey ? { ...c, choices: c.choices.map(choice => ({ ...choice,
        disabled: context.groups[choice.value || '']?.minDistinctX < 2,
        ...(context.groups[choice.value || '']?.minDistinctX < 2 ? { reason: 'Every group needs at least two distinct X values.' } : {}) })) }
        : c.key === degreeKey ? { ...c, max: Math.min(c.max, Math.max(1, (current?.minDistinctX ?? 7) - 1),
          Math.max(1, (current?.minRows ?? 8) - (values[intervalKey] === false ? 1 : 2))) }
        : c.key === intervalKey ? { ...c, choices: c.choices.map(choice => ({ ...choice, ...(choice.value !== false &&
          current?.minRows < (values[modelKey] === 'polynomial' ? (values[degreeKey] ?? 2) + 2 : 3) ? {
            disabled: true, reason: 'Each fit needs an additional observation to estimate an interval.',
          } : {}) })) } : c;
      resolved = resolved.map(resolveRegression);
    }
    if (['encodeColor', 'encodeStroke'].includes(method)) {
      resolved = resolved.map(c => c.key === 'palette' ? { ...c, choices: paletteChoices(fields.get(values.field)?.type, { auto: true }) } : c);
    }
    const numericControls = flat(resolved), lowKey = rangeIndices[0] >= 0 ? `p${rangeIndices[0]}` : 'min', highKey = rangeIndices[1] >= 0 ? `p${rangeIndices[1]}` : 'max';
    const low = numericControls.find(c => c.key === lowKey), high = numericControls.find(c => c.key === highKey);
    if (low && high) { low.max = Math.min(low.max, values[highKey]); high.min = Math.max(high.min, values[lowKey]); }
    return groupControls(resolved);
  };
  normalize = (input, changedKey) => {
    const values = { ...input };
    if (method === 'editLegend' && ['fontSize', 'itemGap', 'guideVisible', 'labelsVisible', 'titlesVisible'].includes(changedKey)) {
      values.legendEdits = [...new Set([...(values.legendEdits ?? []), changedKey])];
    }
    if (method === 'editLegend' && changedKey === 'channel') {
      values.legendEdits = [];
      const context = legendContextFor(values);
      values.guideVisible = context.visibility?.all !== false;
      values.labelsVisible = context.visibility?.labels !== false;
      values.titlesVisible = context.visibility?.titleStyle !== false;
      values.showAll = !context.overflow;
      values.maxItems = context.overflow?.maxItems ?? Math.min(6, context.itemCount ?? 6);
    }
    if (['createRegression', 'editRegression'].includes(method) && recommendation.regressionContext) {
      const create = method === 'createRegression';
      const key = path => create ? path === 'groupBy' ? 'group' : path : `p${generic.findIndex(parameter => parameter.path === path)}`;
      const group = recommendation.regressionContext.groups[(values[key('groupBy')] ?? recommendation.regressionContext.currentGroup) || ''];
      if (group && Number.isFinite(values[key('degree')])) values[key('degree')] = Math.min(values[key('degree')],
        Math.max(1, group.minDistinctX - 1), Math.max(1, group.minRows - (values[key('interval')] === false ? 1 : 2)));
    }
    if (method === 'createStatisticalReference') {
      const choices = controls.find(control => control.key === 'axis').choices;
      if (choices.some(choice => choice.value === values.axis && choice.disabled)) values.axis = choices.find(choice => !choice.disabled)?.value;
    }
    if (recommendation.guideContext?.colorScale?.fieldType === 'quantitative') {
      const context = recommendation.guideContext.colorScale;
      const domain = values.domainMode === 'custom' ? [values.domainMin, values.domainMax] : context.resolvedDomain;
      const span = Math.max(Math.abs(domain?.[1] - domain?.[0]) || 0, .000001), epsilon = span / 1000;
      if (values.domainMin >= values.domainMax) {
        if (changedKey === 'domainMax') values.domainMin = values.domainMax - epsilon;
        else values.domainMax = values.domainMin + epsilon;
      }
      if (values.scaleType === 'log' && values.domainMode === 'custom' && values.domainMin <= 0) values.domainMin = Math.min(values.domainMax / 2, epsilon);
      const current = values.domainMode === 'custom' ? [values.domainMin, values.domainMax] : domain;
      if (current?.length === 2) values.midpoint = Math.max(current[0] + epsilon, Math.min(current[1] - epsilon, values.midpoint));
    }
    if (method === 'createStatisticalReference' && statisticAxis(values)) {
      const axis = statisticAxis(values);
      if (!axis.populations.some(p => p.value === values.population && !p.disabled)) values.population = axis.defaultPopulation;
      if (values.groupBy && !statisticGroups(values).some(field => field.name === values.groupBy)) values.groupBy = '';
      const eligible = population => population && !population.disabled && (!values.groupBy || population.groups.some(field => field.name === values.groupBy &&
        (population.value !== 'visibleItems' || field.visibleItems)));
      if (!eligible(axis.populations.find(p => p.value === values.population))) {
        const compatible = axis.populations.find(eligible);
        if (compatible) values.population = compatible.value;
        else { values.groupBy = ''; values.population = axis.defaultPopulation; }
      }
    } else if (method === 'createStatisticalReference' && values.population === 'visibleItems' &&
        (recommendation.statisticalContext?.series || recommendation.statisticalContext?.groupFields?.some(field => field.name === values.groupBy && !field.visibleItems))) {
      values.population = 'boundData';
    }
    if (method === 'facet' && changedKey === 'field') values.columns = defaultFacetColumns(facetCount(values.field));
    for (const [i, parameter] of generic.entries()) {
      if (!parameter.distinctFrom) continue;
      const other = generic.findIndex(p => p.path === parameter.distinctFrom);
      if (values[`p${i}`] !== values[`p${other}`]) continue;
      const replace = changedKey === `p${i}` ? other : i;
      values[`p${replace}`] = generic[replace].choices.find(c => !c.disabled && c.value !== values[`p${i}`])?.value;
    }
    if (method === 'filterMarks' && changedKey === `p${channelIndex}` && thresholdIndex >= 0) {
      const variant = channelVariant(values); if (variant) values[`p${thresholdIndex}`] = variant.args.value;
    }
    if (method === 'editParallelScale' && changedKey === `p${parallelDimensionIndex}`) {
      const variant = parallelVariant(values);
      for (const [i, parameter] of generic.entries()) {
        if (!['type', 'domain'].includes(parameter.path)) continue;
        const source = variant?.parameters?.find(p => p.path === parameter.path);
        if (source) values[`p${i}`] = structuredClone(source.value);
      }
    }
    if (method === 'facetGrid' && facetIndices.every(i => i >= 0) && values[`p${facetIndices[0]}`] === values[`p${facetIndices[1]}`]) {
      const index = changedKey === `p${facetIndices[0]}` ? facetIndices[1] : facetIndices[0];
      values[`p${index}`] = controls[index].choices.find(c => c.value !== values[changedKey ?? `p${facetIndices[1]}`])?.value;
    }
    if (['encodeX', 'encodeY'].includes(method) && fields.get(values.field)?.type !== 'quantitative') values.scale = 'auto';
    const lowKey = rangeIndices[0] >= 0 ? `p${rangeIndices[0]}` : 'min', highKey = rangeIndices[1] >= 0 ? `p${rangeIndices[1]}` : 'max';
    if (Number.isFinite(values[lowKey]) && Number.isFinite(values[highKey]) && values[lowKey] > values[highKey]) {
      if (changedKey === lowKey) values[highKey] = values[lowKey]; else values[lowKey] = values[highKey];
    }
    for (const c of flat(resolve(values))) { if (c.type === 'select' && c.choices.some(choice => sameValue(choice.value, values[c.key]) && choice.disabled)) values[c.key] = c.choices.find(choice => !choice.disabled)?.value;
      if (c.key === 'palette' && !c.choices.some(choice => choice.value === values.palette)) values.palette = 'auto';
      if (c.type === 'number' && Number.isFinite(values[c.key])) values[c.key] = Math.max(c.min, Math.min(c.max, values[c.key])); }
    return values;
  };
  const rawBuild = build;
  build = values => rawBuild(normalize(values));
  return { controls: groupControls(controls), build, defaultDecisions, normalizeValues: normalize, resolveControls: resolve };
}

export function valuesFor(controls) {
  return Object.fromEntries(controls.flatMap(c => [
    ...(c.toggles ?? []).map(toggle => [toggle.key, toggle.value]),
    ...(c.type === 'group' ? Object.entries(valuesFor(c.controls)) : [[c.key, structuredClone(c.value)]]),
  ]));
}

export function activeControls(controls, values) {
  return controls.filter(c => !c.when || c.when(values))
    .flatMap(c => [
      ...(c.toggles ?? []).map(toggle => ({ ...toggle, type: 'select', choices: [
        { value: true, label: 'On' }, { value: false, label: 'Off' },
      ] })),
      ...(c.type === 'group' ? activeControls(c.controls, values) : [c]),
    ]);
}

// A card may group native calls for one user decision. Each selected option
// still resolves to exactly one real public method plus its native arguments.
export function buildRecommendationCall(editor, values) {
  const args = editor.build(values);
  // Retained cards must not restore a font captured before a toolbar change.
  // A card that actually exposes a font control, or an explicit theme recipe,
  // still owns that choice. Other domain edits inherit current typography.
  const fontControl = activeControls(editor.controls ?? [], values).some(control => /fontFamily/i.test(control.key));
  const inheritFont = value => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(inheritFont);
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'fontFamily')
      .map(([key, child]) => [key, key === 'theme' ? child : inheritFont(child)]));
  };
  return scopeRecommendationCall({ method: editor.parameterMethod ?? editor.method, args: fontControl ? args : inheritFont(args) }, editor.editingScope);
}
