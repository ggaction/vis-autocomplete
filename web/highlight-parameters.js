const choices = values => values.map(value => ({ value, label: String(value) }));
const select = (key, label, values, value) => ({ key, label, type: 'select', choices: choices(values), paged: values.length > 50, value });
const number = (key, label, value, min, max, step = 1) => ({ key, label, type: 'number', value, min, max, step });
const group = (key, label, controls) => ({ key, label, type: 'group', controls });

export function highlightParameters(rec) {
  const { args, highlightContext: context } = rec;
  const initial = args.select;
  const values = { selectionMode: initial.rows ? 'rows' : 'condition', grain: initial.grain ?? 'item', source: `${['field', 'channel', 'property'].find(k => initial[k] !== undefined)}:${initial.field ?? initial.channel ?? initial.property}`,
    op: initial.op, values: initial.values ?? [], value: initial.value, min: initial.min, max: initial.max,
    count: initial.count ?? 1, groupBy: initial.groupBy ?? '', ties: initial.ties ?? 'first',
    color: args.color ?? '#dc2626', opacity: args.opacity ?? 1, size: args.size ?? 2, fontSize: args.fontSize ?? 18, border: Boolean(args.stroke), stroke: args.stroke ?? '#000000', dash: args.strokeDash ?? 'solid', dx: args.offset?.x ?? 0, dy: args.offset?.y ?? 0,
    strokeWidth: args.strokeWidth ?? 3, shape: args.shape ?? '',
    dim: args.dimOthers !== false, dimOpacity: args.dimOthers?.opacity ?? .2, front: args.bringToFront !== false };
  const grainFor = v => context.grains.find(g => g.grain === v.grain) ?? context.grains[0];
  const sourceFor = v => grainFor(v).sources.find(s => s.key === v.source) ?? grainFor(v).sources[0];
  const ops = source => source.numeric ? ['max', 'min', 'range', 'gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'oneOf'] : ['oneOf', 'eq', 'neq'];
  function normalizeValues(input, changed) {
    const v = { ...values, ...input }, g = grainFor(v);
    v.grain = g.grain;
    const s = sourceFor(v); v.source = s.key;
    if (!ops(s).includes(v.op)) v.op = ops(s)[0];
    if (changed === 'source' || changed === 'grain') {
      v.value = s.values[0]; v.values = [s.values[0]]; v.min = undefined; v.max = undefined;
    }
    v.values = (v.values ?? []).filter(x => s.values.includes(x));
    if (!v.values.length) v.values = [s.values[0]];
    if (s.numeric ? !Number.isFinite(v.value) : !s.values.includes(v.value)) v.value = s.values[0];
    if (s.numeric) {
      const lo = s.values[0], hi = s.values.at(-1);
      v.min = Math.max(lo, Math.min(hi, v.min ?? lo)); v.max = Math.max(v.min, Math.min(hi, v.max ?? hi));
    }
    v.count = Math.max(1, Math.min(g.count, Math.round(v.count)));
    if (!g.sources.some(s => s.source === 'field' && s.name === v.groupBy)) v.groupBy = '';
    return v;
  }
  function resolveControls(input) {
    const v = normalizeValues(input), g = grainFor(v), s = sourceFor(v);
    const condition = [
      ...(context.grains.length > 1 ? [select('grain', 'Selection unit', context.grains.map(g => g.grain), v.grain)] : []),
      { ...select('source', 'Variable or channel', [], v.source), choices: g.sources.map(s => ({ value: s.key, label: s.label })) },
      select('op', 'Condition', ops(s), v.op)];
    if (v.op === 'oneOf') condition.push({ ...select('values', 'Values', s.values, v.values), type: 'multiselect', minimum: 1, selectAll: true });
    else if (['max', 'min'].includes(v.op)) condition.push(number('count', 'Number of items', v.count, 1, g.count),
      select('groupBy', 'Within each group', ['', ...g.sources.filter(s => s.source === 'field').map(s => s.name)], v.groupBy),
      select('ties', 'Ties', ['first', 'all'], v.ties));
    else if (v.op === 'range') condition.push(number('min', 'From', v.min, s.values[0], s.values.at(-1), Math.max((s.values.at(-1) - s.values[0]) / 100, .000001)), number('max', 'To', v.max, v.min, s.values.at(-1), Math.max((s.values.at(-1) - s.values[0]) / 100, .000001)));
    else condition.push(s.numeric ? number('value', 'Value', v.value, s.values[0], s.values.at(-1), Math.max((s.values.at(-1)-s.values[0])/100, .000001)) : select('value', 'Value', s.values, v.value));
    if (initial.rows) {
      if (v.selectionMode === 'rows') condition.length = 0;
      condition.unshift({...select('selectionMode','Select',['rows','condition'],v.selectionMode), choices:[{value:'rows',label:`Selected rows (${initial.rows.indices.length})`},{value:'condition',label:'Condition'}]});
    }
    const appearance = [{ key: 'color', label: 'Color', type: 'color', choices: choices(['#dc2626','#e67700','#2563eb','#7c3aed','#000000']), value: v.color }, number('opacity', 'Opacity', v.opacity, .05, 1, .05)];
    if (context.mark === 'point') appearance.push(number('size', 'Area multiplier', v.size, .25, 8, .25), select('shape', 'Shape', ['', 'circle', 'square', 'diamond', 'triangle-up', 'cross', 'star'], v.shape));
    if (['line', 'rule', 'tick'].includes(context.mark)) appearance.push(number('strokeWidth', 'Line width', v.strokeWidth, .25, 10, .25), select('dash','Line pattern',['solid','dashed','dotted'],v.dash));
    else if (context.mark === 'text') appearance.push(number('fontSize','Font size',v.fontSize,6,72));
    else appearance.push(select('border','Outline',[false,true],v.border), ...(v.border ? [{key:'stroke',label:'Outline color',type:'color',choices:choices(['#000000','#ffffff','#dc2626']),value:v.stroke},number('strokeWidth','Outline width',v.strokeWidth,0,10,.25)] : []));
    return [group('selection', 'Selection', condition), group('appearance', 'Appearance', appearance), ...(['bar'].includes(context.mark) ? [] : [group('offset','Offset',[number('dx','Horizontal',v.dx,-40,40,.5),number('dy','Vertical',v.dy,-40,40,.5)])]), group('context', 'Other marks', [
      select('dim', 'Dim other marks', [true, false], v.dim), ...(v.dim ? [number('dimOpacity', 'Other opacity', v.dimOpacity, 0, 1, .05)] : []),
      select('front', 'Bring to front', [true, false], v.front)])];
  }
  const build = input => {
    const v = normalizeValues(input), s = sourceFor(v);
    const predicate = { grain: v.grain, [s.source]: s.name, op: v.op,
      ...(v.op === 'oneOf' ? { values: v.values } : v.op === 'range' ? { min: v.min, max: v.max }
        : ['min', 'max'].includes(v.op) ? { count: v.count, ties: v.ties, ...(v.groupBy ? { groupBy: v.groupBy } : {}) } : { value: v.value }) };
    return { ...(args.id ? { id: args.id } : {}), target: args.target, select: initial.rows && v.selectionMode === 'rows' ? initial : predicate, color: v.color, opacity: v.opacity,
      ...(context.mark === 'point' ? { size: v.size, ...(v.shape ? { shape: v.shape } : {}) } : {}),
      ...(['line', 'rule', 'tick'].includes(context.mark) ? { strokeWidth: v.strokeWidth, strokeDash: v.dash } : context.mark==='text' ? {fontSize:v.fontSize} : v.border ? {stroke:v.stroke,strokeWidth:v.strokeWidth} : {}),
      ...(context.mark==='bar' ? {} : {offset:{x:v.dx,y:v.dy}}),
      dimOthers: v.dim ? { opacity: v.dimOpacity } : false, bringToFront: v.front };
  };
  const normalized = normalizeValues(values);
  return { values: normalized, controls: resolveControls(normalized), normalizeValues, resolveControls, build };
}
