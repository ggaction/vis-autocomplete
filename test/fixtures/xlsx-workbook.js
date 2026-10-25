// Small typed OOXML fixtures, generated for import tests rather than saved
// user documents. Numeric Excel serials keep the date oracle timezone-neutral.
import { utils, write } from 'xlsx';

export function workbookBytes(sheets, properties = {}) {
  const workbook = utils.book_new();
  for (const { name, rows, cells = {}, ref } of sheets) {
    const sheet = utils.aoa_to_sheet(rows); Object.assign(sheet, cells);
    if (ref) sheet['!ref'] = ref;
    utils.book_append_sheet(workbook, sheet, name);
  }
  workbook.Workbook = properties;
  return new Uint8Array(write(workbook, { type: 'array', bookType: 'xlsx' }));
}

export function sampleWorkbook({ single = false } = {}) {
  const sheets = [{ name: '매출 Sales', rows: [
    ['Month', 'Sales', 'Cost', 'Region', 'Recorded', 'Code', 'Active'],
    ['Jan', 120, 90, 'North', 45293, '001', true],
    ['Feb', 150, 100, 'South', 45324, '002', false],
  ], cells: { E2: { t: 'n', v: 45293, z: 'yyyy-mm-dd' }, E3: { t: 'n', v: 45324, z: 'yyyy-mm-dd' } } }];
  if (!single) sheets.push({ name: 'Inventory', rows: [['Product', 'Units', 'Price'], ['Desk', 7, 120], ['Chair', 12, 45]] }, { name: 'Empty', rows: [] });
  return workbookBytes(sheets);
}
