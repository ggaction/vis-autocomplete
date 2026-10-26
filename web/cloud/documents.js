const plain = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

// A comparison owns its memo: mutable caller values are always checked again
// on the next save. Within one document, history entries share earlier calls;
// compare each call pair once instead of serializing every historical prefix.
function comparator() {
  const pairs = new WeakMap();
  function equal(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    const previous = pairs.get(a);
    if (previous?.has(b)) return previous.get(b);
    let result;
    if (Array.isArray(a) || Array.isArray(b)) {
      result = Array.isArray(a) && Array.isArray(b) && a.length === b.length;
      for (let i = 0; result && i < a.length; i++) result = equal(a[i], b[i]);
    } else if (plain(a) && plain(b)) {
      const keys = Object.keys(a);
      result = keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
    } else {
      // Public call arguments can contain dates; retain their JSON semantics.
      result = JSON.stringify(a) === JSON.stringify(b);
    }
    if (!previous) pairs.set(a, new WeakMap([[b, result]])); else previous.set(b, result);
    return result;
  }
  return equal;
}

export const sameDocument = (before, after) => comparator()(before, after);

// Current snapshots remain independently recoverable. Deltas descend into
// same-position records instead of copying a whole dataset/history whenever
// one nested field changes; arrays still use the existing splice operation.
export function changesBetween(before, after, path = []) {
  const equal = comparator(), changes = [];
  function visit(a, b, at) {
    if (a === b) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      let first = 0, endA = a.length, endB = b.length;
      while (first < endA && first < endB && equal(a[first], b[first])) first++;
      while (endA > first && endB > first && equal(a[endA - 1], b[endB - 1])) { endA--; endB--; }
      if (first === endA && first === endB) return;
      if (endA - first === endB - first && a.slice(first, endA).every((value, i) => plain(value) && plain(b[first + i]))) {
        for (let i = first; i < endA; i++) visit(a[i], b[i], [...at, i]);
      } else changes.push({ op: 'splice', path: at, index: first, deleteCount: endA - first, values: b.slice(first, endB) });
    } else if (plain(a) && plain(b)) {
      for (const key of Object.keys(a)) if (!Object.hasOwn(b, key)) changes.push({ op: 'remove', path: [...at, key] });
      for (const key of Object.keys(b)) visit(a[key], b[key], [...at, key]);
    } else if (!equal(a, b)) changes.push({ op: 'set', path: at, value: b });
  }
  visit(before, after, path);
  return changes;
}
export function projectRecords(project) {
  return project.datasets.filter(d => d.id === project.activeId || d.session);
}
export async function contentHash(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
}

// A report's code can contain literal data as well as __LOADED_DATA__ references.
// Strip all data containers when the author has not shared the dataset.
export function reportContext(snapshot) {
  const clean = value => Array.isArray(value) ? value.map(clean) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => !['values','rows','rawRows','sourceTable','sample','path'].includes(key)).map(([key,v]) => [key,clean(v)]))
    : value;
  return clean(snapshot);
}
