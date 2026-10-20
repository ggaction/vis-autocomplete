import { optionGroup } from '../src/recommendation-groups.js';
export { optionGroup };

// Original Visualization Autocomplete category colors.
export const OPTION_GROUPS = Object.freeze([
  { id: 'encoding', label: 'Encoding', color: '#0a6fc2', rgb: '10, 111, 194' },
  { id: 'transform', label: 'Transform', color: '#d6861a', rgb: '214, 134, 26' },
  { id: 'style', label: 'Style', color: '#1f9d55', rgb: '31, 157, 85' },
]);

// New actions come first; already-used actions stay available on later pages.
// Keep paper scores and validate only the currently requested group/page.
export const FOLLOWUP_RECOMMENDATION_OPTIONS = Object.freeze({
  limit: 1000, includeRevisions: true, deprioritizeAppliedActions: true, hierarchy: true,
});

export function groupRecommendations(recommendations, limit = 5) {
  const groups = Object.fromEntries(OPTION_GROUPS.map(group => [group.id, []]));
  for (const recommendation of recommendations) {
    const group = groups[optionGroup(recommendation)];
    if (group.length < limit) group.push(recommendation);
  }
  return groups;
}
