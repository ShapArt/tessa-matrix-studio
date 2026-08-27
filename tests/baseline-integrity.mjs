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
const broken = { ...workbook, rows: workbook.rows.map(r => ({ excelRow: r.excelRow, values: [...r.values] })) };
const rowCardCol = workbook.schemaTokens.indexOf('system:rowCardId');
const versionCol = workbook.schemaTokens.indexOf('system:versionId');
const fpCol = workbook.schemaTokens.indexOf('system:baseFingerprint');
assert(rowCardCol >= 0 && versionCol >= 0 && fpCol >= 0, 'system identity columns missing');

// Пользователь/Excel случайно уничтожил hidden identity одной существующей строки,
// но сама строка и её видимые данные остались. Это НЕ новая строка и НЕ DELETE+ADD.
broken.rows[1].values[rowCardCol] = '';
broken.rows[1].values[versionCol] = '';
broken.rows[1].values[fpCol] = '';

const plan = E.buildPlan(broken, structure, snapshot);
assert(plan.counts.add === 0 && plan.counts.delete === 0 && plan.counts.update === 0,
  `lost hidden identity must never become mutation: ${JSON.stringify(plan.counts)} skipped=${JSON.stringify(plan.skippedRows)}`);
assert(plan.skippedRows.some(item => /скрыт|identity|baseline|id|идентифик/i.test(item.reason)),
  `lost hidden identity must be explained explicitly: ${JSON.stringify(plan.skippedRows)}`);
assert(plan.safety?.blocked === true,
  `lost hidden identity must block Apply: ${JSON.stringify(plan.safety)}`);

let refreshError = null;
try { E.mergeWorkbookIntoCurrentSnapshot(broken, structure, snapshot); }
catch (error) { refreshError = error; }
assert(refreshError && /скрыт|identity|baseline|id|конфликт/i.test(String(refreshError.message || refreshError)),
  `schema refresh must reject lost hidden identity: ${refreshError?.message || 'no error'}`);

console.log('TESSA Matrix Studio baseline integrity tests: OK');
