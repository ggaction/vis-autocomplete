import { sharedCompositionColorLegend } from '../vendor/ggaction/src/materialization/compositionLegends.js';
import { prepareCompositionSnapshots } from '../vendor/ggaction/src/materialization/composition.js';
import { nativeActionTargets, targetKey } from './composition-context.js';

// One visible collected block is one editor. Emit explicit native selectors for
// all its contributors so editing the newly added panel cannot change a hidden
// copy while leaving the visible representative unchanged.
export function sharedLegendEdit(program, action) {
  if (!/^editLegend(?:[A-Z].*)?$/.test(action.method) || !program.compositionSpec || program.compositionSpec.facet) return action;
  const channel = action.args.channel;
  const requested = nativeActionTargets(action);
  if (!requested) return action;
  const targets = [...requested];
  const visit = (view, path = []) => {
    if (!view.compositionSpec || view.compositionSpec.facet) return;
    const { children, sharedLegend } = prepareCompositionSnapshots(view);
    const shared = sharedLegend ?? sharedCompositionColorLegend(view, children);
    if (shared && (!channel || shared.channels.includes(channel))) {
      const members = shared.targets.filter(t => {
        if (!channel || channel === 'color') return true;
        const leaf = t.childPath.reduce((node, id) => node.children[id], view);
        return Object.entries(leaf.guideConfigs.legend ?? {}).some(([kind, config]) =>
          (!t.id || config.target === t.id) && (config.channels ?? [kind]).includes(channel));
      }).map(t => ({ ...t, childPath: [...path, ...t.childPath] }));
      if (requested.some(target => members.some(member => JSON.stringify(target.childPath) === JSON.stringify(member.childPath) &&
        (target.id === undefined || member.id === undefined || target.id === member.id)))) targets.push(...members);
    }
    for (const [id, child] of Object.entries(children)) visit(child, [...path, id]);
  };
  visit(program);
  const distinct = targets.filter(target => target.id !== undefined || !targets.some(other => other.id !== undefined && JSON.stringify(other.childPath) === JSON.stringify(target.childPath)));
  const unique = [...new Map(distinct.map(t => [targetKey(t), t])).values()];
  return { ...action, args: { ...action.args, target: unique } };
}
