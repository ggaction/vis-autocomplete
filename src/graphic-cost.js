// A bounded cache must count chart work, not just charts: one dense path can
// contain more primitives than an entire small scatterplot. Inputs are immutable.
const costs = new WeakMap();
export function graphicCost(program) {
  const spec = program?.graphicSpec;
  if (!spec) return 1;
  if (costs.has(spec)) return costs.get(spec);
  let cost = 0;
  for (const object of Object.values(spec.objects ?? {})) {
    cost += 1 + (object.properties?.commands?.length ?? 0);
    for (const item of object.items ?? []) cost += 1 + (item.properties?.commands?.length ?? 0);
  }
  const weight = Math.max(1, Math.ceil(cost / 1000));
  costs.set(spec, weight); return weight;
}
