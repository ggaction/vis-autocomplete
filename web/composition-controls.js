import { editableChartTargets, chartAtPath, targetKey } from '../src/composition-context.js';
import { profileDataset } from '../src/profile.js';
import { chartOwner } from '../src/chart-owner.js';
import { initialParameters } from './parameters.js';

export function adjacentContext(program, context, position, fieldTypes) {
  const targets = editableChartTargets(program).filter(t => !t.overlay);
  const target = targets.find(t => targetKey(t) === targetKey({ childPath: context.childPath ?? [], id: context.target })) ?? targets[0];
  if (!target) throw new Error('Choose a source chart first.');
  const local = chartAtPath(program, target.childPath), layer = local.semanticSpec.layers.find(l => l.id === target.id);
  const data = chartOwner(local, layer)?.source ?? layer.data;
  const rows = local.semanticSpec.datasets.find(d => d.id === data)?.values;
  const profile = profileDataset(local, data, fieldTypes);
  const field = channel => profile.fields.find(f => f.name === layer.encoding[channel]?.field)?.name ?? '';
  return { ...target, position, rows, profile, selection: { x: field('x'), y: field('y'), color: field('color') },
    aggregation: layer.encoding.y?.aggregate, bins: layer.encoding.x?.bin?.maxBins,
    share: ['left', 'right'].includes(position) ? 'y' : 'x' };
}
export function adjacentSpecs(engine, adding, root) {
  const allIds = new Set(editableChartTargets(root).flatMap(t => [...t.childPath, t.id]));
  let id = 'chart2';
  for (let n = 3; allIds.has(id); n++) id = `chart${n}`;
  return engine.recommend(adding.rows, adding.profile, { selection: adding.selection }).recommendations.map(spec => {
    const inherited = { ...spec.values };
    for (const control of spec.controls) {
      if (/aggregate/i.test(control.key) && adding.aggregation && control.choices?.some(c => c.value === adding.aggregation)) inherited[control.key] = adding.aggregation;
      if (/bin/i.test(control.key) && control.type === 'number' && adding.bins) inherited[control.key] = adding.bins;
    }
    const editor = initialParameters({ ...spec, values: inherited });
    return { ...editor, method: 'createAdjacentPlot', chartChoice: true,
      title: `Add ${editor.title}`, original: { nextContext: { childPath: [...adding.childPath, id], target: id } },
      build: values => {
        const { id: _id, ...options } = editor.build(values);
        return { id, source: adding.id, position: adding.position, plot: { action: spec.method, options },
          share: adding.share === 'none' ? {} : { [adding.share]: true }, align: 'plot',
          ...(adding.childPath.length ? { target: { childPath: adding.childPath } } : {}) };
      },
      setup: values => (editor.setup?.(values) ?? []).map(call => ({ ...call, args: { ...call.args,
        ...(adding.childPath.length ? { target: { childPath: adding.childPath } } : {}) } })),
    };
  });
}

export function initializeCompositionControls({ select, host, adjacentHost, read, onTarget, onAdd, onChange, onCancel }) {
  const buttons = ['left', 'right', 'top', 'bottom'].map(position => {
    const button = document.createElement('button'); button.type = 'button'; button.className = `add-adjacent add-adjacent-${position}`;
    button.textContent = '+'; button.setAttribute('aria-label', `Add chart ${position}`); button.title = `Add chart ${position}`;
    button.addEventListener('click', () => onAdd(position)); host.append(button); return button;
  });
  select.addEventListener('change', () => onTarget(select.value === 'all' ? { scope: 'all' } : JSON.parse(select.value)));
  return { refresh() {
    const { program, context, phase, committing, resizing, adding } = read();
    const ready = phase !== 'initial' && program, busy = committing || resizing;
    select.parentElement.hidden = !ready || Boolean(adding); select.disabled = busy;
    const targets = ready ? editableChartTargets(program) : [];
    select.replaceChildren(...[{ label: 'All', value: 'all' }, ...targets.map(t => ({ label: t.label,
      value: JSON.stringify({ childPath: t.childPath, target: t.id }) }))].map(({ label, value }) => {
      const option = document.createElement('option'); option.textContent = label; option.value = value; return option;
    }));
    select.value = context.scope === 'all' ? 'all' : JSON.stringify({ childPath: context.childPath ?? [], target: context.target });
    for (const button of buttons) { button.hidden = !ready || Boolean(adding); button.disabled = busy; }
    adjacentHost.hidden = !adding;
    adjacentHost.replaceChildren();
    if (!adding) return;
    const heading = document.createElement('span'); heading.textContent = `Add chart ${adding.position}`; adjacentHost.append(heading);
    for (const channel of ['x', 'y', 'color']) {
      const label = document.createElement('label'); label.textContent = channel === 'color' ? 'Color' : channel.toUpperCase();
      const input = document.createElement('select'); input.setAttribute('aria-label', `Adjacent ${channel}`);
      const values = [...(channel === 'color' ? [''] : []), ...adding.profile.fields.filter(f => f.usable).map(f => f.name)];
      for (const field of values) { const option = document.createElement('option'); option.value = field; option.textContent = field || 'None'; input.append(option); }
      input.value = adding.selection[channel]; input.disabled = busy;
      input.addEventListener('change', () => onChange({ selection: { ...adding.selection, [channel]: input.value } }));
      label.append(input); adjacentHost.append(label);
    }
    const label = document.createElement('label'); label.textContent = 'Share';
    const share = document.createElement('select'); share.setAttribute('aria-label', 'Adjacent shared axis');
    for (const value of ['x', 'y', 'none']) { const option = document.createElement('option'); option.value = value; option.textContent = value.toUpperCase(); share.append(option); }
    share.value = adding.share; share.disabled = busy; share.addEventListener('change', () => onChange({ share: share.value })); label.append(share); adjacentHost.append(label);
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.disabled = busy; cancel.addEventListener('click', onCancel); adjacentHost.append(cancel);
  } };
}
