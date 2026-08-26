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
  matrixId: 'qa-matrix',
  templateId: 'qa-template',
  rows: [
    currentRow(0, 'card-a', 'version-a', 'org-a', 'Компания А', 'person-a', 'Иванов И.И.'),
    currentRow(1, 'card-b', 'version-b', 'org-b', 'Компания Б', 'person-b', 'Петров П.П.'),
  ],
};

const matrixInfo = { matrixId: snapshot.matrixId, TemplateID: snapshot.templateId, Name: 'QA Matrix' };
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, matrixInfo, catalog);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const baseline = await E.readXlsxArrayBuffer(buffer, 'qa-roundtrip.xlsx');

let plan = E.buildPlan(baseline, structure, snapshot);
assert(plan.counts.noop === 2 && plan.counts.update === 0 && plan.counts.add === 0 && plan.counts.delete === 0 && plan.counts.skip === 0,
  `clean roundtrip mismatch: ${JSON.stringify(plan.counts)}`);

const cloneWorkbook = workbook => ({
  ...workbook,
  rows: workbook.rows.map(row => ({ excelRow: row.excelRow, values: [...row.values] })),
});
const headerIndex = name => baseline.headers.indexOf(name);
const signerIndex = headerIndex('Подписание');
const signerIdIndex = headerIndex('Подписание__ID');
assert(signerIndex >= 0 && signerIdIndex >= 0, 'signer columns unavailable');

// Ctrl+C/Ctrl+V поверх существующей строки: копируются и скрытые identity источника.
// После небольшой правки содержимого это должно стать UPDATE целевой позиции, а не ADD+DELETE.
const overwrite = cloneWorkbook(baseline);
overwrite.rows[1].values = [...overwrite.rows[0].values];
overwrite.rows[1].values[signerIndex] = baseline.rows[1].values[signerIndex];
overwrite.rows[1].values[signerIdIndex] = baseline.rows[1].values[signerIdIndex];
plan = E.buildPlan(overwrite, structure, snapshot);
const replacement = plan.actions.find(action => action.type === 'update');
assert(plan.counts.noop === 1 && plan.counts.update === 1 && plan.counts.add === 0 && plan.counts.delete === 0 && plan.counts.skip === 0,
  `overwrite mismatch: ${JSON.stringify(plan.counts)}`);
assert(replacement?.currentRow?.index === 1 && replacement?.match?.matchedBy === 'position-overwrite',
  'overwrite must update the target identity by position');

// Та же копия в новой строке должна стать ADD.
const add = cloneWorkbook(baseline);
const newRow = { excelRow: baseline.rows.at(-1).excelRow + 1, values: [...baseline.rows[0].values] };
newRow.values[signerIndex] = baseline.rows[1].values[signerIndex];
newRow.values[signerIdIndex] = baseline.rows[1].values[signerIdIndex];
add.rows.push(newRow);
plan = E.buildPlan(add, structure, snapshot);
const addition = plan.actions.find(action => action.type === 'add');
assert(plan.counts.noop === 2 && plan.counts.add === 1 && plan.counts.update === 0 && plan.counts.delete === 0 && plan.counts.skip === 0,
  `copy-to-new-row mismatch: ${JSON.stringify(plan.counts)}`);
assert(addition?.match?.matchedBy === 'copied-row-auto-add', 'copy in a new row must be ADD');

// Физическое удаление одной строки из Excel должно остаться DELETE.
const removed = cloneWorkbook(baseline);
removed.rows.splice(1, 1);
plan = E.buildPlan(removed, structure, snapshot);
assert(plan.counts.noop === 1 && plan.counts.delete === 1 && plan.counts.update === 0 && plan.counts.add === 0 && plan.counts.skip === 0,
  `single delete mismatch: ${JSON.stringify(plan.counts)}`);

console.log('TESSA Matrix Studio planner tests: OK');
