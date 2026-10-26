const select = (key, label, choices, value) => ({ key, label, type: 'select', value,
  choices: choices.map(choice => typeof choice === 'string' ? { value: choice, label: choice } : choice), defaultPolicy: 'context' });
const number = (key, label, value, min, max) => ({ key, label, type: 'number', value, min, max, step: 1, defaultPolicy: 'context' });

export function valueLabelParameters(recommendation) {
  const { args, labelContext: context } = recommendation;
  const binding = values => context.bindings.find(binding => binding.key === values.label) ?? context.bindings[0];
  const current = args.format ?? 'auto', match = current.match(/^(,?)\.(\d+)([f%e])$/);
  const format = context.creating || current === 'auto' ? 'auto' : match ? match[3] : 'current';
  const controls = [select('label', 'Label', context.bindings.map(binding => ({ value: binding.key,
    label: recommendation.fieldLabels?.[binding.args.field] ?? binding.label })), context.initial),
    { key: 'numberFormat', label: 'Number format', type: 'group', when: values => binding(values).numeric, controls: [
      select('format', 'Format', [{ value: 'auto', label: 'Automatic' }, { value: 'f', label: 'Decimal' },
        { value: '%', label: 'Percent' }, { value: 'e', label: 'Scientific' },
        ...(!match && current !== 'auto' ? [{ value: 'current', label: current }] : [])], format),
      { ...number('decimals', 'Decimal places', Number(match?.[2] ?? 2), 0, 12),
        when: values => !['auto', 'current'].includes(values.format) },
    ] }];
  if (context.creating) controls.push(number('fontSize', 'Font size', args.fontSize ?? 11, 8, 18), {
    key: 'placement', label: 'Placement', type: 'group', controls: [
      ...(context.anchors.length ? [select('anchor', 'Position', context.anchors.map(value => ({ value, label: ({ center: 'Center',
        insideStart: 'Inside start', insideEnd: 'Inside end', outsideStart: 'Outside start', outsideEnd: 'Outside end' })[value] })), args.placement?.anchor ?? 'center'),
      number('gap', 'Gap', args.placement?.gap ?? 4, 0, 16)] : []),
      select('overlap', 'Overlap', [{ value: true, label: 'Reduce overlap', disabled: context.layout === false,
        ...(context.layout === false ? { reason: 'Automatic movement is limited to 1,000 labels. Shorten numbers or filter the chart first.' } : {}) },
        { value: false, label: 'Keep positions' }], args.layout !== false),
    ],
  });
  return { controls, build(values) {
    const selected = binding(values), out = { ...structuredClone(args) };
    for (const key of ['field', 'content', 'value', 'format', 'normalizeBy']) delete out[key];
    Object.assign(out, selected.args);
    if (selected.args.content === 'share' && args.normalizeBy) out.normalizeBy = args.normalizeBy;
    out.format = !selected.numeric ? 'auto' : values.format === 'auto' ? selected.automatic
      : values.format === 'current' ? current : `${values.format === 'f' && match?.[1] ? ',' : ''}.${Math.round(Math.max(0, Math.min(12, values.decimals)))}${values.format}`;
    if (context.creating) {
      out.fontSize = values.fontSize;
      if (context.anchors.length) out.placement = { ...out.placement, anchor: values.anchor, gap: values.gap };
      out.layout = values.overlap ? structuredClone(context.layout) : false;
      // One owner draws leader lines when automatic displacement is enabled.
      if (values.overlap && out.placement?.leader) out.placement.leader = false;
    }
    return out;
  } };
}
