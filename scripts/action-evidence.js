import { describeAction } from 'ggaction/inspection';
import { chart } from 'ggaction';
import { PUBLIC_ACTION_METHODS, corpusActionPolicy } from '../src/action-capabilities.js';

// Values come from the static literal reader, never execution of corpus code.
const literal = value => {
  if (typeof value === 'symbol' || value === undefined) return undefined;
  if (Array.isArray(value)) return value.every(v => literal(v) !== undefined) ? value.map(literal) : undefined;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([k]) => k !== '__dynamicSpread')
      .flatMap(([k, v]) => literal(v) === undefined ? [] : [[k, literal(v)]]));
  }
  return value;
};

export function actionEvidenceCollector() {
  const templates = new Map();
  return {
    add(parsed) {
      for (const { method, options } of parsed.calls) {
        if (!templates.has(method)) templates.set(method, new Map());
        const values = templates.get(method), args = literal(options), key = JSON.stringify(args);
        const entry = values.get(key) ?? { args, programs: 0 };
        entry.programs++; values.set(key, entry);
      }
    },
    finish(frequency, provenance) {
      const runtime = chart();
      return { version: 1, provenance, methods: Object.entries(frequency).map(([method, charts]) => ({
        method, charts, public: PUBLIC_ACTION_METHODS.includes(method), ...corpusActionPolicy(method),
        parameters: describeAction(runtime, { action: method }).parameterDefinitions,
        templates: [...(templates.get(method)?.values() ?? [])].sort((a, b) => b.programs - a.programs)
          .slice(0, 16),
      })) };
    },
  };
}
