// Small structural deltas retain replaced history branches without repeatedly
// storing all prior calls. Current snapshots remain independently recoverable.
export function changesBetween(before, after, path = []) {
  if (before === after || JSON.stringify(before) === JSON.stringify(after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    let n = 0;
    while (n < before.length && n < after.length && JSON.stringify(before[n]) === JSON.stringify(after[n])) n++;
    return [{ op: 'splice', path, index: n, deleteCount: before.length - n, values: after.slice(n) }];
  }
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    return [...Object.keys(before).filter(k => !(k in after)).map(k => ({ op: 'remove', path: [...path, k] })),
      ...Object.keys(after).flatMap(k => changesBetween(before[k], after[k], [...path, k]))];
  }
  return [{ op: 'set', path, value: after }];
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
