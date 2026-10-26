import { guideMoveHistoryKey, resizeGuide, moveGuide, dockLegend, selectableGuides } from './guide-manipulation.js';
import { prepareGuidedAction } from './prepare.js';

// A normal grab moves the visible legend. Items are independent only after the
// user explicitly selects that scope; merely crossing their hit area is not a
// request to detach the body from its title.
export function guideDragTarget(guides, keys, grabbed) {
  if (grabbed.legendKey && grabbed.part && !keys.has(grabbed.key)) {
    return guides.find(target => target.key === grabbed.legendKey) ?? grabbed;
  }
  return grabbed;
}

// Resolve selection scopes to native owners before transforming. Facet copies,
// title/subtitle movement share owners. Legend body movement keeps its own scope.
export function manipulationTargets(guides, keys, grabbed, operation) {
  const selected = guides.filter(t => keys.has(t.key));
  const contains = (t, target) => t.key === target.key ||
    target.ids?.length && target.ids.every(id => t.ids?.includes(id)) ||
    t.members?.some(m => contains(m, target));
  const participating = selected.some(t => contains(t, grabbed) || t.key === grabbed.legendKey || t.legendKey === grabbed.key);
  const expand = t => t.members ? t.members.flatMap(expand) : [t];
  const candidates = (participating ? selected : [grabbed]).flatMap(expand)
    .filter(t => operation === 'move' ? t.movable : t.kind !== 'panel' && (t.resizable !== false || t.legendPart === 'items'));
  const owners = new Map();
  for (const target of candidates) {
    const owner = target.kind === 'legend' ? target.facetTarget
      ? guideMoveHistoryKey({ ...target, part: undefined }) : target.legendKey ?? target.key : guideMoveHistoryKey(target);
    const group = owners.get(owner) ?? [];
    if (operation === 'move' && target.kind !== 'legend') { if (!group.length) group.push(target); }
    else if (!target.part) { group.splice(0, group.length, target); }
    else if (!group.some(t => !t.part || t.part === target.part)) group.push(target);
    owners.set(owner, group);
  }
  return [...owners.values()].flat();
}

export function manipulationCalls(program, targets, operation, { factor, dx, dy, snapDistance }) {
  const records = targets.map(target => ({ target, call: operation === 'resize' ? resizeGuide(target, factor)
    : moveGuide(program, target, (target.bounds.left + target.bounds.right) / 2 + dx,
      (target.bounds.top + target.bounds.bottom) / 2 + dy,
      { dx, dy, snapDistance }) }));
  if (operation !== 'move') return records.map(record => record.call);
  const owner = t => JSON.stringify([t.childPath, Boolean(t.facetTarget), t.editTargets ?? t.config?.target]);
  const legends = selectableGuides(program).filter(t => t.kind === 'legend' && !t.part);
  const done = new Set(), calls = [];
  // Native group placement packs complete blocks and wraps rows. Applying
  // independent centered positions would put the selected blocks on each other.
  for (const record of records) {
    if (done.has(record)) continue;
    const peers = records.filter(r => r.call.dockKey && r.call.method === 'editLegend' &&
      r.call.args.position === record.call.args.position && owner(r.target) === owner(record.target));
    if (peers.length > 1 && peers.length === legends.filter(t => owner(t) === owner(record.target)).length) {
      peers.forEach(peer => done.add(peer));
      const args = { ...record.call.args, channel: 'all',
        blockLayout: ['top','bottom'].includes(record.call.args.position) ? 'wrap' : 'column',
        offset: dockLegend(program, record.target, record.call.args.position, record.call.args.align,
          new Set(peers.map(r => r.target.key))).args.offset,
        ...(peers.every(r => Number.isFinite(r.call.args.columns))
          ? { columns: Math.min(...peers.map(r => r.call.args.columns)) } : {}) };
      if (peers.some(r => !Number.isFinite(r.call.args.columns))) {
        delete args.columns; delete args.layout; delete args.titlePosition;
      }
      if (peers.some(r => r.call.args.direction === undefined)) delete args.direction;
      calls.push({ method: 'editLegend', args });
    } else { done.add(record); calls.push(record.call); }
  }
  // Local panels settle before a collected block measures its outside lane.
  return calls.sort((a,b) => Number(Boolean(records.find(r=>r.call===a)?.target.editTargets)) - Number(Boolean(records.find(r=>r.call===b)?.target.editTargets)));
}

// Atomic UI transaction composed exclusively of public ggaction functions.
// Only the final result is displayed/committed; a failure changes nothing.
export function prepareGuideEdits(program, view, actions) {
  const calls = []; let guideCall;
  for (let action of actions) {
    if (action.dockKey && calls.length) {
      const target = selectableGuides(view).find(t => t.key === action.dockKey);
      if (target) {
        // Recompute clearance after earlier selected blocks/panels moved.
        const options = action.method === 'editFacetSource' ? action.args.action.options : action.args;
        const probe = dockLegend(view, target, options.position, options.align);
        const offset = probe.method === 'editFacetSource' ? probe.args.action.options.offset : probe.args.offset;
        action = action.method === 'editFacetSource'
          ? { ...action, args: { ...action.args, action: { ...action.args.action, options: { ...options, offset } } } }
          : { ...action, args: { ...action.args, offset } };
      }
    }
    const prepared = prepareGuidedAction(program, { ...action, allowUnchanged: true }, view);
    calls.push(...prepared.prerequisiteCalls,
      { method: prepared.recommendation.method, args: prepared.recommendation.args }, ...prepared.postActionCalls);
    program = prepared.authoringPreview; view = prepared.preview; guideCall = prepared.guideCall;
  }
  return { program, view, guideCall, calls };
}
