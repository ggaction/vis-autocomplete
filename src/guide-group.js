import { guideMoveHistoryKey, resizeGuide, moveGuide } from './guide-manipulation.js';
import { prepareGuidedAction } from './prepare.js';

// Resolve selection scopes to native owners before transforming. Facet copies,
// title/subtitle movement, and a legend selected through its items share owners.
export function manipulationTargets(guides, keys, grabbed, operation) {
  const selected = guides.filter(t => keys.has(t.key));
  const contains = (t, target) => t.key === target.key ||
    target.ids?.length && target.ids.every(id => t.ids?.includes(id)) ||
    t.members?.some(m => contains(m, target));
  const participating = selected.some(t => contains(t, grabbed) || t.key === grabbed.legendKey || t.legendKey === grabbed.key);
  const expand = t => t.members ? t.members.flatMap(expand) : [t];
  const candidates = (participating ? selected : [grabbed]).flatMap(expand)
    .map(t => operation === 'move' ? t.moveTarget ?? t : t)
    .filter(t => operation === 'move' ? t.movable : t.kind !== 'panel' && (t.resizable !== false || t.legendPart === 'items'));
  const owners = new Map();
  for (const target of candidates) {
    const owner = target.kind === 'legend' ? target.legendKey ?? target.key : guideMoveHistoryKey(target);
    const group = owners.get(owner) ?? [];
    if (operation === 'move') { if (!group.length) group.push(target); }
    else if (!target.part) { group.splice(0, group.length, target); }
    else if (!group.some(t => !t.part || t.part === target.part)) group.push(target);
    owners.set(owner, group);
  }
  return [...owners.values()].flat();
}

export function manipulationCalls(program, targets, operation, { factor, dx, dy, snapDistance }) {
  return targets.map(target => operation === 'resize' ? resizeGuide(target, factor)
    : moveGuide(program, target, (target.bounds.left + target.bounds.right) / 2 + dx,
      (target.bounds.top + target.bounds.bottom) / 2 + dy,
      { dx, dy, snapDistance: targets.length > 1 ? Infinity : snapDistance }));
}

// Atomic UI transaction composed exclusively of public ggaction functions.
// Only the final result is displayed/committed; a failure changes nothing.
export function prepareGuideEdits(program, view, actions) {
  const calls = []; let guideCall;
  for (const action of actions) {
    const prepared = prepareGuidedAction(program, { ...action, allowUnchanged: true }, view);
    calls.push(...prepared.prerequisiteCalls,
      { method: prepared.recommendation.method, args: prepared.recommendation.args }, ...prepared.postActionCalls);
    program = prepared.authoringPreview; view = prepared.preview; guideCall = prepared.guideCall;
  }
  return { program, view, guideCall, calls };
}
