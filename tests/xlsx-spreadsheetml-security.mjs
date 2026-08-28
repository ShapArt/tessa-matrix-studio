import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

// Keep the documented production ceilings under regression control. Runtime tests below
// use tiny Node-only overrides so pathological cases stay fast in CI.
assert(code.includes('MaxRowNumber: 100000'), 'production SpreadsheetML row ceiling drifted from 100000');
assert(code.includes('MaxColumnNumber: 16384'), 'production SpreadsheetML column ceiling drifted from Excel XFD / 16384');
assert(code.includes('MaxParsedRows: 100000'), 'production parsed-row ceiling drifted from 100000');
assert(code.includes('MaxParsedCells: 500000'), 'production parsed-cell ceiling drifted from 500000');

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.__TESSA_MATRIX_SYNC_TEST_SPREADSHEET_LIMITS__ = {
  MaxRowNumber: 10,
  MaxParsedRows: 8,
  MaxParsedCells: 16,
};
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

function worksheet(body) {
  return `<?xml version="1.0" encoding="utf-8"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function expectRejected(xml, expected, label) {
  try {
    E.parseSheetXml(xml, []);
  } catch (error) {
    const message = String(error?.message || error);
    assert(expected.test(message), `${label}: unexpected rejection: ${message}`);
    return;
  }
  throw new Error(`${label}: unsafe SpreadsheetML was accepted`);
}

// Product ceiling: a small XML must not be able to create a 100k+ sparse row array.
expectRejected(
  worksheet('<row r="100001"><c r="A100001" t="str"><v>x</v></c></row>'),
  /XLSX отклонён.*строк|номер строки|100.?000/i,
  'row-number-ceiling',
);

// An implicit row after an explicit row at the ceiling must not bypass MaxRowNumber.
// The implicit cell reference is intentionally omitted too, so the row fallback itself is tested.
expectRejected(
  worksheet('<row r="10"><c r="A10" t="str"><v>x</v></c></row><row><c t="str"><v>y</v></c></row>'),
  /XLSX отклонён.*номер строки|безопасн.*лимит|строк.*10/i,
  'implicit-row-ceiling',
);

// Excel itself ends at XFD (16,384 columns); XFE must never be materialized.
expectRejected(
  worksheet('<row r="1"><c r="XFE1" t="str"><v>x</v></c></row>'),
  /XLSX отклонён.*столб|XFD|16.?384/i,
  'column-ceiling',
);

// A malicious XML can repeat many physical <row> nodes even when row numbers stay small.
const repeatedRows = Array.from({ length: 9 }, (_, index) => `<row r="${index + 1}"><c r="A${index + 1}" t="str"><v>x</v></c></row>`).join('');
expectRejected(
  worksheet(repeatedRows),
  /XLSX отклонён.*слишком много.*строк|лимит.*строк/i,
  'parsed-row-count',
);

// Likewise cap the number of parsed cells independently of column/row coordinates.
globalThis.__TESSA_MATRIX_SYNC_TEST_SPREADSHEET_LIMITS__.MaxRowNumber = 100;
globalThis.__TESSA_MATRIX_SYNC_TEST_SPREADSHEET_LIMITS__.MaxParsedRows = 100;
const excessiveCells = Array.from({ length: 17 }, (_, index) => {
  const col = String.fromCharCode(65 + index);
  return `<c r="${col}1" t="str"><v>${index}</v></c>`;
}).join('');
expectRejected(
  worksheet(`<row r="1">${excessiveCells}</row>`),
  /XLSX отклонён.*слишком много.*яче|лимит.*яче/i,
  'parsed-cell-count',
);

// Ambiguous physical coordinates are rejected instead of silently overwriting data.
expectRejected(
  worksheet('<row r="1"><c r="A1" t="str"><v>a</v></c><c r="A1" t="str"><v>b</v></c></row>'),
  /XLSX отклонён.*дублирующ.*яче|повтор.*координат/i,
  'duplicate-cell-coordinate',
);
expectRejected(
  worksheet('<row r="1"><c r="A1" t="str"><v>a</v></c></row><row r="1"><c r="B1" t="str"><v>b</v></c></row>'),
  /XLSX отклонён.*дублирующ.*строк|повтор.*номер строки/i,
  'duplicate-row-number',
);

// Cell row reference must agree with its enclosing <row r="...">.
expectRejected(
  worksheet('<row r="2"><c r="A3" t="str"><v>x</v></c></row>'),
  /XLSX отклонён.*координат.*строк|A3.*2/i,
  'cell-row-mismatch',
);

// Malformed / zero references fail closed instead of falling back to A1.
expectRejected(
  worksheet('<row r="1"><c r="A0" t="str"><v>x</v></c></row>'),
  /XLSX отклонён.*координат|A0/i,
  'zero-cell-row',
);
expectRejected(
  worksheet('<row r="0"><c r="A0" t="str"><v>x</v></c></row>'),
  /XLSX отклонён.*номер строки|r=.0/i,
  'zero-row-number',
);

console.log('TESSA Matrix Studio SpreadsheetML structural security regressions: OK');
