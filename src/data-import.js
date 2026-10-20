// One explicit import pipeline for files, built-in tables and schema edits.
// Originals are retained; only `rows` is passed to the chart authoring layer.
export const IMPORT_VERSION = 1;
export const DEFAULT_MISSING_TOKENS = ['', 'NA', 'N/A', 'null'];
export const DATE_FORMATS = ['auto', 'iso', 'month-name', 'year-month-name', 'mdy', 'dmy', 'ymd', 'year', 'timestamp'];
const types = new Set(['auto', 'quantitative', 'nominal', 'ordinal', 'temporal']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);

export class DataImportError extends Error {
  constructor(message, details = {}) { super(message); this.name = 'DataImportError'; Object.assign(this, details); }
}

export function readCSV(source, { headerPolicy = 'reject' } = {}) {
  const records = [], lines = []; let row = [], cell = '', state = 'start', line = 1, rowLine = 1, delimited = false;
  const finishCell = () => { row.push(cell); cell = ''; state = 'start'; };
  const finishRow = () => {
    finishCell();
    if (delimited || row.length > 1 || row[0] !== '') { records.push(row); lines.push(rowLine); }
    row = []; delimited = false; rowLine = line + 1;
  };
  source = String(source).replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (state === 'quoted') {
      if (c === '"') { if (source[i + 1] === '"') { cell += '"'; i++; } else state = 'closed'; }
      else { cell += c; if (c === '\n') line++; }
      continue;
    }
    if (c === ',') { finishCell(); delimited = true; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      finishRow(); line++; continue;
    }
    if (state === 'closed') {
      if (c === ' ' || c === '\t') continue;
      throw new DataImportError(`Unexpected character after a quoted value at row ${line}, column ${row.length + 1}.`, { row: line, column: row.length + 1 });
    }
    if (c === '"') {
      if (state !== 'start') throw new DataImportError(`Unexpected quote at row ${line}, column ${row.length + 1}.`, { row: line, column: row.length + 1 });
      state = 'quoted'; continue;
    }
    cell += c; state = 'unquoted';
  }
  if (state === 'quoted') throw new DataImportError(`Unclosed quoted value starting at row ${rowLine}, column ${row.length + 1}.`, { row: rowLine, column: row.length + 1 });
  finishRow();
  if (!records.length) throw new DataImportError('The CSV has no header row.');
  const rawHeaders = records.shift(), headerChanges = [], seen = new Set(); lines.shift();
  const headers = rawHeaders.map((raw, i) => {
    let name = raw.trim();
    if (!name || seen.has(name)) {
      if (headerPolicy !== 'repair') throw new DataImportError(`Use unique, non-empty column names (column ${i + 1}).`, { row: 1, column: i + 1 });
      const base = name || `Column ${i + 1}`; name = base;
      for (let suffix = 2; seen.has(name); suffix++) name = `${base} (${suffix})`;
    }
    seen.add(name); if (name !== raw) headerChanges.push({ index: i, from: raw, to: name });
    return name;
  });
  const rows = records.map((record, i) => {
    if (record.length !== headers.length) throw new DataImportError(`Row ${lines[i]} has ${record.length} cells; expected ${headers.length}. No values were discarded.`, { row: lines[i], expected: headers.length, actual: record.length });
    return Object.fromEntries(headers.map((header, index) => [header, record[index]]));
  });
  return { rows, headers, rawHeaders, headerChanges, records };
}

// Compatibility parser: source values are interpreted by the same import path.
export function parseCSV(source, options = {}) {
  return importDataset(source, { ...options, format: 'csv', headerPolicy: options.headerPolicy ?? 'reject' }).rows;
}

function jsonPreservingIntegers(source) {
  let out = '', inString = false, escaped = false; const preserved = [];
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (inString) { out += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; continue; }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '-' || /\d/.test(c)) {
      const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(i))?.[0];
      if (token) {
        if (/^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token))) { out += JSON.stringify(token); preserved.push(token); }
        else out += token;
        i += token.length - 1; continue;
      }
    }
    out += c;
  }
  return { value: JSON.parse(out), preserved };
}

