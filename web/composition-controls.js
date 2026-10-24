import { editableChartTargets, chartAtPath, targetKey, inheritedCompositionShares } from '../src/composition-context.js';
import { profileDataset } from '../src/profile.js';
import { chartOwner } from '../src/chart-owner.js';
import { initialPositionBindings } from '../src/initial-scales.js';
import { overlayCandidates } from '../src/overlay-candidates.js';
import { initialParameters, recommendationParameters } from './parameters.js';

const fieldName = value => typeof value === 'string' ? value : value?.field;
const at = (object, path) => path.split('.').reduce((node, key) => node?.[key], object);
function write(object, path, value) {
  const keys = path.split('.'), last = keys.pop(); let node = object;
  for (const key of keys) { if (typeof node[key] === 'string') node[key] = { field: node[key] }; node = node[key] ??= {}; }
  node[last] = value;
}
const sharedChannels = adding => [...new Set([...(adding.share === 'none' ? [] : [adding.share]),
  ...(adding.inheritedSharing ?? []).flatMap(policy => policy.channels)])];

export function adjacentContext(program, context, position, fieldTypes) {
  const targets = editableChartTargets(program).filter(t => !t.overlay);
  const target = targets.find(t => targetKey(t) === targetKey({ childPath: context.childPath ?? [], id: context.target })) ?? targets[0];
  if (!target) throw new Error('Choose a source chart first.');
  const local = chartAtPath(program, target.childPath), layer = local.semanticSpec.layers.find(l => l.id === target.id);
  const data = chartOwner(local, layer)?.source ?? layer.data;
  const rows = local.semanticSpec.datasets.find(d => d.id === data)?.values;
  const profile = profileDataset(local, data, fieldTypes);
  const field = channel => profile.fields.find(f => f.name === layer.encoding[channel]?.field)?.name ?? '';
  const scales = Object.fromEntries(['x', 'y', 'color'].flatMap(channel => {
    const scale = local.semanticSpec.scales.find(scale => scale.id === layer.encoding[channel]?.scale);
    return scale ? [[channel, Object.fromEntries(Object.entries(scale).filter(([key]) => key !== 'id' &&
      (channel === 'color' || key !== 'range')))]] : [];
  }));
  return { ...target, position, rows, profile, selection: { x: field('x'), y: field('y'), color: field('color') },
    sourceSelection: { x: field('x'), y: field('y'), color: field('color') }, scales,
    inheritedSharing: inheritedCompositionShares(program, target.childPath),
    aggregation: layer.encoding.y?.aggregate, bins: layer.encoding.x?.bin?.maxBins,
    share: ['left', 'right'].includes(position) ? 'y' : 'x' };
}
export function adjacentSpecs(engine, adding, root) {
  const allIds = new Set(editableChartTargets(root).flatMap(t => [...t.childPath, t.id]));
  let id = 'chart2';
  for (let n = 3; allIds.has(id); n++) id = `chart${n}`;
  const shared = sharedChannels(adding), fields = new Map(adding.profile.fields.map(field => [field.name, field]));
  return engine.recommend(adding.rows, adding.profile, { selection: adding.selection }).recommendations.map(spec => {
    const inherited = { ...spec.values };
    for (const control of spec.controls) {
      if (/aggregate/i.test(control.key) && adding.aggregation && control.choices?.some(c => c.value === adding.aggregation)) inherited[control.key] = adding.aggregation;
      if (/bin/i.test(control.key) && control.type === 'number' && adding.bins) inherited[control.key] = adding.bins;
      const channel = ['x', 'y'].find(channel => control.key === `${channel}Scale`);
      if (channel && shared.includes(channel) && adding.scales[channel]) inherited[control.key] = adding.scales[channel].type;
    }
    const constrainControls = values => {
      const current = spec.resolveScaleControls?.(values) ?? [];
      return spec.controls.map(control => {
        const c = { ...control, ...(current.find(item => item.key === control.key) ?? {}) };
        const channel = ['x', 'y'].find(channel => c.key === `${channel}Scale`);
        if (!channel || !shared.includes(channel) || !adding.scales[channel]) return c;
        const type = adding.scales[channel].type;
        return { ...c, value: type, label: `${channel.toUpperCase()} scale · shared`,
          choices: c.choices.map(choice => ({ ...choice, ...(choice.value !== type ? { disabled: true,
            reason: `Shared ${channel.toUpperCase()} uses the source ${type} scale. Choose Share=None to use another scale, or edit the parent shared-scales policy.` } : {}) })) };
      });
    };
    const constrained = { ...spec, values: inherited, controls: constrainControls(inherited), resolveControls: constrainControls };
    const editor = initialParameters(constrained);
    const initialArgs = editor.build(inherited);
    const mismatch = shared.find(channel => ['x','y'].includes(channel) && adding.sourceSelection[channel] &&
      adding.selection[channel] !== adding.sourceSelection[channel]);
    const unavailable = shared.find(channel => ['x','y'].includes(channel) && initialArgs[channel] === undefined &&
      !initialPositionBindings(spec.method, initialArgs, fields).some(binding => binding.axis === channel));
    return { ...editor, method: 'createAdjacentPlot', chartChoice: true,
      ...(mismatch ? { requirement: `Shared ${mismatch.toUpperCase()} requires ${adding.sourceSelection[mismatch]}. Change the selected field or release sharing.` }
        : unavailable ? { requirement: `This chart does not expose a compatible ${unavailable.toUpperCase()} axis for sharing. Choose another chart or release sharing.` } : {}),
      title: `Add ${editor.title}`, original: { nextContext: { childPath: [...adding.childPath, id], target: id } },
      build: values => {
        const { id: _id, ...options } = editor.build(values);
        const bindings = initialPositionBindings(spec.method, options, fields);
        for (const channel of shared) {
          if (!adding.scales[channel]) continue;
          const paths = options[channel] !== undefined ? [`${channel}.scale`]
            : bindings.find(binding => binding.axis === channel)?.paths ?? [];
          for (const path of paths) write(options, path, { ...at(options, path), ...adding.scales[channel] });
        }
        return { id, source: adding.id, position: adding.position, plot: { action: spec.method, options },
          share: adding.share === 'none' ? {} : { [adding.share]: true }, align: 'plot',
          ...(['left', 'right'].includes(adding.position) ? { gap: 8 } : {}),
          ...(adding.childPath.length ? { target: { childPath: adding.childPath } } : {}) };
      },
      setup: values => (editor.setup?.(values) ?? []).map(call => ({ ...call, args: { ...call.args,
        ...(adding.childPath.length ? { target: { childPath: adding.childPath } } : {}) } })),
    };
  });
}

