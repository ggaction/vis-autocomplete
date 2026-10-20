// Only native facet collision diagnostics permit a larger gap. Other failures
// must remain visible; never fall back to canvas spacing or drop guides.
export const facetSpacingCollision = error => /^Plot spacing gap is too small for (?:the facet headers|the retained facet guides or headers)\.$/.test(error.message);

export function fitFacetGap(attempt, requested) {
  let firstError;
  try { return attempt(requested); } catch (error) {
    if (!facetSpacingCollision(error)) throw error;
    firstError = error;
  }
  let lower = Math.floor(requested), upper = Math.max(24, Math.ceil(requested) + 1), fitted;
  const probe = gap => {
    try { return { value: attempt(gap) }; } catch (error) {
      if (!facetSpacingCollision(error)) throw error;
      return null;
    }
  };
  // A bounded search runs only after a real collision, through public actions.
  // Keep the first fitting whole-pixel gap and record it in the executable call.
  while (upper <= 1024) {
    fitted = probe(upper);
    if (fitted) break;
    lower = upper; upper *= 2;
  }
  if (!fitted) throw firstError;
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2), result = probe(middle);
    if (result) { upper = middle; fitted = result; } else lower = middle;
  }
  return fitted.value;
}
