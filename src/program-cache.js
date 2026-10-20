import { createLRU, createWeightedLRU } from './cache.js';

// Measured 40-cell facets retain two native child trees during preparation
// (authoring and guided preview), plus one during validation. A shared budget
// keeps that current pair hot instead of retaining 128 variants per base/view.
// Plain charts keep their independent 128-entry caches and are never displaced
// by a large facet. This budget changes retention only, never available actions.
export function createCompositionCacheBudget(limit = 128) {
  return createWeightedLRU(limit, entry => entry.release());
}
const sharedCompositions = createCompositionCacheBudget();

export function compositionResultWeight(result) {
  const programs = [...new Set([result?.next, result?.preview, result?.authoringPreview, result?.actionBase]
    .filter(program => program?.semanticSpec))];
  if (!programs.some(program => Object.keys(program.children ?? {}).length)) return 0;
  // Guided/authoring roots can share child objects, but each root still owns a
  // materialized graphic tree. Charge both trees; deduplicate identical roots.
  const count = (program, seen) => {
    if (seen.has(program)) return 0;
    seen.add(program);
    return 1 + Object.values(program.children ?? {}).reduce((sum, child) => sum + count(child, seen), 0);
  };
  return programs.reduce((sum, program) => sum + count(program, new Set()), 0);
}

export function createProgramResultCache({ plainLimit = 128, compositionBudget = sharedCompositions } = {}) {
  const plain = createLRU(plainLimit), compositions = new Map();
  return {
    get(key) {
      const entry = compositions.get(key);
      return entry ? compositionBudget.get(entry) : plain.get(key);
    },
    set(key, value) {
      const weight = compositionResultWeight(value);
      const previous = compositions.get(key);
      if (previous) compositionBudget.delete(previous);
      if (!weight) return plain.set(key, value);
      plain.delete(key);
      const entry = { release: () => compositions.delete(key) };
      compositions.set(key, entry);
      return compositionBudget.set(entry, value, weight);
    },
    clear() {
      plain.clear();
      for (const entry of compositions.values()) compositionBudget.delete(entry);
    },
    get size() { return plain.size + compositions.size; },
  };
}
