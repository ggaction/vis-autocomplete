import { validateSourceMarkLabelPlacement } from '../vendor/ggaction/src/materialization/text.js';

const anchors = [
  ['center', 'Center'], ['insideStart', 'Inside start'], ['insideEnd', 'Inside end'],
  ['outsideStart', 'Outside start'], ['outsideEnd', 'Outside end'],
];
const select = (path, label, value, choices) => ({ path, label, type: 'select', value, choices, defaultPolicy: 'context' });

// Attached labels belong to the source mark. Read their actual native policy
// instead of turning unrelated corpus placement objects into opaque presets.
export function labelPlacementCandidates(program, source) {
  return program.semanticSpec.layers.filter(layer => layer.source === source.id && program.markConfigs[layer.id]?.labelAuthoring)
    .flatMap(layer => {
      const positions = anchors.filter(([anchor]) => {
        try { validateSourceMarkLabelPlacement(program, source.id, { anchor }); return true; }
        catch { return false; }
      }).map(([value, label]) => ({ value, label }));
      if (!positions.length) return [];
      const current = program.markConfigs[layer.id].labelAuthoring.placement;
      const placement = { anchor: 'center', gap: 4, overflow: 'hide', leader: false, ...current };
      placement.anchor = positions.find(choice => choice.value !== placement.anchor)?.value ?? placement.anchor;
      if (positions.length === 1 && current) placement.overflow = placement.overflow === 'allow' ? 'hide' : 'allow';
      const collisionLeader = program.materializationConfigs.labelLayouts?.[layer.id]?.leader;
      const leader = placement.leader || { stroke: '#94a3b8', strokeWidth: 1 };
      return [{ method: 'editMarkLabelPlacement', args: { target: layer.id, placement }, category: 'style',
        feature: 'action.editMarkLabelPlacement', label: 'Edit label placement', parameters: [
          select('placement.anchor', 'Position', placement.anchor, positions),
          { path: 'placement.gap', label: 'Gap', type: 'number', value: placement.gap, min: 0,
            max: Math.max(24, placement.gap), step: 1, defaultPolicy: 'context' },
          select('placement.overflow', 'Overflow', placement.overflow, [
            { value: 'hide', label: 'Hide if no room' }, { value: 'outside', label: 'Move outside' }, { value: 'allow', label: 'Allow overflow' },
          ]),
          select('placement.leader', 'Leader line', placement.leader, [
            { value: false, label: 'None' }, { value: leader, label: 'Show', disabled: Boolean(collisionLeader),
              ...(collisionLeader ? { reason: 'Collision layout already owns the leader lines.' } : {}) },
          ]),
        ] }];
    });
}