// Overlay creation is a deliberate chart-choice flow, independent of ranked actions.
export function overlayContext(program, context) {
  const targets = editableChartTargets(program);
  let source = targets.find(t => t.id === context.target && targetKey(t) === targetKey({ id: context.target, childPath: context.childPath ?? [] }));
  if (source?.overlay) {
    const local = chartAtPath(program, source.childPath);
    const id = local.semanticSpec.layers.find(l => l.id === source.id)?.derivedBindings.overlay.source;
    source = targets.find(t => t.id === id && JSON.stringify(t.childPath) === JSON.stringify(source.childPath));
  }
  if (!source || context.scope === 'all') source = targets.find(t => !t.overlay);
  if (!source) return null;
  const local = chartAtPath(program, source.childPath);
  const layer = local.semanticSpec.layers.find(l => l.id === source.id);
  const candidates = overlayCandidates(local, layer).filter(c => c.method === 'createOverlay');
  return candidates.length ? { kind: 'overlay', source, candidates, program: local, data: chartOwner(local, layer)?.source ?? layer.data } : null;
}
export function overlaySpecs(adding) {
  const profile = profileDataset(adding.program, adding.data);
  return adding.candidates.map(candidate => {
    const recommendation = { ...candidate, parameters: candidate.parameters.filter(p => p.path !== 'type') };
    const editor = recommendationParameters(recommendation, profile);
    const faceted = Boolean(adding.program.compositionSpec?.facet);
    return { ...editor, method: faceted ? 'editFacetSource' : 'createOverlay', chartChoice: true,
      title: candidate.args.type === 'line' ? 'Line overlay' : 'Point overlay',
      original: { nextContext: { childPath: adding.source.childPath, target: candidate.args.id } },
      build: values => ({ ...(faceted ? { action: { method: 'createOverlay', options: editor.build(values) } } : editor.build(values)),
        ...(adding.source.childPath.length ? { target: { childPath: adding.source.childPath } } : {}) }) };
  });
}

