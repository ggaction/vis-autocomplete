import { createImportClient } from './import-client.js';
import { DATE_FORMATS, DEFAULT_MISSING_TOKENS } from '../src/data-import.js';

const node = (tag, text, className) => {
  const value = document.createElement(tag); if (text !== undefined) value.textContent = text;
  if (className) value.className = className; return value;
};
const select = (choices, value, label) => {
  const element = node('select'); element.setAttribute('aria-label', label);
  for (const [key, text] of choices) { const option = node('option', text); option.value = key; element.append(option); }
  element.value = value; return element;
};
const dateLabels = { auto: 'Auto (unambiguous)', iso: 'ISO date / time', 'month-name': 'Jan 1 2000',
  'year-month-name': '2000 JAN', mdy: 'Month/Day/Year', dmy: 'Day/Month/Year', ymd: 'Year/Month/Day', year: 'Year', timestamp: 'Unix milliseconds' };

export function importReviewSettings(previous, options = {}) {
  return { ...(previous?.options ?? {}), name: previous?.metadata.name ?? 'Dataset', ...options,
    missingTokens: options.missingTokens ?? previous?.options.missingTokens ?? DEFAULT_MISSING_TOKENS,
    allowUnusable: true, fieldOverrides: structuredClone(options.fieldOverrides ?? previous?.options.fieldOverrides ?? {}) };
}

const orderError = 'Enter a JSON list, for example ["low","medium","high"].';
const parseOrder = text => {
  if (!text.trim()) return { value: undefined, error: '' };
  try {
    const value = JSON.parse(text);
    if (!Array.isArray(value) || value.some(item => item !== null && !['string', 'number', 'boolean'].includes(typeof item)
      || typeof item === 'number' && !Number.isFinite(item))) throw new Error();
    return { value, error: '' };
  } catch { return { error: orderError }; }
};

// Raw text belongs to the editing session, not to a successful worker result.
// A refresh must not turn an invalid or not-yet-blurred draft into an empty order.
export function createCategoryOrderDrafts(fieldOverrides) {
  const text = new Map();
  return {
    read(name) { return text.has(name) ? text.get(name) : fieldOverrides[name]?.order ? JSON.stringify(fieldOverrides[name].order) : ''; },
    write(name, value) { text.set(name, value); },
    error(name) { return fieldOverrides[name]?.type === 'ordinal' ? parseOrder(this.read(name)).error : ''; },
    commit() {
      const active = [...text].filter(([name]) => fieldOverrides[name]?.type === 'ordinal');
      const errors = active.flatMap(([name, value]) => { const error = parseOrder(value).error; return error ? [{ name, error }] : []; });
      if (errors.length) return { valid: false, errors };
      for (const [name, value] of active) fieldOverrides[name] = { ...fieldOverrides[name], order: parseOrder(value).value };
      return { valid: true, errors: [] };
    },
  };
}

