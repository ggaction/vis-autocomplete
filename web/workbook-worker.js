import { readWorkbook, describeWorkbook } from '../src/xlsx-import.js';

let sheets;
self.addEventListener('message', ({ data: { id, action, input } }) => {
  try {
    let result;
    if (action === 'open') { sheets = readWorkbook(input); result = describeWorkbook(sheets); }
    else if (action === 'sheet') {
      const sheet = sheets?.find(sheet => sheet.name === input);
      if (!sheet) throw new Error('Choose a worksheet from this workbook.');
      if (sheet.error) throw new Error(sheet.error);
      if (sheet.table.length < 2) throw new Error('This sheet has no data rows. Choose another sheet.');
      result = { table: sheet.table, warnings: sheet.warnings };
    } else throw new Error('Unknown workbook request.');
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: error.message }); }
});
