const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};

function fileFormat(file) {
  const format = /\.(csv|json)$/i.exec(file?.name ?? '')?.[1].toLowerCase();
  if (!format) throw new Error('Only .csv and .json files are supported. Export spreadsheets as CSV first.');
  if (!file.size) throw new Error('This file is empty. Choose a CSV or JSON file with data rows.');
  return format;
}

// File-picker selections and drops share the same validation. File names are
// unavailable during some native drags, so validation is repeated on drop.
function dragError(transfer) {
  if (!transfer) return 'Choose a CSV or JSON file.';
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
  const input = node('input'); input.id = 'file'; input.type = 'file'; input.accept = '.csv,.json'; input.hidden = true;
  const zone = node('button', undefined, 'dataset-drop-zone'); zone.type = 'button'; zone.autofocus = true;
  zone.setAttribute('aria-label', 'Choose a dataset file'); zone.setAttribute('aria-describedby', 'upload-formats upload-status');
  zone.append(node('span', 'Drag your dataset here', 'upload-prompt'), node('span', 'or click to browse files', 'upload-browse'));
  const formats = node('span', undefined, 'upload-formats'); formats.id = 'upload-formats';
  for (const [label, description] of [
    ['CSV (.csv)', 'Comma-separated values, with column names in the first row.'],
    ['JSON (.json)', 'A list of row objects. For nested data, choose a row path in the next step.'],
  ]) {
    const row = node('span', undefined, 'upload-format');
    row.append(node('strong', label), node('span', description)); formats.append(row);
  }
  zone.append(formats);
  const status = node('p', 'One file at a time. You can review fields before importing.', 'upload-status');
  status.id = 'upload-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  dialog.append(heading, zone, status, input);
  document.body.append(dialog); dialog.showModal();
  return new Promise(resolve => {
    const controller = new AbortController(), options = { signal: controller.signal };
    let closed = false, reading = false;
    const finish = value => {
      if (closed) return;
      closed = true; controller.abort(); dialog.close(); dialog.remove(); resolve(value);
    };
    const message = (text, error = false) => { status.textContent = text; status.classList.toggle('import-error', error); };
    const accept = async files => {
      if (closed || reading || !files.length) return;
      try {
        if (files.length !== 1) throw new Error('Choose one dataset file at a time.');
        const file = files[0], format = fileFormat(file);
        reading = true; zone.disabled = true; dialog.setAttribute('aria-busy', 'true');
        message(`Reading ${file.name}…`);
        const text = await file.text();
        if (!text.trim()) throw new Error('This file is empty. Choose a CSV or JSON file with data rows.');
        finish({ name: file.name, format, text });
      } catch (error) { if (!closed) message(error.message, true); }
      finally { reading = false; zone.disabled = false; dialog.removeAttribute('aria-busy'); input.value = ''; }
    };
    zone.addEventListener('click', () => input.click(), options);
    input.addEventListener('change', () => accept([...input.files]), options);
    cancel.addEventListener('click', () => finish(null), options);
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); }, options);
    dialog.addEventListener('close', () => finish(null), options);
    // Also suppress drops outside the zone while the modal is open, preventing
    // the browser from navigating away from an unsaved visualization.
    document.addEventListener('dragover', event => {
      event.preventDefault();
      const inside = zone.contains(event.target), error = dragError(event.dataTransfer);
      zone.dataset.drag = inside && !reading ? error ? 'invalid' : 'ready' : '';
      if (event.dataTransfer) event.dataTransfer.dropEffect = inside && !error && !reading ? 'copy' : 'none';
      if (inside && !reading) message(error || 'Drop a CSV or JSON file here.', Boolean(error));
    }, options);
    document.addEventListener('dragleave', event => {
      if (!zone.contains(event.relatedTarget)) zone.dataset.drag = '';
    }, options);
    document.addEventListener('drop', event => {
      event.preventDefault(); zone.dataset.drag = '';
      if (reading) return;
      if (!zone.contains(event.target)) { message('Drop the file inside the dashed area.', true); return; }
      const transfer = event.dataTransfer, error = dragError(transfer);
      if (error) { message(error, true); return; }
      if ([...transfer.items].some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
        message('Folders are not supported. Choose a CSV or JSON file.', true); return;
      }
      if (!transfer.files.length) { message('Choose a CSV or JSON file, not a folder or link.', true); return; }
      accept([...transfer.files]);
    }, options);
  });
}
