import fs from 'node:fs';
import vm from 'node:vm';

const scriptPath = new URL('../tessa-matrix-studio.user.js', import.meta.url);
const code = fs.readFileSync(scriptPath, 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;

const structure = {
  templateId: 'qa-template',
  conditions: [{
    criterionRowId: 'criterion-org',
    criterionName: 'Организация',
    operandTypeId: O.ReferenceGuid,
    autocompleteViewName: 'QaOrganizationView',
    refSection: 'QaOrganizationView',
  }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};

function currentRow(index, rowCardId, versionId, orgId, org, personId, person) {
  const flat = {
    'criterion:criterion-org': [org],
    'function:function-sign': [person],
  };
  return {
    index,
    rowCardId,
    versionId,
    fingerprint: E.fingerprintFlat(flat),
    values: { 'criterion-org': [{ id: orgId, display: org }] },
    roles: { 'function-sign': [{ id: personId, display: person, roleTypeId: 'role-type' }] },
    flat,
  };
}

const snapshot = {
  matrixId: 'qa-delete-overwrite',
  templateId: structure.templateId,
  rows: [
    currentRow(0, 'card-a', 'version-a', 'org-a', 'Компания А', 'person-a', 'Иванов И.И.'),
    currentRow(1, 'card-b', 'version-b', 'org-b', 'Компания Б', 'person-b', 'Петров П.П.'),
  ],
};

const matrixInfo = { matrixId: snapshot.matrixId, TemplateID: snapshot.templateId, Name: 'QA Delete Overwrite' };
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, matrixInfo, catalog);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const baseline = await E.readXlsxArrayBuffer(buffer, 'qa-delete-overwrite.xlsx');

const actionIndex = baseline.headers.indexOf('Действие');
const signerIndex = baseline.headers.indexOf('Подписание');
const signerIdIndex = baseline.headers.indexOf('Подписание__ID');
assert(actionIndex >= 0 && signerIndex >= 0 && signerIdIndex >= 0, 'required columns unavailable');

const workbook = {
  ...baseline,
  rows: baseline.rows.map(row => ({ excelRow: row.excelRow, values: [...row.values] })),
};

// Пользователь копирует A поверх B: вместе с видимыми значениями копируются скрытые ID A.
// Затем на этой физической строке ставит УДАЛИТЬ. В результате одновременно есть два
// противоречивых сигнала: hidden identity говорит A, overwrite-position говорит B.
workbook.rows[1].values = [...workbook.rows[0].values];
workbook.rows[1].values[signerIndex] = baseline.rows[1].values[signerIndex];
workbook.rows[1].values[signerIdIndex] = baseline.rows[1].values[signerIdIndex];
workbook.rows[1].values[actionIndex] = 'УДАЛИТЬ';

const plan = E.buildPlan(workbook, structure, snapshot);
assert(plan.counts.delete === 0 && plan.counts.update === 0 && plan.counts.add === 0,
  `ambiguous delete-overwrite must not mutate: ${JSON.stringify(plan.counts)} skipped=${JSON.stringify(plan.skippedRows)}`);
assert(plan.skippedRows.some(item => /неоднознач|замен.*удал|удал.*замен/i.test(item.reason)),
  `ambiguous delete-overwrite needs an explicit safety reason: ${JSON.stringify(plan.skippedRows)}`);

let schemaError = null;
try {
  E.mergeWorkbookIntoCurrentSnapshot(workbook, structure, snapshot);
} catch (error) {
  schemaError = error;
}
assert(schemaError && /неоднознач|замен.*удал|удал.*замен/i.test(String(schemaError.message || schemaError)),
  `schema refresh must reject ambiguous delete-overwrite, got: ${schemaError?.message || 'no error'}`);

console.log('TESSA Matrix Studio delete/overwrite safety tests: OK');
