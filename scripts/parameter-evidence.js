import { parameterSettings, settingKey } from '../src/parameter-defaults.js';
import { corpusActionPolicy } from '../src/action-capabilities.js';

// One chart supplies one vote per observed parameter. Distinct settings inside
// that chart split its vote equally; repeated stages/calls cannot inflate it.
export function parameterEvidenceCollector() {
  const charts = new Map();
  return {
    add(chartId, parsed) {
      if (!charts.has(chartId)) charts.set(chartId, new Map());
      const methods = charts.get(chartId);
      for (const { method, options } of parsed.calls) {
        const via = corpusActionPolicy(method).via;
        // Create/edit counterparts share option semantics. Radius -> area and
        // other semantic aliases do not: never transfer incompatible units.
        const destinations = [method, ...(via?.startsWith('edit') && method.startsWith('create') &&
          via === `edit${method.slice(6)}` ? [via] : [])];
        for (const name of destinations) {
          if (!methods.has(name)) methods.set(name, new Map());
          const settings = methods.get(name);
          for (const [path, value] of Object.entries(parameterSettings(name, options))) {
            if (!settings.has(path)) settings.set(path, new Map());
            settings.get(path).set(settingKey(value), value);
          }
        }
      }
    },
    finish(provenance) {
      const methods = {};
      for (const chart of charts.values()) for (const [method, settings] of chart) {
        const record = methods[method] ??= { charts: 0, settings: {} };
        record.charts++;
        for (const [path, values] of settings) {
          const setting = record.settings[path] ??= { charts: 0, values: new Map() };
          setting.charts++;
          for (const [key, value] of values) {
            const entry = setting.values.get(key) ?? { value, charts: 0, weight: 0 };
            entry.charts++; entry.weight += 1 / values.size;
            setting.values.set(key, entry);
          }
        }
      }
      for (const record of Object.values(methods)) for (const setting of Object.values(record.settings)) {
        setting.values = [...setting.values.values()].sort((a, b) => b.weight - a.weight || b.charts - a.charts ||
          settingKey(a.value).localeCompare(settingKey(b.value), 'en'));
      }
      return { version: 1, provenance, policy: 'one-vote-per-chart-and-explicit-parameter-split-across-distinct-values', methods };
    },
  };
}
