import { ChartProgram } from 'ggaction/extension';
import { deserializeProgram, serializeProgram } from 'ggaction/persistence';

// Worker messages carry the current native state once, plus references to
// immutable trace branches already held by the receiver. Project persistence
// still uses the complete public snapshot; no authoring history is discarded.
export function packProgramUpdate(base, next) {
  const known = new WeakMap();
  function index(program, children = []) {
    const visit = (node, path = []) => {
      if (known.has(node)) return;
      known.set(node, { children, path });
      node.children.forEach((child, i) => visit(child, [...path, i]));
    };
    visit(program.trace);
    for (const [id, child] of Object.entries(program.children)) index(child, [...children, id]);
  }
  index(base);
  const trace = node => known.has(node) ? { reference: known.get(node) }
    : { node: { ...node, children: node.children.map(trace) } };
  function strip(program) {
    return new ChartProgram({ ...program,
      children: Object.fromEntries(Object.entries(program.children).map(([id, child]) => [id, strip(child)])),
      trace: { ...program.trace, children: [] },
    });
  }
  function traces(program) {
    return { trace: trace(program.trace),
      children: Object.fromEntries(Object.entries(program.children).map(([id, child]) => [id, traces(child)])) };
  }
  return { snapshot: serializeProgram(strip(next)), traces: traces(next) };
}

export function unpackProgramUpdate(base, update) {
  const reference = ({ children, path }) => {
    let program = base;
    for (const id of children) {
      if (!Object.hasOwn(program.children, id)) throw new Error('Unknown worker trace source.');
      program = program.children[id];
    }
    let node = program.trace;
    for (const i of path) {
      if (!Number.isInteger(i) || i < 0 || i >= node.children.length) throw new Error('Unknown worker trace branch.');
      node = node.children[i];
    }
    return node;
  };
  const trace = value => value.reference ? reference(value.reference)
    : { ...value.node, children: value.node.children.map(trace) };
  function restore(program, saved) {
    return new ChartProgram({ ...program, trace: trace(saved.trace),
      children: Object.fromEntries(Object.entries(program.children).map(([id, child]) => [id, restore(child, saved.children[id])])),
    });
  }
  return restore(deserializeProgram(update.snapshot), update.traces);
}
