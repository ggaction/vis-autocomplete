// The import editor, saved schemas and chart profiles share one domain rule.
export function validateCategoryOrder(order) {
  if (order === undefined) return;
  if (!Array.isArray(order) || order.some(value => value === null ||
      !['string', 'number', 'boolean'].includes(typeof value) ||
      typeof value === 'number' && !Number.isFinite(value))) {
    throw new TypeError('Category order must be a JSON list of strings, finite numbers, or booleans.');
  }
  if (new Set(order).size !== order.length) {
    throw new TypeError('Category order must contain unique values; remove the repeated categories.');
  }
  if (new Set(order.map(value => typeof value)).size > 1) {
    throw new TypeError('Category order values must have the same type.');
  }
}
