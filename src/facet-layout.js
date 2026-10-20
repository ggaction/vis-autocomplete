// Keep small multiples in one row through five panels. Larger sets use the
// closest square factorization with at least as many columns as rows.
// Prime counts stay in one row rather than leaving empty cells.
export function defaultFacetColumns(count) {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('Facet count must be a positive integer.');
  if (count <= 5) return count;
  for (let columns = Math.ceil(Math.sqrt(count)); columns <= count; columns++) {
    if (count % columns === 0) return columns;
  }
}
