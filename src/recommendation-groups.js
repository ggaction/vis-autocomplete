// Classify the user's decision, not the implementation prefix. Scale mapping,
// visual order and data labels are encodings; derived values are transforms;
// guide/mark appearance and page layout are styles. Mixed-purpose functions
// retain the recipe's intent (e.g. encodeY can change a variable or aggregation).
// This policy is shared before ranking/filtering and by pagination/search/UI.
export function recommendationCategory(recommendation) {
  const wrapped = recommendation.method === 'editFacetSource' && recommendation.args?.action;
  const method = wrapped ? wrapped.method : recommendation.sourceMethod ?? recommendation.method;
  const args = wrapped ? wrapped.options ?? {} : recommendation.args ?? {};
  if (/^edit.*Scale$/.test(method) || method === 'editFacetScales') return 'encoding';
  if (['facet', 'facetGrid', 'repeatCharts', 'orderCategories', 'encodePathOrder'].includes(method)) return 'encoding';
  if (method === 'createMarkLabels') return Object.hasOwn(args, 'value') ? 'style' : 'encoding';
  if (method === 'editCompositionLayout') return 'style';
  // Whisker statistics are not a box stroke/width style, even when the corpus
  // happens to include those settings in the same native function call.
  if (method === 'editBoxPlot' && !args.x && !args.y &&
      (args.whisker?.type !== undefined || args.whisker?.factor !== undefined)) return 'transform';
  return recommendation.category;
}

export function optionGroup(recommendation) {
  const category = recommendationCategory(recommendation);
  if (['encoding', 'mark'].includes(category)) return 'encoding';
  if (category === 'transform') return 'transform';
  if (['style', 'guide'].includes(category)) return 'style';
  throw new Error(`Unknown recommendation category: ${recommendation.category}`);
}
