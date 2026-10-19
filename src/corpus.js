import { parse } from 'acorn';
import { chart } from 'ggaction';
import { actionFeatures } from './semantics.js';
import { PUBLIC_ACTION_METHODS } from './action-capabilities.js';

const UNKNOWN = Symbol('dynamic expression');
const runtime = chart();
const publicActions = new Set([...PUBLIC_ACTION_METHODS, 'editSemantic', 'createGraphics', 'editGraphics', 'createDerivedData']);

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child, visit);
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

// A small literal reader, not eval: corpus modules are parsed, NEVER imported.
function literal(node, bindings, seen = new Set()) {
  if (!node) return UNKNOWN;
  if (node.type === 'Literal') return node.value;
  if (node.type === 'Identifier') {
    if (seen.has(node.name) || !bindings.has(node.name)) return UNKNOWN;
    return literal(bindings.get(node.name), bindings, new Set([...seen, node.name]));
  }
  if (node.type === 'UnaryExpression') {
    const value = literal(node.argument, bindings, seen);
    if (typeof value === 'number' && node.operator === '-') return -value;
    if (typeof value === 'number' && node.operator === '+') return value;
    if (typeof value === 'boolean' && node.operator === '!') return !value;
    return UNKNOWN;
  }
  if (node.type === 'ArrayExpression') return node.elements.map(n => literal(n, bindings, seen));
  if (node.type === 'ObjectExpression') {
    const result = Object.create(null);
    for (const property of node.properties) {
      if (property.type === 'SpreadElement') {
        const spread = literal(property.argument, bindings, seen);
        if (spread && typeof spread === 'object' && !Array.isArray(spread)) Object.assign(result, spread);
        else result.__dynamicSpread = true;
        continue;
      }
      const key = property.computed ? literal(property.key, bindings, seen)
        : property.key.name ?? property.key.value;
      if (typeof key === 'string') result[key] = literal(property.value, bindings, seen);
    }
    return result;
  }
  return UNKNOWN;
}

export function parseProgramSource(source) {
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const bindings = new Map();
  const duplicateBindings = new Set();
  walk(tree, node => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
      if (bindings.has(node.id.name)) duplicateBindings.add(node.id.name);
      else bindings.set(node.id.name, node.init);
    }
  });
  for (const name of duplicateBindings) bindings.delete(name);
  const features = new Set();
  const methods = Object.create(null);
  const unknownMethods = new Set();
  let dynamicOptions = 0;
  let temporal = false;
  const calls = [];
  walk(tree, node => {
    if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return;
    const method = node.callee.computed ? literal(node.callee.property, bindings)
      : node.callee.property.name;
    if (typeof method !== 'string' || !publicActions.has(method) && !/^(create|edit|encode|facet|filterData|filterMarks|jitter|pack|select|layout|order|apply|remove|bind|revise|repeat)/.test(method)) return;
    if (typeof runtime[method] !== 'function') {
      unknownMethods.add(method);
      return;
    }
    methods[method] = (methods[method] ?? 0) + 1;
    let options = node.arguments.length ? literal(node.arguments[0], bindings) : {};
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      if (node.arguments.length) dynamicOptions++;
      options = {};
    }
    if (options.__dynamicSpread) dynamicOptions++;
    // Preserve static public options for chart-label/field-role extraction.
    // This never evaluates or imports corpus JavaScript.
    if (method !== 'createData' && method !== 'createCanvas') calls.push({ method, options, end: node.end });
    const scan = value => {
      if (!value || typeof value !== 'object') return;
      if (value.fieldType === 'temporal') temporal = true;
      for (const child of Object.values(value)) scan(child);
    };
    scan(options);
    for (const feature of actionFeatures(method, options)) features.add(feature);
  });
  return { features: [...features].sort(), methods, unknownMethods: [...unknownMethods].sort(),
    dynamicOptions, temporal, calls: calls.sort((a, b) => a.end - b.end) };
}

export function summarizeData(value) {
  let tables = 0;
  let rows = 0;
  let isoTemporal = false;
  const visit = data => {
    if (Array.isArray(data)) {
      tables++;
      rows += data.length;
      for (const row of data) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        if (Object.values(row).some(v => typeof v === 'string' &&
            /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v) && Number.isFinite(Date.parse(v)))) isoTemporal = true;
      }
    } else if (data && typeof data === 'object') {
      for (const child of Object.values(data)) visit(child);
    }
  };
  visit(value);
  return { tables, rows, isoTemporal };
}
