import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;
const structure = {
  templateId: 'empty-roundtrip-template',
  conditions: [{
    criterionRowId: 'criterion-org',
    criterionName: 'Организация',
    operandTypeId: O.ReferenceGuid,
    autocompleteViewName: 'QaOrganizationView',
    refSection: 'QaOrganizationView',
  }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};
const snapshot = {
  matrixId: 'empty-roundtrip-matrix',
  templateId: structure.templateId,
  rows: [],
  criterionIdCache: new Map(),
  roleIdByFunctionCache: new Map(),
  roleIdCache: new Map(),
};
const info = {
  matrixId: snapshot.matrixId,
  TemplateID: snapshot.templateId,
  TemplateName: 'Empty QA Matrix',
  StateName: 'Черновик',
  Name: 'Empty QA Matrix',
};

const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, info, catalog);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const workbook = await E.readXlsxArrayBuffer(buffer, 'empty-roundtrip.xlsx');

assert(workbook.roundtrip?.format === 'TESSA_MATRIX_ROUNDTRIP_V6', JSON.stringify(workbook.roundtrip));
assert(workbook.rows.length === 0, `empty export imported ${workbook.rows.length} data rows`);
assert((workbook.roundtrip?.baselineRows || []).length === 0, 'empty matrix must have an empty V6 baseline ledger');

const orgIndex = workbook.headers.indexOf('Организация');
const orgIdIndex = workbook.headers.indexOf('Организация__ID');
const signerIndex = workbook.headers.indexOf('Подписание');
const signerIdIndex = workbook.headers.indexOf('Подписание__ID');
assert([orgIndex, orgIdIndex, signerIndex, signerIdIndex].every(index => index >= 0),
  `required editable columns unavailable: ${JSON.stringify(workbook.headers)}`);

// Simulate the user's first manually filled row in the exported empty workbook.
const values = Array(workbook.headers.length).fill('');
values[orgIndex] = 'Компания Первая';
values[orgIdIndex] = 'org-first';
values[signerIndex] = 'Иванов И.И.';
values[signerIdIndex] = 'person-first|role-type';
const edited = {
  ...workbook,
  rows: [{ excelRow: 15, values }],
};
const plan = E.buildPlan(edited, structure, snapshot);
assert(plan.counts.add === 1, `first row must be one ADD: ${JSON.stringify(plan.counts)}`);
assert(plan.counts.update === 0 && plan.counts.delete === 0 && plan.counts.skip === 0,
  `first ADD produced unsafe side effects: ${JSON.stringify(plan.counts)} skipped=${JSON.stringify(plan.skippedRows)}`);
const addition = plan.actions.find(action => action.type === 'add');
assert(addition && !addition.currentRow, `first ADD unexpectedly targeted existing identity: ${JSON.stringify(addition)}`);

console.log('TESSA Matrix Studio empty matrix -> Excel -> first ADD roundtrip: OK');
