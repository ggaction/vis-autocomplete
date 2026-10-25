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
    delete(key) {
      if (!entries.has(key)) return false;
      const value = entries.get(key); entries.delete(key); onEvict(key, value); return true;
    },
    clear() { entries.clear(); },
    values() { return entries.values(); },
    get size() { return entries.size; },
  };
}

// Capacity is measured in retained work rather than entry count. Keep the
// newest oversized result alone so repeating an expensive preview stays cheap.
export function createWeightedLRU(limit, onEvict = () => {}) {
  if (!Number.isFinite(limit) || limit <= 0) throw new TypeError('Cache capacity must be positive.');
  const entries = new Map();
  let weight = 0;
  const remove = key => {
    const entry = entries.get(key);
    if (!entry) return false;
    entries.delete(key); weight -= entry.weight; onEvict(key, entry.value);
    return true;
  };
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key); entries.set(key, entry);
      return entry.value;
    },
    set(key, value, cost = 1) {
      if (!Number.isFinite(cost) || cost <= 0) throw new TypeError('Cache weight must be positive.');
      const previous = entries.get(key);
      if (previous) { weight -= previous.weight; entries.delete(key); }
      const entry = { value, weight: Math.min(limit, cost) };
      entries.set(key, entry); weight += entry.weight;
      while (weight > limit) remove(entries.keys().next().value);
      return value;
    },
    delete: remove,
    clear() { for (const key of entries.keys()) remove(key); },
    get size() { return entries.size; },
    get weight() { return weight; },
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