export function initializeCompositionControls({ select, overlayButton, host, adjacentHost, read, onTarget, onAdd, onOverlay, onChange, onCancel }) {
  const buttons = ['left', 'right', 'top', 'bottom'].map(position => {
    const button = document.createElement('button'); button.type = 'button'; button.className = `add-adjacent add-adjacent-${position}`;
    button.textContent = '+'; button.setAttribute('aria-label', `Add chart ${position}`); button.title = `Add chart ${position}`;
    button.addEventListener('click', () => onAdd(position)); host.append(button); return button;
  });
  overlayButton.addEventListener('click', onOverlay);
  return { refresh() {
    const { program, context, phase, committing, resizing, adding } = read();
    const ready = phase !== 'initial' && program, busy = committing || resizing;
    select.parentElement.hidden = !ready;
    const targets = ready ? editableChartTargets(program) : [];
    const current = context.scope === 'all' ? 'all' : JSON.stringify({ childPath: context.childPath ?? [], target: context.target });
    select.replaceChildren(...[{ label: 'All', value: 'all' }, ...targets.map(t => ({ label: t.label,
      value: JSON.stringify({ childPath: t.childPath, target: t.id }) }))].map(({ label, value }) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.setAttribute('aria-pressed', String(value === current)); button.disabled = busy || Boolean(adding);
      button.addEventListener('click', () => onTarget(value === 'all' ? { scope: 'all' } : JSON.parse(value)));
      return button;
    }));
    overlayButton.hidden = !ready;
    overlayButton.disabled = !ready || busy || Boolean(adding) || !overlayContext(program, context);
    overlayButton.title = overlayButton.disabled && ready && !busy && !adding ? 'Choose a Cartesian bar, line, area, or point chart to add an overlay.' : 'Add overlay';
    for (const button of buttons) { button.hidden = !ready || Boolean(adding); button.disabled = busy; }
    adjacentHost.hidden = !adding;
    adjacentHost.replaceChildren();
    if (!adding) return;
    if (adding.kind === 'overlay') {
      const heading = document.createElement('span'); heading.textContent = `Add overlay · ${adding.source.label}`;
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.disabled = busy;
      cancel.addEventListener('click', onCancel); adjacentHost.append(heading, cancel); return;
    }
    const heading = document.createElement('span'); heading.textContent = `Add chart ${adding.position}`; adjacentHost.append(heading);
    for (const channel of ['x', 'y', 'color']) {
      const label = document.createElement('label'); label.textContent = channel === 'color' ? 'Color' : channel.toUpperCase();
      const input = document.createElement('select'); input.setAttribute('aria-label', `Adjacent ${channel}`);
      const values = [...(channel === 'color' ? [''] : []), ...adding.profile.fields.filter(f => f.usable).map(f => f.name)];
      for (const field of values) {
        const option = document.createElement('option'); option.value = field; option.textContent = field || 'None';
        option.disabled = sharedChannels(adding).includes(channel) && Boolean(adding.sourceSelection?.[channel]) && field !== adding.sourceSelection[channel];
        if (option.disabled) option.title = `Shared ${channel.toUpperCase()} retains the source field; release its sharing policy to change it.`;
        input.append(option);
      }
      input.value = adding.selection[channel]; input.disabled = busy;
      input.addEventListener('change', () => onChange({ selection: { ...adding.selection, [channel]: input.value } }));
      label.append(input); adjacentHost.append(label);
    }
    const label = document.createElement('label'); label.textContent = 'Share';
    const share = document.createElement('select'); share.setAttribute('aria-label', 'Adjacent shared axis');
    for (const value of ['x', 'y', 'none']) { const option = document.createElement('option'); option.value = value; option.textContent = value === 'none' ? (adding.inheritedSharing?.length ? 'None (local)' : 'None') : value.toUpperCase(); share.append(option); }
    share.value = adding.share; share.disabled = busy; share.addEventListener('change', () => onChange({ share: share.value, selection: { ...adding.selection, ...(share.value !== 'none' && adding.sourceSelection?.[share.value] ? { [share.value]: adding.sourceSelection[share.value] } : {}) } })); label.append(share); adjacentHost.append(label);
    if (adding.inheritedSharing?.length) {
      const inherited = document.createElement('span'); inherited.className = 'adjacent-inherited-sharing'; inherited.setAttribute('role', 'note');
      inherited.textContent = `Inherited sharing: ${adding.inheritedSharing.map(policy => `${policy.channels.map(c => c.toUpperCase()).join(', ')} (${policy.label})`).join('; ')}. None changes local sharing only. Use Edit shared scales for that group to release it.`;
      adjacentHost.append(inherited);
    }
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.disabled = busy; cancel.addEventListener('click', onCancel); adjacentHost.append(cancel);
  } };
}
