// Closed AST interpreter: records program/data ownership, never imports or executes corpus code.
// Unknown JavaScript stays explicit. Programs are persistent values, just as in ggaction.
export function extractProgramStructure(tree, publicActions) {
  const unknown = Symbol('unknown'), diagnostics = new Set(), methods = new Set();
  const module = new Map();
  let last;
  const prop = (node, env) => node.computed ? value(node.property, env) : node.property.name;
  const fileRefs = item => item?.kind === 'raw-data' ? [item.file] : [];
  function value(node, env, depth = 0) {
    if (!node || depth > 600) return unknown;
    if (node.type === 'Literal') return node.value;
    if (node.type === 'Identifier') return env.get(node.name) ?? unknown;
    if (['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'].includes(node.type)) return { kind: 'function', node, env: new Map(env) };
    if (node.type === 'ObjectExpression') {
      const out = {};
      for (const entry of node.properties) {
        if (entry.type === 'SpreadElement') { const spread = value(entry.argument, env, depth + 1); if (spread && typeof spread === 'object') Object.assign(out, spread); continue; }
        const key = entry.computed ? value(entry.key, env, depth + 1) : entry.key.name ?? entry.key.value;
        if (typeof key === 'string') out[key] = value(entry.value, env, depth + 1);
      }
      return out;
    }
    if (node.type === 'ArrayExpression') return node.elements.map(n => value(n, env, depth + 1));
    if (node.type === 'MemberExpression') { const object = value(node.object, env, depth + 1); return object?.[prop(node, env)] ?? unknown; }
    if (node.type === 'UnaryExpression') { const item = value(node.argument, env, depth + 1); if (typeof item === 'number') return node.operator === '-' ? -item : item; if (typeof item === 'boolean' && node.operator === '!') return !item; return unknown; }
    if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') { const out = value(node.right, env, depth + 1); env.set(node.left.name, out); return out; }
    if (node.type === 'CallExpression') {
      const method = node.callee.type === 'Identifier' ? node.callee.name : node.callee.type === 'MemberExpression' ? prop(node.callee, env) : null;
      const imported = env.get(method);
      if (imported?.kind === 'ggaction') {
        if (imported.name === 'chart') return { kind: 'program', viewId: `view-${node.start}`, calls: [], datasets: {}, layers: {}, children: [] };
        if (['hconcat', 'vconcat', 'concat'].includes(imported.name)) {
          methods.add(imported.name);
          const options = value(node.arguments[0], env, depth + 1);
          return { kind: 'program', viewId: `view-${node.start}`, calls: [], datasets: {}, layers: {},
            composition: imported.name, children: (options?.programs ?? []).filter(child => child?.program?.kind === 'program') };
        }
      }
      // Fixtures and native-only corpora can omit an import in source snippets.
      if (method === 'chart' && !env.has('chart')) return { kind: 'program', viewId: `view-${node.start}`, calls: [], datasets: {}, layers: {}, children: [] };
      const callable = node.callee.type === 'Identifier' ? value(node.callee, env, depth + 1) : unknown;
      if (callable?.kind === 'function') {
        const local = new Map(callable.env);
        callable.node.params.forEach((parameter, i) => { if (parameter.type === 'Identifier') local.set(parameter.name, value(node.arguments[i], env, depth + 1)); });
        return callable.node.body.type === 'BlockStatement' ? statements(callable.node.body.body, local, depth + 1).returned : value(callable.node.body, local, depth + 1);
      }
      if (node.callee.type !== 'MemberExpression') return unknown;
      const base = value(node.callee.object, env, depth + 1);
      if (base?.kind !== 'program') return unknown;
      if (!publicActions.has(method)) { diagnostics.add(`Unsupported program operation: ${method}`); return base; }
      const options = value(node.arguments[0], env, depth + 1);
      const args = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
      const out = { ...base, calls: [...base.calls], datasets: { ...base.datasets }, layers: { ...base.layers } };
      const data = typeof args.data === 'string' ? args.data : base.currentData;
      const call = { method, options: args, end: node.end, viewId: base.viewId, data,
        dataFiles: base.datasets[data]?.files ?? [] };
      out.calls.push(call);
      if (method === 'createData') {
        const id = typeof args.id === 'string' ? args.id : 'data';
        out.datasets[id] = { files: fileRefs(args.values), source: null }; out.currentData = id;
      } else if (/^create.*Data$/.test(method) || method === 'filterData') {
        const id = typeof args.id === 'string' ? args.id : undefined, source = typeof args.source === 'string' ? args.source : base.currentData;
        if (id) { out.datasets[id] = { files: base.datasets[source]?.files ?? [], source }; out.currentData = id; }
      } else if (/^create.*(?:Plot|Mark)$/.test(method) || ['createHistogram', 'createHeatmap', 'createParallelCoordinates'].includes(method)) {
        const name = method.replace(/^create/, '').replace(/Mark$/, '');
        const defaultId = name.replace(/^[A-Z]+(?=[A-Z][a-z]|$)/, word => word.toLowerCase()).replace(/^./, c => c.toLowerCase());
        const id = typeof args.id === 'string' ? args.id : defaultId; out.layers[id] = { id, call, encodings: {} }; out.currentMark = id;
      } else if (/^encode/.test(method)) {
        const target = typeof args.target === 'string' ? args.target : base.currentMark;
        if (base.layers[target]) out.layers[target] = { ...base.layers[target], encodings: { ...base.layers[target].encodings, [method]: args } };
      } else if (method === 'removeMark') {
        const target = typeof args.target === 'string' ? args.target : base.currentMark; delete out.layers[target];
      } else if (method === 'createProgram' && args.program?.kind === 'program') out.children = [...out.children, { id: args.id, program: args.program }];
      return out;
    }
    return unknown;
  }
  function statements(nodes, env, depth = 0) {
    let returned;
    for (const node of nodes) {
      if (node.type === 'ImportDeclaration') for (const entry of node.specifiers) {
        env.set(entry.local.name, node.source.value === 'ggaction' ? { kind: 'ggaction', name: entry.imported?.name ?? entry.local.name }
          : node.source.value.endsWith('.json') ? { kind: 'raw-data', file: node.source.value.replace(/^\.\//, '') } : unknown);
      }
      else if (node.type === 'VariableDeclaration') for (const entry of node.declarations) {
        if (entry.id.type === 'Identifier') { const v = value(entry.init, env, depth + 1); env.set(entry.id.name, v); if (v?.kind === 'program') last = v; }
      }
      else if (node.type === 'FunctionDeclaration') env.set(node.id.name, value(node, env, depth + 1));
      else if (node.type === 'ReturnStatement') { returned = value(node.argument, env, depth + 1); break; }
      else if (node.type === 'ExpressionStatement') { const v = value(node.expression, env, depth + 1); if (v?.kind === 'program') last = v; }
      else if (node.type === 'ExportNamedDeclaration' && node.declaration) statements([node.declaration], env, depth + 1);
      else if (['IfStatement', 'ForStatement', 'ForOfStatement', 'WhileStatement', 'SwitchStatement', 'TryStatement'].includes(node.type)) diagnostics.add(`Unresolved control flow: ${node.type}`);
      else if (node.type === 'ExportDefaultDeclaration') { const v = value(node.declaration, env, depth + 1); if (v?.kind === 'program') last = v; else if (v?.kind === 'function') env.set('buildChart', v); }
    }
    return { returned };
  }
  statements(tree.body, module);
  const builder = module.get('buildChart');
  if (builder?.kind === 'function') last = statements(builder.node.body.body ?? [], new Map(builder.env)).returned ?? last;
  const views = [], calls = [];
  function collect(program, path = []) {
    if (program?.kind !== 'program') return;
    calls.push(...program.calls);
    if (program.children.length) { for (const child of program.children) collect(child.program, [...path, child.id]); return; }
    views.push({ id: program.viewId, path, calls: program.calls, layers: Object.values(program.layers), datasets: program.datasets });
  }
  collect(last);
  if (!views.length) diagnostics.add('Final program structure could not be resolved statically.');
  return { views, calls: [...new Map(calls.map(call => [call.end, call])).values()].sort((a, b) => a.end - b.end), methods: [...methods], diagnostics: [...diagnostics], resolved: views.length > 0 && diagnostics.size === 0 };
}
