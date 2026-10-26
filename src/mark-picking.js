import { getMarkItems } from 'ggaction/inspection';
import { prepareCompositionSnapshots } from '../vendor/ggaction/src/materialization/composition.js';
import { namespaceGraphicId } from '../vendor/ggaction/src/materialization/compositionSnapshot.js';
import { scopedCall } from './composition-context.js';

export function selectableMarks(program, path = [], offset = { x: 0, y: 0 }, facet = false) {
  if (program.compositionSpec) {
    const { children, layout } = program.compositionSpec.facet ? { children: program.children, layout: { children: program.compositionSpec.children.map(id => ({ id, x: 0, y: 0 })) } } : prepareCompositionSnapshots(program);
    return layout.children.flatMap(place => {
      const canvas = program.graphicSpec.objects[namespaceGraphicId(`${program.compositionSpec.id}-${place.id}`, 'canvas')]?.properties;
      return selectableMarks(children[place.id], program.compositionSpec.facet ? path : [...path, place.id],
        { x: offset.x + (canvas?.x ?? place.x), y: offset.y + (canvas?.y ?? place.y) }, facet || Boolean(program.compositionSpec.facet));
    });
  }
  const covered = new Set(), out = [];
  // Native semantic layer order may place a dependent before its owner. Inspect
  // all owners and keep the larger owning group instead of duplicating hits.
  const groups = program.semanticSpec.layers.flatMap(layer => {
    try { return [{ layer, items: getMarkItems(program, { target: layer.id }) }]; } catch { return []; }
  }).sort((a,b) => new Set(b.items.map(i=>i.target)).size - new Set(a.items.map(i=>i.target)).size);
  for (const { layer, items } of groups) {
    if (covered.has(layer.id)) continue;
    for (const item of items) covered.add(item.target);
    const datasets = program.semanticSpec.datasets.filter(d => Array.isArray(d.values) && items.some(item => item.rows.some(r => r.data === d.id)));
    const data = datasets.find(d => !d.source) ?? datasets[0];
    if (!data) continue;
    const scope = { childPath: path, id: layer.id, ...(facet ? { facetSource: true } : {}) };
    const key = JSON.stringify(scope);
    out.push({ key, scope, label: `${path.length ? path.join(' / ') + ' · ' : ''}${layer.mark.type}`, data: data.id, rows: data.values,
      items: items.filter(item=>item.bounds).map(item => ({ ...item, offset,
        bounds: { left:item.bounds.left+offset.x, right:item.bounds.right+offset.x, top:item.bounds.top+offset.y, bottom:item.bounds.bottom+offset.y } })) });
  }
  return out;
}

export function markSelectionCall(group, indices, color = '#dc2626') {
  return scopedCall({ method: 'highlightMarks', args: { id: `${group.scope.id}Highlight`, target: group.scope.id,
    select: { rows: { data: group.data, indices: [...indices].sort((a,b)=>a-b) } }, color, dimOthers: { opacity: .2 } } }, [group.scope]);
}
