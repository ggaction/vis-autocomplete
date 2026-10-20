import { deriveFilteredRows } from '../vendor/ggaction/src/grammar/filter.js';

// Replacing an upstream filter must respect all remaining filters in the live
// input chain. A threshold based only on the original source can otherwise keep
// rows that a later missing-bound filter immediately removes.
export function editableFilterRows(program, target, boundSource) {
  const datasets = new Map(program.semanticSpec.datasets.map(dataset => [dataset.id, dataset]));
  const edited = datasets.get(target), input = datasets.get(edited?.source)?.values ?? [];
  const downstream = [], seen = new Set();
  let current = datasets.get(boundSource);
  while (current && current.id !== target && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.transform?.length !== 1 || current.transform[0].type !== 'filter') return input;
    downstream.push(current.transform[0]);
    current = datasets.get(current.source);
  }
  if (current?.id !== target) return input;
  return downstream.reverse().reduce((rows, transform) => deriveFilteredRows(rows, transform), input);
}
