import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;

const structure = {
  templateId: 'qa-auto-date-template',
  conditions: [{
    criterionRowId: 'criterion-range-text',
    criterionName: 'Диапазон листов',
    operandTypeId: O.String,
  }],
  functions: [],
};

const flat = { 'criterion:criterion-range-text': ['3 - 17'] };
const snapshot = {
  matrixId: 'qa-auto-date-matrix',
  templateId: structure.templateId,
  rows: [{
    index: 0,
    rowCardId: 'card-range',
    versionId: 'version-range',
    fingerprint: E.fingerprintFlat(flat),
    values: { 'criterion-range-text': [{ id: '', display: '3 - 17' }] },
    roles: {},
    flat,
  }],
};
const matrixInfo = { matrixId: snapshot.matrixId, TemplateID: snapshot.templateId, TemplateName: 'QA Auto Date' };
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, matrixInfo, null);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const workbook = await E.readXlsxArrayBuffer(buffer, 'qa-auto-date.xlsx');
const visibleIndex = workbook.headers.indexOf('Диапазон листов');
assert(visibleIndex >= 0, `visible criterion column missing: ${JSON.stringify(workbook.headers)}`);
assert(workbook.rows[0].values[visibleIndex] === '3 - 17', `roundtrip value changed: ${workbook.rows[0].values[visibleIndex]}`);
assert(workbook.rows[0].cellMeta?.[visibleIndex]?.numberFormatKind === 'text',
  `editable body cell must be exported as Excel Text, got ${JSON.stringify(workbook.rows[0].cellMeta?.[visibleIndex])}`);

const cloneWorkbook = source => ({
  ...source,
  rows: source.rows.map(row => ({
    ...row,
    values: [...row.values],
    cellMeta: (row.cellMeta || []).map(meta => meta ? { ...meta } : null),
  })),
});

const intStructure = {
  templateId: 'qa-auto-date-int-template',
  conditions: [{
    criterionRowId: 'criterion-pages',
    criterionName: 'Количество листов',
    operandTypeId: O.Int,
  }],
  functions: [],
};
const intFlat = { 'criterion:criterion-pages': ['17'] };
const intSnapshot = {
  matrixId: 'qa-auto-date-int-matrix',
  templateId: intStructure.templateId,
  rows: [{
    index: 0,
    rowCardId: 'card-int',
    versionId: 'version-int',
    fingerprint: E.fingerprintFlat(intFlat),
    values: { 'criterion-pages': [{ id: '', display: '17', value: 17 }] },
    roles: {},
    flat: intFlat,
  }],
};
const intBytes = await E.createRoundtripXlsxBytes(
  intStructure,
  intSnapshot,
  { matrixId: intSnapshot.matrixId, TemplateID: intSnapshot.templateId, TemplateName: 'QA Int Auto Date' },
  null,
);
const intBuffer = intBytes.buffer.slice(intBytes.byteOffset, intBytes.byteOffset + intBytes.byteLength);
const intBaseline = await E.readXlsxArrayBuffer(intBuffer, 'qa-auto-date-int.xlsx');
const intIndex = intBaseline.headers.indexOf('Количество листов');
assert(intIndex >= 0, 'integer criterion column missing');
let plan = E.buildPlan(intBaseline, intStructure, intSnapshot);
assert(plan.counts.noop === 1 && plan.counts.skip === 0, `clean integer baseline mismatch: ${JSON.stringify(plan.counts)}`);

// This reproduces the live UAT failure: Excel displayed a date and persisted its serial 43160.
// A non-date TESSA criterion must fail closed instead of treating that serial as a legitimate Int.
const autoDated = cloneWorkbook(intBaseline);
autoDated.rows[0].values[intIndex] = '43160';
autoDated.rows[0].cellMeta[intIndex] = {
  styleIndex: 7,
  numFmtId: 14,
  formatCode: '',
  numberFormatKind: 'date',
  rawType: 'n',
};
plan = E.buildPlan(autoDated, intStructure, intSnapshot);
assert(plan.counts.update === 0 && plan.counts.skip === 1,
  `date-formatted numeric Int must be skipped: ${JSON.stringify(plan.counts)} skipped=${JSON.stringify(plan.skippedRows)}`);
assert(plan.skippedRows.some(item => /excel.*дат|дат.*excel|43160/i.test(item.reason || '')),
  `auto-date skip reason must be explicit: ${JSON.stringify(plan.skippedRows)}`);

// A real integer 43160 remains valid when Excel stores it as General or Text.
for (const numberFormatKind of ['general', 'text']) {
  const genuineInt = cloneWorkbook(intBaseline);
  genuineInt.rows[0].values[intIndex] = '43160';
  genuineInt.rows[0].cellMeta[intIndex] = {
    styleIndex: numberFormatKind === 'text' ? 5 : 0,
    numFmtId: numberFormatKind === 'text' ? 49 : 0,
    formatCode: numberFormatKind === 'text' ? '@' : '',
    numberFormatKind,
    rawType: numberFormatKind === 'text' ? 'inlineStr' : 'n',
  };
  plan = E.buildPlan(genuineInt, intStructure, intSnapshot);
  assert(plan.counts.update === 1 && plan.counts.skip === 0,
    `real Int 43160 (${numberFormatKind}) was blocked: ${JSON.stringify(plan.counts)} skipped=${JSON.stringify(plan.skippedRows)}`);
}

// Date/DateTime criteria intentionally accept Excel serials; this is existing supported behavior.
const dateStructure = {
  templateId: 'qa-auto-date-date-template',
  conditions: [{
    criterionRowId: 'criterion-date',
    criterionName: 'Дата документа',
    operandTypeId: O.Date,
  }],
  functions: [],
};
const dateFlat = { 'criterion:criterion-date': ['01.03.2018'] };
const dateSnapshot = {
  matrixId: 'qa-auto-date-date-matrix',
  templateId: dateStructure.templateId,
  rows: [{
    index: 0,
    rowCardId: 'card-date',
    versionId: 'version-date',
    fingerprint: E.fingerprintFlat(dateFlat),
    values: { 'criterion-date': [{ id: '', display: '01.03.2018', value: '01.03.2018' }] },
    roles: {},
    flat: dateFlat,
  }],
};
const dateBytes = await E.createRoundtripXlsxBytes(
  dateStructure,
  dateSnapshot,
  { matrixId: dateSnapshot.matrixId, TemplateID: dateSnapshot.templateId, TemplateName: 'QA Date Serial' },
  null,
);
const dateBuffer = dateBytes.buffer.slice(dateBytes.byteOffset, dateBytes.byteOffset + dateBytes.byteLength);
const dateBaseline = await E.readXlsxArrayBuffer(dateBuffer, 'qa-auto-date-date.xlsx');
const dateIndex = dateBaseline.headers.indexOf('Дата документа');
const dateSerial = cloneWorkbook(dateBaseline);
dateSerial.rows[0].values[dateIndex] = '43160';
dateSerial.rows[0].cellMeta[dateIndex] = {
  styleIndex: 7,
  numFmtId: 14,
  formatCode: '',
  numberFormatKind: 'date',
  rawType: 'n',
};
plan = E.buildPlan(dateSerial, dateStructure, dateSnapshot);
assert(plan.counts.skip === 0,
  `real Date serial must remain accepted: ${JSON.stringify(plan.counts)} skipped=${JSON.stringify(plan.skippedRows)}`);

console.log('TESSA Matrix Studio Excel auto-date regressions: OK');