// Accepts a file's text + options, raw row objects, or an existing import record.
// Cancel always returns null; callers must only replace their session on Apply.
export function reviewDatasetImport(input, options = {}) {
  const previous = input?.metadata?.version ? input : null;
  const settings = importReviewSettings(previous, options);
  const orderDrafts = createCategoryOrderDrafts(settings.fieldOverrides), orderInputs = new Map();
  const source = previous ?? input, client = createImportClient();
  const dialog = node('dialog', undefined, 'dataset-import-dialog'); dialog.setAttribute('aria-labelledby', 'import-heading');
  const title = node('h2', 'Review dataset'); title.id = 'import-heading';
  const heading = node('div', undefined, 'import-heading'); heading.append(title, node('span', settings.name, 'import-name'));
  const status = node('p', 'Reading dataset…', 'import-status'); status.setAttribute('role', 'status');
  const settingsRow = node('div', undefined, 'import-settings');
  const missingLabel = node('label', 'Missing values'); const missing = node('input'); missing.type = 'text';
  missing.value = settings.missingTokens.filter(v => v !== '').join(', '); missing.placeholder = 'NA, N/A, null'; missingLabel.append(missing);
  const pathLabel = node('label', 'Row path'); const path = node('input'); path.type = 'text'; path.value = settings.rowPath ?? ''; path.placeholder = 'Optional, e.g. results.rows'; pathLabel.append(path);
  const flattenLabel = node('label', undefined, 'import-checkbox'); const flatten = node('input'); flatten.type = 'checkbox'; flatten.checked = settings.flattenNested !== false;
  flattenLabel.append(flatten, node('span', 'Expand nested object fields'));
  const reinterpret = node('button', 'Update preview'); reinterpret.type = 'button';
  settingsRow.append(missingLabel, pathLabel, flattenLabel, reinterpret);
  const search = node('input', undefined, 'import-field-search'); search.type = 'search'; search.placeholder = 'Find a field'; search.setAttribute('aria-label', 'Find an imported field');
  const warnings = node('div', undefined, 'import-warnings');
  const scroll = node('div', undefined, 'import-schema-scroll');
  const table = node('table'); const head = node('thead'), row = node('tr');
  for (const text of ['Field', 'Interpretation', 'Sample', 'Missing / invalid']) row.append(node('th', text));
  head.append(row); const body = node('tbody'); table.append(head, body); scroll.append(table);
  const footer = node('div', undefined, 'import-footer');
  const note = node('span', 'Original values are retained.', 'import-note');
  const cancel = node('button', 'Cancel'); cancel.type = 'button';
  const apply = node('button', previous ? 'Apply schema' : 'Use dataset'); apply.type = 'button'; apply.disabled = true;
  footer.append(note, cancel, apply); dialog.append(heading, status, settingsRow, warnings, search, scroll, footer);
  document.body.append(dialog); dialog.showModal();
  let result = null, closed = false, generation = 0;
  return new Promise(resolve => {
    const finish = value => { if (closed) return; closed = true; client.cancel(); dialog.close(); dialog.remove(); resolve(value); };
    cancel.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    apply.addEventListener('click', () => { if (result && !apply.disabled && [...dialog.querySelectorAll('input')].every(input => input.reportValidity())) finish(result); });
    const filter = () => { for (const tr of body.children) tr.hidden = !tr.dataset.field.toLowerCase().includes(search.value.trim().toLowerCase()); };
    search.addEventListener('input', filter);
    const settingsChanged = () => {
      // Global settings use an explicit preview step. Never accept a previous
      // interpretation while the text boxes show unapplied new settings.
      generation++; client.cancel(); result = null; apply.disabled = true;
      dialog.removeAttribute('aria-busy');
      status.textContent = 'Update preview to review these settings.';
    };
    missing.addEventListener('input', settingsChanged); path.addEventListener('input', settingsChanged);
    const renderFields = () => {
      body.replaceChildren(); orderInputs.clear();
      for (const field of result.schema) {
        const sourceName = field.sourceName ?? field.name;
        const tr = node('tr'); tr.dataset.field = `${sourceName} ${field.name}`;
        const name = node('td'); name.className = 'import-field-name';
        const includeLabel = node('label', undefined, 'import-include'); const include = node('input'); include.type = 'checkbox'; include.checked = field.included !== false;
        include.setAttribute('aria-label', `Include ${sourceName}`); includeLabel.append(include, node('span', sourceName));
        const rename = node('input'); rename.type = 'text'; rename.value = field.name; rename.setAttribute('aria-label', `${sourceName}: column name`); rename.required = include.checked;
        name.append(includeLabel, rename);
        const editor = node('td'), override = settings.fieldOverrides[sourceName] ?? {};
        const type = select([['auto', `Auto → ${field.type}`], ['quantitative', 'Number'], ['nominal', 'Category'], ['ordinal', 'Ordered category'], ['temporal', 'Date / time']], override.type ?? 'auto', `${field.name}: type`);
        const date = select(DATE_FORMATS.map(v => [v, dateLabels[v]]), override.dateFormat ?? 'auto', `${field.name}: date format`);
        date.hidden = field.type !== 'temporal' && !result.metadata.warnings.some(w => w.code === 'date-format' && w.field === field.name);
        const numeric = select([['auto', 'Decimal point / grouped thousands'], ['comma-decimal', 'Decimal comma (1.234,56)']], override.numericFormat ?? 'auto', `${field.name}: number format`);
        numeric.hidden = field.type !== 'quantitative';
        const invalid = select([['keep', 'Keep invalid values'], ['exclude', 'Treat invalid values as missing']], override.invalid ?? 'keep', `${field.name}: invalid values`);
        invalid.hidden = !field.invalid;
        const order = node('input'); order.type = 'text'; order.setAttribute('aria-label', `${field.name}: category order`); order.placeholder = 'Order as JSON, e.g. [1,2,3]';
        order.value = orderDrafts.read(sourceName); order.hidden = field.type !== 'ordinal';
        order.setCustomValidity(orderDrafts.error(sourceName)); orderInputs.set(sourceName, order);
        const updateField = changes => { settings.fieldOverrides[sourceName] = { ...settings.fieldOverrides[sourceName], ...changes }; refresh(); };
        rename.addEventListener('input', () => {
          settings.fieldOverrides[sourceName] = { ...settings.fieldOverrides[sourceName], name: rename.value };
          settingsChanged();
        });
        rename.addEventListener('change', () => updateField({ name: rename.value }));
        include.addEventListener('change', () => { rename.required = include.checked; updateField({ exclude: !include.checked }); });
        type.addEventListener('change', () => updateField({ type: type.value }));
        date.addEventListener('change', () => updateField({ type: 'temporal', dateFormat: date.value }));
        numeric.addEventListener('change', () => updateField({ numericFormat: numeric.value }));
        invalid.addEventListener('change', () => updateField({ invalid: invalid.value }));
        order.addEventListener('input', () => {
          orderDrafts.write(sourceName, order.value);
          order.setCustomValidity(orderDrafts.error(sourceName));
          settingsChanged();
        });
        order.addEventListener('change', () => { orderDrafts.write(sourceName, order.value); refresh(); });
        editor.append(type, date, numeric, invalid, order);
        const sample = node('td', field.sample.map(value => value === null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)).join(' · ')); sample.title = sample.textContent;
        const counts = node('td', `${field.missing} / ${field.invalid}`); if (field.reason) counts.append(node('small', field.reason));
        tr.append(name, editor, sample, counts); body.append(tr);
      }
      filter();
    };
    const refresh = async () => {
      // Validate before replacing fields or launching a worker. Other field
      // changes and Update preview use this same gate, retaining the draft UI.
      const drafts = orderDrafts.commit();
      for (const [name, input] of orderInputs) input.setCustomValidity(orderDrafts.error(name));
      if (!drafts.valid || ![...dialog.querySelectorAll('input')].every(input => input.reportValidity())) {
        settingsChanged();
        status.textContent = drafts.errors[0]?.error ?? 'Correct the highlighted field before updating the preview.';
        if (drafts.errors[0]) orderInputs.get(drafts.errors[0].name)?.reportValidity();
        return;
      }
      const version = ++generation; apply.disabled = true; result = null; dialog.setAttribute('aria-busy', 'true');
      settings.missingTokens = ['', ...missing.value.split(',').map(v => v.trim()).filter(Boolean)]; settings.rowPath = path.value.trim() || undefined; settings.flattenNested = flatten.checked;
      status.textContent = 'Interpreting all rows…'; status.classList.remove('import-error');
      try {
        const next = await client.import(source, settings, text => { if (!closed && version === generation) status.textContent = text; });
        if (closed || version !== generation) return;
        result = next; status.textContent = `${next.rows.length.toLocaleString()} rows · ${next.schema.length} fields · ${next.metadata.conversions.length} field interpretations`;
        warnings.replaceChildren(...next.metadata.warnings.map(value => node('p', value.message)));
        renderFields(); apply.disabled = !next.schema.some(field => field.usable);
        if (apply.disabled) status.textContent += ' · Review at least one field to continue.';
      } catch (error) { if (!closed && version === generation && error.name !== 'AbortError') { status.textContent = error.message; status.classList.add('import-error'); } }
      finally { if (!closed && version === generation) dialog.removeAttribute('aria-busy'); }
    };
    reinterpret.addEventListener('click', refresh); flatten.addEventListener('change', refresh);
    refresh();
  });
}
