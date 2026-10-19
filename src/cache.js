export function createLRU(limit = 64, onEvict = () => {}) {
  const entries = new Map();
  return {
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key); entries.delete(key); entries.set(key, value); return value;
    },
    set(key, value) {
      entries.delete(key); entries.set(key, value);
      if (entries.size > limit) {
        const oldest = entries.keys().next().value, evicted = entries.get(oldest);
        entries.delete(oldest); onEvict(oldest, evicted);
      }
      return value;
    },
    clear() { entries.clear(); },
    get size() { return entries.size; },
  };
}

// Preserve undefined, nonfinite numbers, negative zero and sparse arrays in keys.
export function signature(value) {
  const seen = new WeakSet();
  const encode = item => {
    if (item === null) return ['null'];
    if (typeof item !== 'object') return [typeof item, typeof item === 'number' && Object.is(item, -0) ? '-0' : String(item)];
    if (seen.has(item)) throw new TypeError('Circular action options.');
    seen.add(item);
    const result = Array.isArray(item)
      ? ['array', Array.from({ length: item.length }, (_, i) => Object.hasOwn(item, i) ? encode(item[i]) : ['hole'])]
      : ['object', Object.keys(item).sort().map(key => [key, encode(item[key])])];
    seen.delete(item); return result;
  };
  return JSON.stringify(encode(value));
}

export function freezeResult(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeResult(child);
    Object.freeze(value);
  }
  return value;
}
