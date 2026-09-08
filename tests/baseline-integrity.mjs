import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;
const structure = {
  templateId: 'qa-integrity-template',
  conditions: [{ criterionRowId: 'criterion-org', criterionName: 'Организация', operandTypeId: O.ReferenceGuid, autocompleteViewName: 'QaOrganizationView', refSection: 'QaOrganizationView' }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};
function row(index, card, version, orgId, org, personId, person) {
  const flat = { 'criterion:criterion-org': [org], 'function:function-sign': [person] };
  return { index, rowCardId: card, versionId: version, fingerprint: E.fingerprintFlat(flat), values: { 'criterion-org': [{ id: orgId, display: org }] }, roles: { 'function-sign': [{ id: personId, display: person, roleTypeId: 'role-type' }] }, flat };
}
const snapshot = {
  matrixId: 'qa-integrity-matrix',
  templateId: structure.templateId,
  rows: [
    row(0, 'card-a', 'version-a', 'org-a', 'Компания А', 'person-a', 'Иванов И.И.'),
    row(1, 'card-b', 'version-b', 'org-b', 'Компания Б', 'person-b', 'Петров П.П.'),
  ],
};
const info = { matrixId: snapshot.matrixId, TemplateID: snapshot.templateId, Name: 'QA Integrity' };
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, info, catalog);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const workbook = await E.readXlsxArrayBuffer(buffer, 'qa-integrity.xlsx');
const cloneWorkbook = source => ({ ...source, rows: source.rows.map(r => ({ excelRow: r.excelRow, values: [...r.values] })) });
const rowCardCol = workbook.schemaTokens.indexOf('system:rowCardId');
const versionCol = workbook.schemaTokens.indexOf('system:versionId');
const fpCol = workbook.schemaTokens.indexOf('system:baseFingerprint');
assert(rowCardCol >= 0 && versionCol >= 0 && fpCol >= 0, 'system identity columns missing');

// The user-defined V6 contract treats an absent baseline ID as DELETE and
// a populated row without identity as ADD, even when total row count is equal.
const broken = cloneWorkbook(workbook);
broken.rows[1].values[rowCardCol] = '';
broken.rows[1].values[versionCol] = '';
broken.rows[1].values[fpCol] = '';
let plan = E.buildPlan(broken, structure, snapshot);
assert(plan.counts.add === 1 && plan.counts.delete === 1 && plan.counts.skip === 0,
  `missing identity must support DELETE + ADD: ${JSON.stringify(plan.counts)}`);
const merged = E.mergeWorkbookIntoCurrentSnapshot(broken, structure, snapshot);
assert(merged.snapshot.rows.some(row => row.action === 'ДОБАВИТЬ'), 'schema refresh lost ADD');
assert(!merged.snapshot.rows.some(row => row.rowCardId === 'card-b'), 'schema refresh restored deleted identity');
let refreshError = null;

// Даже если RowID/VersionID сохранились, удаление одного BaseFingerprint не должно
// отключать stale-защиту: V6 ledger знает исходный fingerprint отдельно от основной строки.
const brokenFingerprint = cloneWorkbook(workbook);
brokenFingerprint.rows[1].values[fpCol] = '';
plan = E.buildPlan(brokenFingerprint, structure, snapshot);
assert(plan.counts.add === 0 && plan.counts.delete === 0 && plan.counts.update === 0,
  `lost base fingerprint must never become mutation: ${JSON.stringify(plan.counts)} skipped=${JSON.stringify(plan.skippedRows)}`);
assert(plan.skippedRows.some(item => /fingerprint|baseline|служеб|скрыт/i.test(item.reason)),
  `lost base fingerprint must be explained explicitly: ${JSON.stringify(plan.skippedRows)}`);
refreshError = null;
try { E.mergeWorkbookIntoCurrentSnapshot(brokenFingerprint, structure, snapshot); }
catch (error) { refreshError = error; }
assert(refreshError && /fingerprint|baseline|служеб|скрыт|конфликт/i.test(String(refreshError.message || refreshError)),
  `schema refresh must reject lost base fingerprint: ${refreshError?.message || 'no error'}`);

console.log('TESSA Matrix Studio baseline integrity tests: OK');
