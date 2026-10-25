import { createWorkbookClient } from './workbook-client.js';

const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};

function fileFormat(file) {
  const format = /\.(csv|json|xlsx)$/i.exec(file?.name ?? '')?.[1].toLowerCase();
  if (!format) throw new Error('Only .csv, .json and .xlsx files are supported. Save older Excel files as .xlsx first.');
  if (!file.size) throw new Error('This file is empty. Choose a file with data rows.');
  return format;
}

// File-picker selections and drops share the same validation. File names are
// unavailable during some native drags, so validation is repeated on drop.
function dragError(transfer) {
  if (!transfer) return 'Choose a CSV, JSON or XLSX file.';
  const items = [...transfer.items];
  if (items.length > 1 || transfer.files.length > 1) return 'Choose one dataset file at a time.';
  if (items.length && items[0].kind !== 'file') return 'Drop a file, not text or a link.';
  if (transfer.files.length) {
    try { fileFormat(transfer.files[0]); } catch (error) { return error.message; }
  }
  return '';
}

export function chooseDatasetFile() {
  const dialog = node('dialog', undefined, 'dataset-upload-dialog');
  dialog.setAttribute('aria-labelledby', 'upload-heading');
  const heading = node('div', undefined, 'upload-heading');
  const title = node('h2', 'Upload dataset'); title.id = 'upload-heading';
  const cancel = node('button', 'Cancel'); cancel.type = 'button';
  heading.append(title, cancel);
  const input = node('input'); input.id = 'file'; input.type = 'file'; input.accept = '.csv,.json,.xlsx'; input.hidden = true;
  const zone = node('button', undefined, 'dataset-drop-zone'); zone.type = 'button'; zone.autofocus = true;
  zone.setAttribute('aria-label', 'Choose a dataset file'); zone.setAttribute('aria-describedby', 'upload-formats upload-status');
  zone.append(node('span', 'Drag your dataset here', 'upload-prompt'), node('span', 'or click to browse files', 'upload-browse'));
  const formats = node('span', undefined, 'upload-formats'); formats.id = 'upload-formats';
  for (const [label, description] of [
    ['CSV (.csv)', 'Comma-separated values, with column names in the first row.'],
    ['JSON (.json)', 'A list of row objects. For nested data, choose a row path in the next step.'],
    ['Excel (.xlsx)', 'Column names in the first non-empty row. Choose a sheet if there are several.'],
  ]) {
    const row = node('span', undefined, 'upload-format');
    row.append(node('strong', label), node('span', description)); formats.append(row);
  }
  zone.append(formats);
  const status = node('p', 'One file at a time. You can review fields before importing.', 'upload-status');
  status.id = 'upload-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const sheetPanel = node('div', undefined, 'upload-sheets'); sheetPanel.hidden = true;
  const sheetFile = node('p', undefined, 'upload-sheet-file');
  const sheetLabel = node('label', 'Choose a sheet'); const sheetSelect = node('select'); sheetLabel.append(sheetSelect);
  const preview = node('div', undefined, 'upload-sheet-preview');
  const sheetNote = node('p', 'The first non-empty row becomes column names. Formula cells use saved results.', 'upload-status');
  const actions = node('div', undefined, 'upload-sheet-actions');
  const back = node('button', 'Choose another file'); back.type = 'button';
  const useSheet = node('button', 'Use sheet'); useSheet.type = 'button';
  actions.append(back, useSheet); sheetPanel.append(sheetFile, sheetLabel, preview, sheetNote, actions);
  dialog.append(heading, zone, sheetPanel, status, input);
  document.body.append(dialog); dialog.showModal();
  return new Promise(resolve => {
    const controller = new AbortController(), options = { signal: controller.signal };
    let closed = false, reading = false, workbookFile, sheets = [], workbook;
    const finish = value => {
      if (closed) return;
      closed = true; controller.abort(); workbook?.cancel(); dialog.close(); dialog.remove(); resolve(value);
    };
    const message = (text, error = false) => { status.textContent = text; status.classList.toggle('import-error', error); };
    const busy = value => {
      reading = value; zone.disabled = value; back.disabled = value; sheetSelect.disabled = value;
      useSheet.disabled = value || !sheets.find(sheet => sheet.name === sheetSelect.value && sheet.rows && !sheet.error);
      if (value) dialog.setAttribute('aria-busy', 'true'); else dialog.removeAttribute('aria-busy');
    };
    const chooseSheet = async name => {
      busy(true); message(`Reading ${name}…`);
      try {
        const { table, warnings } = await workbook.request('sheet', name);
        if (closed) return;
        finish({ name: `${workbookFile.name.replace(/\.xlsx$/i, '')} — ${name}`, format: 'xlsx', input: table,
          options: { workbook: { fileName: workbookFile.name, sheetName: name, warnings } } });
      } catch (error) { if (!closed) message(error.message, true); }
      finally { busy(false); }
    };
    const showSheet = () => {
      const sheet = sheets.find(sheet => sheet.name === sheetSelect.value); preview.replaceChildren();
      useSheet.disabled = !sheet?.rows || Boolean(sheet.error);
      if (!sheet) return;
      const table = node('table'), head = node('thead'), body = node('tbody'), headers = node('tr');
      for (const [index, value] of (sheet.preview[0] ?? []).entries()) headers.append(node('th', String(value ?? '').trim() || `Column ${index + 1}`));
      head.append(headers);
      for (const values of sheet.preview.slice(1)) { const row = node('tr'); for (const value of values) row.append(node('td', value === null ? '—' : String(value))); body.append(row); }
      table.append(head, body); preview.append(table);
      message(sheet.error || (sheet.rows ? `${sheet.rows.toLocaleString()} rows · ${sheet.columns} columns · Showing up to 5 rows and 6 columns.` : 'This sheet has no data rows. Choose another sheet.'), Boolean(sheet.error || !sheet.rows));
    };
    const accept = async files => {
      if (closed || reading || !files.length) return;
      try {
        if (files.length !== 1) throw new Error('Choose one dataset file at a time.');
        const file = files[0], format = fileFormat(file);
        busy(true);
        message(`Reading ${file.name}…`);
        if (format === 'xlsx') {
          workbook?.cancel(); workbook = createWorkbookClient(); workbookFile = file;
          const bytes = await file.arrayBuffer(); if (closed) return;
          sheets = await workbook.request('open', bytes); if (closed) return;
          if (sheets.length === 1 && sheets[0].rows && !sheets[0].error) { await chooseSheet(sheets[0].name); return; }
          zone.hidden = true; sheetPanel.hidden = false; sheetFile.textContent = file.name;
          sheetSelect.replaceChildren(...sheets.map(sheet => { const option = node('option', `${sheet.name}${sheet.hidden ? ' (hidden)' : ''}${sheet.rows ? ` — ${sheet.rows.toLocaleString()} rows` : ' — no data rows'}`); option.value = sheet.name; return option; }));
          sheetSelect.value = (sheets.find(sheet => sheet.rows && !sheet.error && !sheet.hidden) ?? sheets.find(sheet => sheet.rows && !sheet.error) ?? sheets[0]).name;
          busy(false); showSheet(); sheetSelect.focus(); return;
        }
        const text = await file.text();
        if (!text.trim()) throw new Error('This file is empty. Choose a file with data rows.');
        finish({ name: file.name, format, input: text });
      } catch (error) { if (!closed) message(error.message, true); }
      finally { busy(false); input.value = ''; }
    };
    sheetSelect.addEventListener('change', showSheet, options);
    useSheet.addEventListener('click', () => chooseSheet(sheetSelect.value), options);
    back.addEventListener('click', () => {
      workbook?.cancel(); workbook = null; sheets = []; workbookFile = null;
      sheetPanel.hidden = true; zone.hidden = false; preview.replaceChildren(); sheetSelect.replaceChildren();
      message('One file at a time. You can review fields before importing.'); zone.focus();
    }, options);
    zone.addEventListener('click', () => input.click(), options);
    input.addEventListener('change', () => accept([...input.files]), options);
    cancel.addEventListener('click', () => finish(null), options);
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); }, options);
    dialog.addEventListener('close', () => finish(null), options);
    // Also suppress drops outside the zone while the modal is open, preventing
    // the browser from navigating away from an unsaved visualization.
    document.addEventListener('dragover', event => {
      event.preventDefault();
      const inside = !zone.hidden && zone.contains(event.target), error = dragError(event.dataTransfer);
      zone.dataset.drag = inside && !reading ? error ? 'invalid' : 'ready' : '';
      if (event.dataTransfer) event.dataTransfer.dropEffect = inside && !error && !reading ? 'copy' : 'none';
      if (inside && !reading) message(error || 'Drop a CSV, JSON or XLSX file here.', Boolean(error));
    }, options);
    document.addEventListener('dragleave', event => {
      if (!zone.contains(event.relatedTarget)) zone.dataset.drag = '';
    }, options);
    document.addEventListener('drop', event => {
      event.preventDefault(); zone.dataset.drag = '';
      if (reading) return;
      if (zone.hidden || !zone.contains(event.target)) { message(zone.hidden ? 'Use “Choose another file” to upload a different workbook.' : 'Drop the file inside the dashed area.', true); return; }
      const transfer = event.dataTransfer, error = dragError(transfer);
      if (error) { message(error, true); return; }
      if ([...transfer.items].some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
        message('Folders are not supported. Choose a CSV, JSON or XLSX file.', true); return;
      }
      if (!transfer.files.length) { message('Choose a CSV, JSON or XLSX file, not a folder or link.', true); return; }
      accept([...transfer.files]);
    }, options);
  });
}
