import { read, utils, SSF } from 'xlsx';

const cellErrors = { 0: '#NULL!', 7: '#DIV/0!', 15: '#VALUE!', 23: '#REF!', 29: '#NAME?', 36: '#NUM!', 42: '#N/A', 43: '#GETTING_DATA' };
const present = value => value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '');

function cellValue(cell, date1904) {
  if (cell.v === undefined) return null;
  if (cell.t === 'e') return cellErrors[cell.v] ?? '#ERROR!';
  if (cell.t === 'n' && typeof cell.v === 'number' && cell.z && SSF.is_date(cell.z)) {
    const date = SSF.parse_date_code(cell.v, { date1904 });
    if (date) {
      // Excel dates are wall-clock values, not local-time JavaScript dates.
      // Build ISO text directly to avoid timezone shifts and handle 1904 books.
      const pad = (value, width = 2) => String(value).padStart(width, '0');
      const milliseconds = Math.min(999, Math.round((date.u ?? 0) * 1000));
      return `${pad(date.y, 4)}-${pad(date.m)}-${pad(date.d)}T${pad(date.H)}:${pad(date.M)}:${pad(date.S)}.${pad(milliseconds, 3)}Z`;
    }
  }
  return cell.v ?? null;
}

function sheetTable(sheet, date1904) {
  const rows = new Map(); let firstColumn = Infinity, lastColumn = -1, formulas = 0, uncached = 0, errors = 0;
  // Walk stored cells rather than !ref: Excel often formats a whole sheet even
  // when it contains only a small table. Do not expand that range into memory.
  for (const [address, cell] of Object.entries(sheet ?? {})) {
    if (!/^[A-Z]{1,3}[1-9]\d*$/.test(address)) continue;
    if (cell.f) { formulas++; if (cell.v === undefined) uncached++; }
    if (cell.t === 'e' && cell.v !== undefined) errors++;
    const value = cellValue(cell, date1904);
    if (!present(value) && !cell.f) continue;
    const { r, c } = utils.decode_cell(address);
    if (!rows.has(r)) rows.set(r, new Map());
    rows.get(r).set(c, value); firstColumn = Math.min(firstColumn, c); lastColumn = Math.max(lastColumn, c);
  }
  const width = lastColumn - firstColumn + 1;
  if (rows.size * width > 2_000_000) throw new Error('This sheet is too large to import. Use a smaller table (up to 2 million cells).');
  const table = [...rows].sort(([a], [b]) => a - b).map(([, cells]) =>
    Array.from({ length: width }, (_, column) => cells.get(column + firstColumn) ?? null));
  const warnings = [];
  if (formulas) warnings.push({ code: 'excel-formulas', count: formulas, message: 'Formula cells use the results saved in Excel; formulas are not recalculated here.' });
  if (uncached) warnings.push({ code: 'excel-uncached-formulas', count: uncached, message: `${uncached} formula cells have no saved result and are empty. Recalculate and save the workbook in Excel to import their results.` });
  if (errors) warnings.push({ code: 'excel-cell-errors', count: errors, message: `${errors} Excel error cells were kept as text. Review their field types or mark them as missing values.` });
  return { table, warnings };
}

export function readWorkbook(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) {
    throw new Error('This is not a readable .xlsx workbook. If it is password-protected, save an unprotected .xlsx copy first.');
  }
  let workbook;
  try { workbook = read(bytes, { type: 'array', cellDates: false, cellNF: true, cellText: false, cellHTML: false, cellFormula: true }); }
  catch { throw new Error('Could not read this workbook. Save it as an Excel .xlsx file and try again.'); }
  if (!workbook.SheetNames?.length) throw new Error('This workbook has no worksheets.');
  return workbook.SheetNames.map((name, index) => {
    try {
      const data = sheetTable(workbook.Sheets[name], Boolean(workbook.Workbook?.WBProps?.date1904));
      return { name, hidden: Boolean(workbook.Workbook?.Sheets?.[index]?.Hidden), ...data };
    } catch (error) { return { name, table: [], warnings: [], error: error.message }; }
  });
}

export function describeWorkbook(sheets) {
  return sheets.map(({ name, hidden, table, error }) => ({ name, hidden, error,
    rows: Math.max(0, table.length - 1), columns: table[0]?.length ?? 0,
    preview: table.slice(0, 6).map(row => row.slice(0, 6)) }));
}
