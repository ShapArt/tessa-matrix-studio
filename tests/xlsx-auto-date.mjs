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

console.log('TESSA Matrix Studio Excel auto-date export regression: OK');
