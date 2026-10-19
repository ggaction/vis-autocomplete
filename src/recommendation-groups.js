// Shared by ranking, worker pagination and the UI. Sorting belongs to Transform.
export function optionGroup(recommendation) {
  if (recommendation.method === 'orderCategories') return 'transform';
  if (['encoding', 'mark'].includes(recommendation.category)) return 'encoding';
  if (recommendation.category === 'transform') return 'transform';
  if (['style', 'guide'].includes(recommendation.category)) return 'style';
  throw new Error(`Unknown recommendation category: ${recommendation.category}`);
}
