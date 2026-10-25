import { selectionFields } from '../src/field-selection.js';
import { getPlotDefinitions, defaultValues } from '../src/plot-catalog.js';
import { editableChartTargetGroups, editableChartTargets, chartAtPath, targetKey, inheritedCompositionShares } from '../src/composition-context.js';
import { getDatasetSchema, getPlotComposition, describeAction } from 'ggaction/inspection';
import { profileDataset } from '../src/profile.js';
import { chartOwner } from '../src/chart-owner.js';
import { initialPositionBindings } from '../src/initial-scales.js';
import { axisValueMeaning, creationAxisMeanings, sameAxisMeaning } from '../src/axis-sharing.js';
import { overlayCandidates } from '../src/overlay-candidates.js';
import { adjacentPlacements, adjacentPlacementBounds, adjacentHandlePositions, placementLabel } from '../src/adjacent-placement.js';
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
const inheritedChannels = adding => [...new Set((adding.inheritedSharing ?? []).flatMap(policy => policy.channels))];

export function adjacentContext(program, context, position, fieldTypes, placementPath, source, previousSelection) {
  const placement = placementPath && adjacentPlacements(program).find(choice => JSON.stringify(choice.childPath) === JSON.stringify(placementPath));
  if (placementPath && !placement) throw new Error('The selected placement no longer exists.');
  const targets = placement?.sources ?? editableChartTargets(program).filter(t => !t.overlay);
  const selected = source ?? { childPath: context.childPath ?? [], id: context.target };
  const target = targets.find(t => targetKey(t) === targetKey(selected)) ??
    targets.find(t => JSON.stringify(t.childPath) === JSON.stringify(selected.childPath)) ?? targets[0];
  if (!target) throw new Error('Choose a source chart first.');
  const local = chartAtPath(program, target.childPath), layer = local.semanticSpec.layers.find(l => l.id === target.id);
  const composition = getPlotComposition(local,{target:layer.id});
  const data = composition.data;
  const rows = local.semanticSpec.datasets.find(d => d.id === data)?.values;
  const names = new Set(getDatasetSchema(local, { data }).schema.fields.map(field => field.name));
  const localTypes = Object.fromEntries(Object.entries(fieldTypes ?? {}).filter(([name]) => names.has(name)));
  const profile = profileDataset(local, data, localTypes);
  const channelRoles={x:composition.channels.x??composition.channels.theta,y:composition.channels.y??composition.channels.radius,color:composition.channels.color};
  const field = channel => profile.fields.find(f => f.name === channelRoles[channel]?.field)?.name ??
    (channel === 'color' ? '' : composition.dimensions?.[channel==='x'?0:1]?.field ??
      composition.channels.theta?.fields?.[channel==='x'?0:1] ?? '');
  const selectedFields={x:field('x'),y:field('y'),color:field('color')};
  if(selectedFields.x===selectedFields.y) selectedFields.y=profile.fields.find(f=>f.usable&&f.name!==selectedFields.x&&f.type==='quantitative')?.name??'';
  const scales = Object.fromEntries(['x', 'y', 'color'].flatMap(channel => {
    const scale = local.semanticSpec.scales.find(scale => scale.id === channelRoles[channel]?.scale);
    return scale ? [[channel, Object.fromEntries(Object.entries(scale).filter(([key]) => key !== 'id' &&
      (channel === 'color' || key !== 'range')))]] : [];
  }));
  if (scales.color?.range?.palette) {
    scales.color.palette = scales.color.range.palette;
    delete scales.color.range;
  }
  const receivingPath = placement?.childPath ?? target.childPath;
  const datasets = local.semanticSpec.datasets;
  const axisMeanings = Object.fromEntries(['x', 'y'].map(axis => [axis, composition.channels[axis]?.field ? {field:composition.channels[axis].field,operations:composition.channels[axis].measurement.operations} : null]));
  return { ...target, receivingPath, placementLabel: placement?.label ?? target.label,
    sources: placement?.sources ?? [target], grouped: placement?.grouped ?? false,
    position, rows, profile, selection: { fields: [...new Set([
      ...selectionFields(previousSelection), ...Object.values(selectedFields),
      ...(composition.dimensions ?? []).map(d => d.field),
      ...(composition.channels.theta?.fields ?? [])
    ].filter(name => profile.fields.some(f => f.name === name && f.usable)))] },
    sourceSelection: selectedFields, scales, datasets, axisMeanings,
    inheritedSharing: inheritedCompositionShares(program, receivingPath),
    aggregation: axisMeanings.y?.operations.at(-1) ?? axisMeanings.x?.operations.at(-1), bins: layer.encoding.x?.bin?.maxBins,
    share: ['left', 'right'].includes(position) ? 'y' : 'x' };
}
export function adjacentSpecs(engine, adding, root) {
  const receivingPath = adding.receivingPath ?? adding.childPath;
  const allIds = new Set(editableChartTargets(root).flatMap(t => [...t.childPath, t.id]));
  let id = 'chart2';
  for (let n = 3; allIds.has(id); n++) id = `chart${n}`;
  const shared = sharedChannels(adding), fields = new Map(adding.profile.fields.map(field => [field.name, field]));
  return engine.recommend(adding.rows, adding.profile, { selection: adding.selection }).recommendations.map(spec => {
    const editor = initialParameters(spec);
    const flat = controls => controls.flatMap(c => c.type === 'group' ? flat(c.controls) : [c]);
    const inherited = { ...editor.values };
    // Preserve the source arrangement as the starting proposal when the chart
    // supports it. These are card-level choices, not roles in field selection.
    for (const channel of ['x', 'y', 'color']) {
      const key = `mapping_${channel}`, control = flat(editor.resolveControls(inherited)).find(c => c.key === key);
      if (control?.choices.some(choice => choice.value === adding.sourceSelection[channel] && !choice.disabled)) {
        Object.assign(inherited, editor.normalizeValues({ ...inherited, [key]: adding.sourceSelection[channel], __previousMapping: inherited }, key));
      }
    }
    Object.assign(inherited, editor.normalizeValues(inherited));
    const compatibleChannels = values => {
      const meanings = creationAxisMeanings(spec.method, editor.build(values), fields, adding.datasets, editor.setup?.(values));
      return shared.filter(channel => !['x', 'y'].includes(channel) || sameAxisMeaning(adding.axisMeanings[channel], meanings[channel]));
    };
    const effectiveChannels = values => [...new Set([...compatibleChannels(values), ...inheritedChannels(adding)])];
    for (const control of flat(editor.resolveControls(inherited))) {
      if (/palette/i.test(control.key) && control.choices?.some(c => c.value === adding.scales.color?.palette)) inherited[control.key] = adding.scales.color.palette;
      if (/aggregate/i.test(control.key) && adding.aggregation && control.choices?.some(c => c.value === adding.aggregation)) inherited[control.key] = adding.aggregation;
      if (/bin/i.test(control.key) && control.type === 'number' && adding.bins) inherited[control.key] = adding.bins;
    }
    const normalizeValues = (values, key) => {
      const normalized = editor.normalizeValues(values, key);
      for (const channel of effectiveChannels(normalized)) {
        if (['x', 'y'].includes(channel) && adding.scales[channel] && `${channel}Scale` in normalized) normalized[`${channel}Scale`] = adding.scales[channel].type;
      }
      return normalized;
    };
    Object.assign(inherited, normalizeValues(inherited));
    const constrainControls = values => {
      const sharing = effectiveChannels(values);
      const visit = controls => controls.map(c => {
        if (c.type === 'group') return { ...c, controls: visit(c.controls) };
        const channel = ['x', 'y'].find(channel => c.key === `${channel}Scale`);
        if (!channel || !sharing.includes(channel) || !adding.scales[channel]) return c;
        const type = adding.scales[channel].type;
        return { ...c, value: type, label: `${channel.toUpperCase()} scale · shared`,
          choices: c.choices.map(choice => ({ ...choice, ...(choice.value !== type ? { disabled: true,
            reason: `Shared ${channel.toUpperCase()} uses the source ${type} scale. Use Edit shared scales to change the sharing policy.` } : {}) })) };
      });
      return visit(editor.resolveControls(values));
    };
    const initialArgs = editor.build(inherited);
    const required = inheritedChannels(adding);
    const unavailable = required.find(channel => ['x','y'].includes(channel) && initialArgs[channel] === undefined &&
      !initialPositionBindings(spec.method, initialArgs, fields).some(binding => binding.axis === channel));
    const inheritedMismatch = required.find(channel => ['x', 'y'].includes(channel) && !compatibleChannels(inherited).includes(channel));
    return { ...editor, values: inherited, normalizeValues, controls: constrainControls(inherited), resolveControls: constrainControls,
      method: 'createAdjacentPlot', chartChoice: true,
      ...(unavailable ? { requirement: `This chart does not expose a compatible ${unavailable.toUpperCase()} axis for sharing. Choose another chart or release sharing.` }
          : inheritedMismatch ? { requirement: `The parent group already shares ${inheritedMismatch.toUpperCase()}. Use the same aggregation or release that group's shared scale first.` } : {}),
      title: `Add ${editor.title}`, original: { nextContext: { childPath: [...receivingPath, id], target: id } },
      build: values => {
        values = normalizeValues(values);
        const { id: _id, ...options } = editor.build(values);
        const compatible = compatibleChannels(values), sharing = effectiveChannels(values);
        const inheritedMismatch = required.find(channel => ['x', 'y'].includes(channel) && !compatible.includes(channel));
        if (inheritedMismatch) throw new Error(`The parent group already shares ${inheritedMismatch.toUpperCase()}. Use the same field and aggregation, or release that group's shared scale first.`);
        const bindings = initialPositionBindings(spec.method, options, fields);
        for (const channel of sharing) {
          if (!adding.scales[channel]) continue;
          const paths = options[channel] !== undefined ? [`${channel}.scale`]
            : bindings.find(binding => binding.axis === channel)?.paths ?? [];
          for (const path of paths) write(options, path, { ...at(options, path), ...adding.scales[channel] });
        }
        const color = options.color;
        const shareColor = adding.sourceSelection.color &&
          fieldName(color) === adding.sourceSelection.color &&
          (color.scale?.palette ?? adding.scales.color?.palette) === adding.scales.color?.palette;
        if (shareColor && typeof color === 'object') color.scale = { ...adding.scales.color, ...color.scale };
        return { id, source: adding.grouped ? { childPath: adding.childPath.slice(receivingPath.length), id: adding.id } : adding.id,
          position: adding.position, plot: { action: spec.method, options },
          share: { ...(adding.share === 'none' || !compatible.includes(adding.share) ? {} : { [adding.share]: true }), ...(shareColor ? { color: true } : {}) }, align: 'plot',
          ...(['left', 'right'].includes(adding.position) ? { gap: 8 } : {}),
          ...(receivingPath.length ? { target: { childPath: receivingPath } } : {}) };
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
  const composition=getPlotComposition(local,{target:layer.id});
  if(composition.role==='pie')return null;
  return { kind:'overlay', mode:'layer', source, candidates, program:local, composition, data:composition.data };
}
export function overlaySpecs(adding, engine) {
  const profile = profileDataset(adding.program, adding.data);
  if(adding.mode === 'layer') return layerSpecs(adding,profile,engine);
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

// Constructor cards keep native geometry/statistical controls. Source roles and
// shared scales come from ggaction, not another list of chart-specific guesses.
function layerSpecs(adding,profile,engine) {
  const used=new Set([...adding.program.semanticSpec.layers.map(l=>l.id),
    ...Object.values(adding.program.markConfigs).map(c=>c.raincloudPlot?.id).filter(Boolean)]);
  let id='layer'; for(let n=2;used.has(id);n++)id=`layer${n}`;
  const definitions=engine ? engine.recommend(adding.program.semanticSpec.datasets.find(d=>d.id===adding.data).values,profile).recommendations
    : getPlotDefinitions(profile).map(d=>({...d,values:defaultValues(d)}));
  const fieldKeys=new Set(['x','y','color','category','value','end','field','theta','radius','dimensions','wide','groupBy','orientation']);
  const fieldNames=new Set(profile.fields.map(f=>f.name));
  return definitions.flatMap(spec=>{
    const controls=spec.controls.filter(c=>!fieldKeys.has(c.key)&&c.section!=='scales'&&
      !/scale|palette/i.test(c.key)&&(c.key==='start'||!c.choices?.some(choice=>fieldNames.has(choice.value)))&&
      !(adding.composition.channels.x?.bin&&/bin/i.test(c.key))).slice(0,3).map(c=>({...c}));
    controls.push({key:'placement',label:'Placement',type:'select',value:'front',choices:[{value:'front',label:'In front'},{value:'back',label:'Behind'}]});
    const values={...spec.values,placement:'front'};
    const measureAxis=['nominal','ordinal'].includes(adding.composition.channels.y?.fieldType)?'x':'y';
    const start=controls.find(control=>control.key==='start');
    if(start) values.start=start.choices.find(choice=>choice.value!==adding.composition.channels[measureAxis]?.field)?.value??values.start;
    if(spec.method==='createRugPlot'&&['nominal','ordinal'].includes(adding.composition.channels.x?.fieldType)) values.edge='left';
    const aggregation=adding.composition.channels.y?.measurement.operations.at(-1)??adding.composition.channels.x?.measurement.operations.at(-1)??adding.composition.channels.radius?.measurement.operations.at(-1)??adding.composition.channels.theta?.measurement.parameters?.aggregate;
    for(const c of controls) if(/aggregate/i.test(c.key)) {
      const compatibleDefault=c.choices?.some(choice=>choice.value===aggregation)?aggregation:
        adding.composition.channels[measureAxis]?.measurement.unit==='value'&&c.choices?.some(choice=>choice.value==='mean')?'mean':undefined;
      if(compatibleDefault!==undefined) values[c.key]=compatibleDefault;
    }
    const build=values=>{
      const original=spec.build({...spec.values,...values}), options={};
      for(const [key,value] of Object.entries(original)) {
        if(['id','data','coordinate','guides',...fieldKeys].includes(key))continue;
        if(adding.composition.channels.x?.bin&&['maxBins','binStep','binBoundaries'].includes(key))continue;
        options[key]=value;
      }
      // Keep deliberate summary controls; omitting field roles lets the native
      // constructor planner infer the original variables and orientation.
      for(const axis of ['x','y']) {
        if(typeof original[axis]!=='object'||!original[axis])continue;
        const role=Object.fromEntries(Object.entries(original[axis]).filter(([key])=>!['field','fieldType','scale','bin','temporalUnit'].includes(key)));
        if(role.aggregate && !controls.some(control=>/aggregate/i.test(control.key)))delete role.aggregate;
        if(Object.keys(role).length) options[role.aggregate||role.center||role.extent?measureAxis:axis]=role;
      }
      return {id,source:adding.source.id,plot:{action:spec.method,options},placement:values.placement};
    };
    let args,description;
    try {args=build(values);description=describeAction(adding.program,{action:'createLayerPlot',options:args});}
    catch{return [];}
    if(['incompatible','unsupported','needs-input'].includes(description.applicability))return [];
    const faceted=Boolean(adding.program.compositionSpec?.facet);
    for(const c of controls)c.value=values[c.key];
    return [initialParameters({...spec,controls,values,setup:undefined,requirement:undefined,
      resolveControls:values=>controls.map(c=>({...c,...(c.choices?{choices:c.choices.map(choice=>{
        const result=describeAction(adding.program,{action:'createLayerPlot',options:build({...values,[c.key]:choice.value})});
        return {...choice,...(['incompatible','unsupported','needs-input'].includes(result.applicability)?{disabled:true,reason:result.findings[0]?.message}:{})};
      })}:{})})),resolveScaleControls:undefined,
      method:faceted?'editFacetSource':'createLayerPlot',chartChoice:true,title:`${spec.title} layer`,
      original:{nextContext:{childPath:adding.source.childPath,target:spec.method==='createRaincloudPlot'?`${id}Cloud`:id}},
      build:values=>({... (faceted?{action:{method:'createLayerPlot',options:build(values)}}:build(values)),
        ...(adding.source.childPath.length?{target:{childPath:adding.source.childPath}}:{})})})];
  });
}

export function initializeCompositionControls({ select, overlayButton, host, adjacentHost, read, onTarget, onAdd, onOverlay, onChange, onCancel }) {
  let highlight, revision, placements = [], bounds, buttons = [], frame, available = false, pointer, positioned = [];
  const clearHighlight = () => { highlight?.remove(); highlight = null; };
  function revealNearby() {
    const nearest = pointer && available ? positioned.reduce((best, item) => {
      const distance = Math.hypot(item.x - pointer.x, item.y - pointer.y);
      return distance <= 48 && (!best || distance < best.distance) ? { ...item, distance } : best;
    }, null) : null;
    for (const button of buttons) button.classList.toggle('nearby', button === nearest?.button);
  }
  function viewport() {
    const canvas = host.querySelector('.canvas-stage > canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect(), shell = host.getBoundingClientRect();
    const scale = rect.width / Number(canvas.dataset.logicalWidth);
    return Number.isFinite(scale) && scale > 0 ? { scale, left: rect.left - shell.left, top: rect.top - shell.top } : null;
  }
  function mark(choice) {
    clearHighlight();
    const box = bounds?.get(JSON.stringify(choice.childPath)), view = viewport();
    if (!box || !view) return;
    highlight = document.createElement('div'); highlight.className = 'adjacent-placement-highlight';
    Object.assign(highlight.style, { left: `${view.left + box.x * view.scale}px`, top: `${view.top + box.y * view.scale}px`,
      width: `${box.width * view.scale}px`, height: `${box.height * view.scale}px` });
    host.append(highlight);
  }
  function layout() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const view = viewport();
      if (!view || !bounds) return;
      const handles = adjacentHandlePositions(placements, bounds, view, { width: host.clientWidth, height: host.clientHeight });
      positioned = [];
      for (const button of buttons) {
        const handle = handles.find(item => item.position === button.dataset.position && JSON.stringify(item.choice.childPath) === button.dataset.childPath);
        button.hidden = !available || !handle;
        if (handle) {
          Object.assign(button.style, { left: `${handle.x - 13}px`, top: `${handle.y - 13}px` });
          positioned.push({ ...handle, button });
        }
      }
      revealNearby();
    });
  }
  new ResizeObserver(layout).observe(host);
  host.addEventListener('pointerenter', layout);
  host.addEventListener('pointermove', event => {
    const box = host.getBoundingClientRect();
    pointer = event.target.closest('.resize-handle, [data-guide-operation]') ? null : { x: event.clientX - box.left, y: event.clientY - box.top };
    revealNearby();
  });
  host.addEventListener('pointerleave', () => { pointer = null; revealNearby(); clearHighlight(); });
  function refreshHandles(state, ready, busy) {
    const displayed = state.view ?? state.program;
    if (revision !== displayed) {
      clearHighlight(); buttons.forEach(button => button.remove()); buttons = [];
      revision = displayed;
      placements = ready ? adjacentPlacements(state.program) : [];
      bounds = ready ? adjacentPlacementBounds(displayed) : null;
      for (const position of ['left', 'right', 'top', 'bottom']) for (const choice of placements) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'add-adjacent'; button.textContent = '+';
        button.hidden = true;
        button.dataset.position = position; button.dataset.childPath = JSON.stringify(choice.childPath);
        button.dataset.grouped = String(choice.grouped);
        const label = `Add chart ${position}${placements.length > 1 ? `: ${choice.label}` : ''}`;
        button.setAttribute('aria-label', label); button.title = placementLabel(position, choice.label);
        button.addEventListener('pointerenter', () => mark(choice));
        button.addEventListener('pointerleave', clearHighlight);
        button.addEventListener('focus', () => mark(choice)); button.addEventListener('blur', clearHighlight);
        button.addEventListener('click', () => { clearHighlight(); onAdd(position, choice.childPath); });
        host.append(button); buttons.push(button);
      }
    }
    available = Boolean(ready && !busy && state.adding?.kind !== 'overlay');
    for (const button of buttons) {
      if (!available) button.hidden = true;
      button.disabled = busy;
      button.setAttribute('aria-pressed', String(Boolean(state.adding && state.adding.position === button.dataset.position &&
        JSON.stringify(state.adding.receivingPath) === button.dataset.childPath)));
    }
    if (!ready || busy) clearHighlight();
    layout();
  }
  overlayButton.addEventListener('click', onOverlay);
  document.addEventListener('pointerdown', event => {
    const picker = adjacentHost.querySelector('.adjacent-field-picker[open]');
    if (picker && !picker.contains(event.target)) picker.open = false;
  });
  return { layout, refresh() {
    const { program, context, phase, committing, resizing, adding } = read();
    const ready = phase !== 'initial' && program, busy = committing || resizing;
    refreshHandles(read(), ready, busy);
    select.parentElement.hidden = !ready;
    const groups = ready ? editableChartTargetGroups(program) : [];
    const current = context.scope === 'all' ? 'all' : JSON.stringify({ childPath: context.childPath ?? [], target: context.target });
    const targetButton = (label, value, description) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.title = description;
      button.setAttribute('aria-pressed', String(value === current)); button.disabled = busy || Boolean(adding);
      button.addEventListener('click', () => onTarget(value === 'all' ? { scope: 'all' } : JSON.parse(value)));
      return button;
    };
    const all = targetButton('All', 'all', 'Edit all charts and overlays');
    all.className = 'target-all';
    select.replaceChildren(all, ...groups.map((group, index) => {
      const container = document.createElement('div'); container.className = 'target-chart-group';
      container.setAttribute('role', 'group');
      const description = group.targets.map(target => `${target.label}${target.overlay ? ' overlay' : ''}`).join(' + ');
      container.setAttribute('aria-label', `Chart ${index + 1}: ${description}`);
      container.dataset.childPath = JSON.stringify(group.childPath);
      for (const target of group.targets) {
        const button = targetButton(target.label, JSON.stringify({ childPath: target.childPath, target: target.id }),
          `${target.label}${target.overlay ? ' overlay' : ''} · Chart ${index + 1}`);
        button.dataset.overlay = String(target.overlay);
        container.append(button);
      }
      return container;
    }));
    overlayButton.hidden = !ready;
    overlayButton.disabled = !ready || busy || Boolean(adding) || !overlayContext(program, context);
    overlayButton.title = overlayButton.disabled && ready && !busy && !adding ? 'Choose a source chart to add a layer.' : 'Add overlay';
    adjacentHost.hidden = !adding;
    adjacentHost.replaceChildren();
    if (!adding) return;
    if (adding.kind === 'overlay') {
      const heading = document.createElement('span'); heading.textContent = `Add overlay · ${adding.source.label}`;
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.disabled = busy;
      cancel.addEventListener('click', onCancel);
      const modes=document.createElement('div');modes.className='overlay-modes';
      for(const [mode,label] of [['layer','Layer chart'],['follow','Follow results']]) {
        const button=document.createElement('button');button.type='button';button.textContent=label;
        button.setAttribute('aria-pressed',String(adding.mode===mode));button.disabled=busy||(mode==='follow'&&!adding.candidates.length);
        button.addEventListener('click',()=>onChange({mode}));modes.append(button);
      }
      adjacentHost.append(heading,modes,cancel); return;
    }
    const heading = document.createElement('span');
    if (adding.sources?.length > 1) {
      const label = document.createElement('label'); label.className = 'adjacent-source'; label.textContent = 'Data from';
      const input = document.createElement('select'); input.setAttribute('aria-label', 'Adjacent data source'); input.disabled = busy;
      for (const source of adding.sources) {
        const option = document.createElement('option'); option.value = targetKey(source); option.textContent = source.label; input.append(option);
      }
      input.value = targetKey(adding);
      input.addEventListener('change', () => onAdd(adding.position, adding.receivingPath, adding.sources.find(source => targetKey(source) === input.value)));
      label.append(input); heading.append(label); adjacentHost.append(heading);
    }
    const variables = document.createElement('div'); variables.className = 'adjacent-fields';
    variables.setAttribute('role', 'group'); variables.setAttribute('aria-label', 'Adjacent variables');
    const selected = selectionFields(adding.selection);
    for (const field of selected) {
      const chip = document.createElement('span'); chip.className = 'adjacent-field';
      const name = document.createElement('span'); name.textContent = field; name.title = field;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '−';
      remove.setAttribute('aria-label', `Remove variable ${field}`); remove.disabled = busy;
      remove.addEventListener('click', () => onChange({ selection: { fields: selected.filter(name => name !== field) } }));
      chip.append(name, remove); variables.append(chip);
    }
    const picker = document.createElement('details'); picker.className = 'adjacent-field-picker';
    const toggle = document.createElement('summary'); toggle.textContent = '+'; toggle.setAttribute('aria-label', 'Add variable');
    const menu = document.createElement('div'); menu.className = 'adjacent-field-menu';
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Find a variable';
    search.setAttribute('aria-label', 'Find an adjacent variable'); menu.append(search);
    const choices = [];
    for (const field of adding.profile.fields.filter(field => field.usable && !selected.includes(field.name))) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = field.name;
      button.disabled = busy; button.setAttribute('aria-label', `Add variable ${field.name}`);
      button.addEventListener('click', () => onChange({ selection: { fields: [...selected, field.name] } }));
      menu.append(button); choices.push(button);
    }
    if (!choices.length) { const empty = document.createElement('span'); empty.textContent = 'All variables selected'; menu.append(empty); }
    search.addEventListener('input', () => choices.forEach(button => { button.hidden = !button.textContent.toLowerCase().includes(search.value.toLowerCase()); }));
    picker.addEventListener('toggle', () => {
      if (!picker.open) return;
      const edge = adjacentHost.getBoundingClientRect().right;
      menu.style.left = '0px';
      menu.style.left = `${Math.min(0, edge - menu.getBoundingClientRect().right)}px`;
      search.focus();
    });
    picker.addEventListener('keydown', event => { if (event.key === 'Escape') { picker.open = false; toggle.focus(); } });
    toggle.addEventListener('click', event => { if (busy) event.preventDefault(); });
    picker.append(toggle, menu); variables.append(picker); adjacentHost.append(variables);
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.disabled = busy; cancel.addEventListener('click', onCancel); adjacentHost.append(cancel);
  } };
}
