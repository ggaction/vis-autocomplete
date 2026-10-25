import { ChartProgram } from 'ggaction/extension';
import { cloneAndFreeze } from '../vendor/ggaction/src/core/immutable.js';

// Internal worker transport, not the public project format. Native programs are
// immutable: unchanged data, graphics, configs and trace branches can reference
// the receiver's baseline instead of being serialized, parsed and frozen again.
// Paths (rather than identity-based indices) also work across a persisted reload,
// where equal native states need not have the same object sharing topology.
const indexes = new WeakMap();
function baseIndex(base) {
  let index = indexes.get(base);
  if (index) return index;
  index = new WeakMap();
  function visit(value, path) {
    if (!value || typeof value !== 'object' || index.has(value)) return;
    index.set(value, path);
    for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
  }
  visit(base, []); indexes.set(base, index); return index;
}
export function packProgramUpdate(base, next) {
  const known = baseIndex(base), seen = new WeakMap(), equalities = new WeakMap(), nodes = [];
  // Facet regeneration can produce fresh but identical datasets/graphics.
  // Compare only the corresponding immutable branch; do this in the sender,
  // so the UI does not parse/freeze thousands of unchanged marks again.
  function equal(a, b) {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' ||
        Array.isArray(a) !== Array.isArray(b) || Array.isArray(a) && a.length !== b.length || (a instanceof ChartProgram) !== (b instanceof ChartProgram)) return false;
    let pairs = equalities.get(a);
    if (!pairs) { pairs = new WeakMap(); equalities.set(a, pairs); }
    if (pairs.has(b)) return pairs.get(b);
    const keys = Object.keys(a);
    const same = keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
    pairs.set(b, same); return same;
  }
  function pack(value, previous, path = []) {
    if (!value || typeof value !== 'object') return value;
    if (known.has(value)) return { base: known.get(value) };
    if (equal(value, previous)) return { base: path };
    if (seen.has(value)) return { node: seen.get(value) };
    const id = nodes.length; seen.set(value, id); nodes.push(null);
    nodes[id] = Array.isArray(value) ? { array: value.map((child, i) => pack(child, previous?.[i], [...path, String(i)])) }
      : { [value instanceof ChartProgram ? 'program' : 'object']: Object.entries(value).map(([key, child]) => [key, pack(child, previous?.[key], [...path, key])]) };
    return { node: id };
  }
  return { root: pack(next, base), nodes };
}
function* restoreUpdate(base, update) {
  const restored = new Map(), visiting = new Set();
  function* unpack(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value.base)) {
      let found = base;
      for (const key of value.base) {
        if (!found || typeof found !== 'object' || !Object.hasOwn(found, key)) throw new Error('Unknown worker state reference.');
        found = found[key];
      }
      return found;
    }
    const id = value.node;
    if (!Number.isInteger(id) || id < 0 || id >= update.nodes.length) throw new Error('Unknown worker state node.');
    if (restored.has(id)) return restored.get(id);
    if (visiting.has(id)) throw new Error('Cyclic worker state.');
    visiting.add(id);
    const node = update.nodes[id];
    let result;
    if (node.array) {
      result = new Array(node.array.length);
      for (let i = 0; i < node.array.length; i++) if (Object.hasOwn(node.array, i)) result[i] = yield* unpack(node.array[i]);
    }
    else {
      const entries = [];
      for (const [key, child] of node.program ?? node.object) entries.push([key, yield* unpack(child)]);
      result = Object.fromEntries(entries);
      if (node.program) result = new ChartProgram(result);
    }
    // Own each new plain node bottom-up through the native immutable utility.
    // Later ChartProgram construction then reuses its descendants, rather than
    // walking/freezing the entire facet trace in one uninterruptible operation.
    // Child program maps are owned by ChartProgram's ownChildPrograms instead.
    if (!node.program && !Object.values(result).some(child => child instanceof ChartProgram)) result = cloneAndFreeze(result);
    visiting.delete(id); restored.set(id, result); yield; return result;
  }
  const result = yield* unpack(update.root);
  if (!(result instanceof ChartProgram)) throw new Error('Worker update must contain a native ChartProgram.');
  return result;
}

export function unpackProgramUpdate(base, update) {
  const iterator = restoreUpdate(base, update);
  let step; do { step = iterator.next(); } while (!step.done);
  return step.value;
}

// Worker calculation can finish while the pointer or a transition is moving.
// Restore the native graph cooperatively on the UI thread; no partial state is
// exposed. The synchronous form remains available inside workers and in Node.
export async function unpackProgramUpdateAsync(base, update) {
  const iterator = restoreUpdate(base, update);
  let start = performance.now(), count = 0;
  while (true) {
    const step = iterator.next();
    if (step.done) return step.value;
    if (++count % 32 === 0 && performance.now() - start >= 4) {
      if (globalThis.scheduler?.yield) await globalThis.scheduler.yield();
      else await new Promise(resolve => setTimeout(resolve, 0));
      start = performance.now();
    }
  }
}