export function parseNumericValue(value, { numericFormat = 'auto', explicit = false } = {}) {
  if (typeof value === 'number') return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  if (typeof value !== 'string') return { ok: false };
  let text = value.trim();
  if (!explicit && /^[+-]?0\d/.test(text)) return { ok: false, identifier: true };
  if (numericFormat === 'comma-decimal') text = text.replace(/\./g, '').replace(',', '.');
  else if (/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) text = text.replace(/,/g, '');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return { ok: false };
  const number = Number(text);
  if (!Number.isFinite(number)) return { ok: false };
  if (/^[+-]?\d+$/.test(text) && !Number.isSafeInteger(number)) return { ok: false, unsafeInteger: true };
  return { ok: true, value: number };
}

const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function utcDate(year, month = 1, day = 1) {
  const d = new Date(0); d.setUTCFullYear(Number(year), Number(month) - 1, Number(day)); d.setUTCHours(0, 0, 0, 0);
  return d.getUTCFullYear() === Number(year) && d.getUTCMonth() === Number(month) - 1 && d.getUTCDate() === Number(day) ? d : null;
}
export function parseDateValue(value, format = 'auto') {
  if (format === 'timestamp' && Number.isFinite(Number(value))) { const date = new Date(Number(value)); return Number.isFinite(+date) ? date.toISOString() : null; }
  const text = typeof value === 'string' || format === 'year' ? String(value).trim() : '';
  let m, date;
  if ((format === 'auto' || format === 'iso') && (m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(text))) {
    if (!utcDate(m[1], m[2], m[3])) return null;
    if (!m[4]) return `${m[1]}-${m[2]}-${m[3]}`;
    if (!/^[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s?(?:Z|[+-]\d{2}:?\d{2}))?$/.test(m[4])) return null;
    const iso = text.replace(' ', 'T').replace(/\s([+-]\d{2}:?\d{2})$/, '$1');
    const timestamp = Date.parse(/[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }
  if ((format === 'auto' || format === 'month-name') && (m = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(text))) {
    const month = months.indexOf(m[1].slice(0, 3).toLowerCase()); if (month < 0) return null;
    date = utcDate(m[3], month + 1, m[2]);
  } else if ((format === 'auto' || format === 'year-month-name') && (m = /^(\d{4})\s+([A-Za-z]+)$/.exec(text))) {
    const month = months.indexOf(m[2].slice(0, 3).toLowerCase()); if (month < 0) return null; date = utcDate(m[1], month + 1);
  } else if (format === 'year' && /^\d{4}$/.test(text)) date = utcDate(text);
  else if (['ymd', 'mdy', 'dmy'].includes(format) && (m = /^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})$/.exec(text))) {
    if ((format === 'ymd' ? m[1] : m[3]).length !== 4) return null;
    date = format === 'ymd' ? utcDate(m[1], m[2], m[3]) : format === 'mdy' ? utcDate(m[3], m[1], m[2]) : utcDate(m[3], m[2], m[1]);
  }
  return date ? date.toISOString().slice(0, 10) : null;
}
export const isTemporalValue = value => typeof value === 'string' && parseDateValue(value, 'iso') !== null;

