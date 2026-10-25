import { getPlotComposition } from 'ggaction/inspection';
import { chartViews, editableChartTargets } from './composition-context.js';

const meaning = role => JSON.stringify([role.field ?? null, role.fields ?? null, role.fieldType,
  role.measurement.unit === 'sum' ? 'value' : role.measurement.unit, role.temporalUnit ?? null]);
const definition = scale => JSON.stringify(Object.fromEntries(Object.entries(scale)
  .filter(([key]) => !['id', 'domain', 'emptyDomain', 'nice', 'zero'].includes(key))
  .sort(([a], [b]) => a.localeCompare(b))));

// Color belongs to the whole receiving panel, including independently authored
// chart layers. A fixed-color source mark does not erase a box/line layer's
// classification. Only infer an owner when every mapped layer agrees, and
// every receiving view has a mapping (the native shared-scale contract).
export function adjacentColorContext(program, selectedView, selectedRole) {
  const views = chartViews(program).map(({ program: view }) => editableChartTargets(view)
    .filter(target => !target.overlay)
    .flatMap(target => {
      const role = getPlotComposition(view, { target: target.id }).channels.color;
      const scale = view.semanticSpec.scales.find(scale => scale.id === role?.scale);
      return role && scale ? [{ view, role, scale }] : [];
    }));
  const entries = views.flat();
  const selectedScale = selectedView.semanticSpec.scales.find(scale => scale.id === selectedRole?.scale);
  const reference = selectedScale ? { view: selectedView, role: selectedRole, scale: selectedScale } : entries[0];
  const domains = entries.map(entry => entry.scale.domain).filter(Array.isArray);
  const compatible = Boolean(reference && views.every(entries => entries.length) && entries.every(entry =>
    meaning(entry.role) === meaning(reference.role) && definition(entry.scale) === definition(reference.scale)) &&
    domains.every(domain => JSON.stringify(domain) === JSON.stringify(domains[0])));
  // Never pick an arbitrary layer when several incompatible mappings exist.
  return { ...(selectedScale || compatible ? reference : {}), compatible };
}
