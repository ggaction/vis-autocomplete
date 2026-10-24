import { namespaceGraphicId } from '../vendor/ggaction/src/materialization/compositionSnapshot.js';
import { guideBounds } from './guide-manipulation.js';

// Facet cells are generated from a source; concat panels are authored children.
// A one-child nested container is removed with its child, so no empty group is left.
export function removableChartPanels(program) {
  function visit(local, prefix = [], scopes = [], removable) {
    if (!local.compositionSpec || local.compositionSpec.facet) {
      if (!removable) return [];
      const ids = scopes.reduceRight((ids, scope) => ids.map(id => namespaceGraphicId(scope, id)), ['canvas']);
      const bounds = guideBounds(program, ids);
      return bounds ? [{ key: `panel:${prefix.join('/')}`, kind: 'panel', label: 'Chart', ids, bounds,
        remove: { method: 'removeCompositionChild', args: { target: { childPath: removable.parent, id: removable.id } } } }] : [];
    }
    return local.compositionSpec.children.flatMap(id => visit(local.children[id], [...prefix, id],
      [...scopes, `${local.compositionSpec.id}-${id}`],
      local.compositionSpec.children.length > 1 ? { parent: prefix, id } : removable));
  }
  return visit(program);
}