function flattenRow(row, enabled, reserved) {
  if (!enabled) return row;
  const result = Object.create(null);
  const put = (name, value) => {
    let key = name; for (let suffix = 2; own(result, key) || (name.includes('.') && reserved.has(key)); suffix++) key = `${name} (${suffix})`;
    result[key] = value;
  };
  const visit = (value, path) => {
    if (plain(value) && Object.keys(value).length) for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`);
    else put(path, value);
  };
  for (const [key, value] of Object.entries(row)) {
    if (plain(value) && Object.keys(value).length) visit(value, key); else result[key] = value;
  }
  return result;
}

export function importDataset(input, options = {}) {
  if (input?.metadata?.version && Array.isArray(input.rawRows)) {
    const record = input, fileSource = record.metadata.sourceText;
    input = fileSource ?? record.metadata.sourceDocument ?? record.rawRows;
    options = { ...record.options, ...options, format: fileSource ? record.metadata.format : 'rows', originalMetadata: record.metadata };
  }
  const format = options.format ?? (typeof input === 'string' ? 'json' : 'rows');
  const settings = { name: options.name ?? 'Dataset', format, headerPolicy: 'repair', flattenNested: true,
    missingTokens: DEFAULT_MISSING_TOKENS, fieldOverrides: {}, ...options };
  const warnings = [], conversions = []; let rawRows, sourceText, sourceDocument, headers = [], rawHeaders = [], records;
  if (format === 'csv') {
    sourceText = String(input); const csv = readCSV(sourceText, settings); rawRows = csv.rows; ({ headers, rawHeaders, records } = csv);
    for (const change of csv.headerChanges) warnings.push({ code: 'header-repaired', ...change, message: `Column ${change.index + 1}: “${change.from}” → “${change.to}”.` });
  } else if (format === 'json') {
    sourceText = String(input); const parsed = jsonPreservingIntegers(sourceText); rawRows = parsed.value;
    if (parsed.preserved.length) warnings.push({ code: 'unsafe-integer', count: parsed.preserved.length, message: `${parsed.preserved.length} large integer values were preserved as exact text.` });
  } else { rawRows = clone(input); if (settings.rowPath) sourceDocument = clone(input); }
  if (settings.rowPath) for (const key of settings.rowPath.split('.')) rawRows = rawRows?.[key];
  if (!Array.isArray(rawRows) || !rawRows.length || rawRows.some(row => !plain(row))) throw new DataImportError('Choose a non-empty table: an array of row objects. Nested documents can use a row path.');
  const reserved = new Set(rawRows.flatMap(Object.keys));
  const sourceRows = rawRows.map(row => flattenRow(row, settings.flattenNested, reserved));
  const keys = [...new Set(sourceRows.flatMap(Object.keys))], used = new Set(), fieldNames = new Map();
  for (const [index, key] of keys.entries()) {
    let name = key.trim();
    if (!name || used.has(name)) {
      if (settings.headerPolicy === 'reject') throw new DataImportError('Use unique, non-empty column names.');
      const base = name || `Column ${index + 1}`; name = base; for (let suffix = 2; used.has(name); suffix++) name = `${base} (${suffix})`;
    }
    if (name !== key) warnings.push({ code: 'header-repaired', from: key, to: name, message: `Column “${key}” is named “${name}”.` });
    used.add(name); fieldNames.set(key, name);
  }
  const rows = sourceRows.map(row => Object.fromEntries([...fieldNames].map(([key, name]) => [name, own(row, key) ? clone(row[key]) : null])));
  const fieldTypes = {}, schema = [], missingTokens = new Set(settings.missingTokens.map(value => String(value).trim().toLowerCase()));
  const projectedNames = new Set(), projection = [];
  for (const name of fieldNames.values()) {
    const override = typeof settings.fieldOverrides[name] === 'string' ? { type: settings.fieldOverrides[name] } : settings.fieldOverrides[name] ?? {};
    if (!types.has(override.type ?? 'auto')) throw new DataImportError(`Unsupported type for ${name}: ${override.type}`);
    if (!DATE_FORMATS.includes(override.dateFormat ?? 'auto')) throw new DataImportError(`Unsupported date format for ${name}: ${override.dateFormat}`);
    const outputName = override.name === undefined ? name : String(override.name).trim();
    const included = override.exclude !== true;
    if (included && (!outputName || projectedNames.has(outputName))) throw new DataImportError(`Use a unique, non-empty name for ${name}.`);
    if (included) { projectedNames.add(outputName); projection.push([name, outputName]); }
    const tokens = override.missingTokens ? new Set(override.missingTokens.map(v => String(v).trim().toLowerCase())) : missingTokens;
    let missing = 0, invalid = 0, converted = 0;
    const values = rows.map(row => { const value = row[name];
      if (value === null || value === undefined || typeof value === 'string' && tokens.has(value.trim().toLowerCase())) { if (value !== null) converted++; row[name] = null; missing++; return null; }
      return value;
    });
    const present = values.filter(value => value !== null), numbers = present.map(value => parseNumericValue(value, { ...override, explicit: override.type === 'quantitative' }));
    const boolean = present.length > 0 && present.every(value => typeof value === 'boolean' || typeof value === 'string' && /^(true|false)$/i.test(value.trim()));
    let dateFormat = override.dateFormat ?? 'auto';
    const dateCandidates = present.map(value => parseDateValue(value, dateFormat));
    const numeric = present.length > 0 && numbers.every(v => v.ok), temporal = present.length > 0 && dateCandidates.every(Boolean);
    const type = override.type && override.type !== 'auto' ? override.type : numeric ? 'quantitative' : temporal ? 'temporal' : 'nominal';
    const stringifyCategories = override.type && ['nominal', 'ordinal'].includes(type) && new Set(present.map(value => typeof value)).size > 1;
    if (!temporal && dateFormat === 'auto' && present.some(value => typeof value === 'string' && /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(value.trim()))) {
      warnings.push({ code: 'date-format', field: name, message: `${name}: choose Month/Day/Year or Day/Month/Year to interpret these dates.` });
    }
    for (const row of rows) {
      const value = row[name]; if (value === null) continue;
      let parsed = value, ok = true;
      if (type === 'quantitative') { const result = parseNumericValue(value, { ...override, explicit: override.type === 'quantitative' }); ok = result.ok; parsed = result.value; }
      else if (type === 'temporal') { parsed = parseDateValue(value, dateFormat); ok = parsed !== null; }
      else if (boolean && typeof value === 'string') parsed = value.trim().toLowerCase() === 'true';
      else if (plain(value) || Array.isArray(value) || typeof value === 'number' && !Number.isFinite(value)) ok = false;
      else if (stringifyCategories) parsed = String(value);
      if (!ok) { invalid++; if (override.invalid === 'exclude') { row[name] = null; missing++; converted++; } continue; }
      if (parsed !== value) { row[name] = parsed; converted++; }
    }
    const normalizedTypes = new Set(rows.map(row => row[name]).filter(value => value !== null).map(value => typeof value));
    const usable = rows.some(row => row[name] !== null) && (invalid === 0 || override.invalid === 'exclude') && normalizedTypes.size <= 1;
    if (included) fieldTypes[outputName] = override.order?.length ? { type, order: clone(override.order) } : type;
    const field = { name: outputName, sourceName: name, included, type, dateFormat: type === 'temporal' ? dateFormat : undefined, missing, invalid, converted, usable: included && usable,
      order: override.order, sample: rows.slice(0, 3).map(row => row[name]), rawSample: values.slice(0, 3),
      reason: usable ? '' : invalid ? `${invalid} values do not match ${type}; choose another type or exclude invalid values.` : normalizedTypes.size > 1 ? 'Mixed numbers and text; choose Number with invalid-value handling, or Category.' : 'No values remain after missing-value handling.' };
    schema.push(field);
    if (converted || override.type || override.order || outputName !== name || !included) conversions.push({ field: name, name: outputName, included, type, dateFormat, numericFormat: override.numericFormat ?? 'auto', missingTokens: [...tokens], invalid: override.invalid ?? 'keep', converted, invalidCount: invalid, order: override.order });
    if (invalid) warnings.push({ code: 'invalid-values', field: name, count: invalid, message: field.reason || `${name}: ${invalid} invalid values were excluded.` });
  }
  if (!schema.length || !settings.allowUnusable && !schema.some(field => field.usable)) throw new DataImportError('No usable fields were found. Check the row path, nested fields, types and missing-value settings.', { schema });
  const storageFields = schema.filter(field => field.included).map(field => {
    const available = rows.map(row => row[field.sourceName]).filter(v => v !== null), storedTypes = [...new Set(available.map(v => Array.isArray(v) ? 'array' : typeof v))];
    return storedTypes.length === 1 && ['number', 'string', 'boolean', 'object', 'array'].includes(storedTypes[0]) ? { name: field.name, storageType: storedTypes[0], nullable: available.length < rows.length } : null;
  });
  const projectedRows = rows.map(row => Object.fromEntries(projection.map(([source, target]) => [target, row[source]])));
  return { rows: projectedRows, rawRows: clone(rawRows), fieldTypes, schema, storageSchema: storageFields.every(Boolean) ? { fields: storageFields } : undefined,
    metadata: { version: IMPORT_VERSION, name: settings.name, format: options.originalMetadata?.format ?? format, rowCount: rows.length,
      headers, rawHeaders, ...(records ? { rawRecords: records } : {}), ...(sourceText ? { sourceText } : options.originalMetadata?.sourceText ? { sourceText: options.originalMetadata.sourceText } : {}),
      ...(sourceDocument ? { sourceDocument } : {}),
      flattened: settings.flattenNested, fields: schema, conversions, warnings }, options: { ...settings, originalMetadata: undefined } };
}
