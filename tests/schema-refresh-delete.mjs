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
  templateId: 'qa-delete-template',
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

const exportedSnapshot = {
  matrixId: 'qa-schema-delete',
  templateId: structure.templateId,
  rows: [
    currentRow(0, 'card-a', 'version-a', 'org-a', 'Компания А', 'person-a', 'Иванов И.И.'),
    currentRow(1, 'card-b', 'version-b', 'org-b', 'Компания Б', 'person-b', 'Петров П.П.'),
    currentRow(2, 'card-c', 'version-c', 'org-c', 'Компания В', 'person-c', 'Сидоров С.С.'),
  ],
};

const matrixInfo = {
  matrixId: exportedSnapshot.matrixId,
  TemplateID: exportedSnapshot.templateId,
  Name: 'QA Schema Delete',
};
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, exportedSnapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, exportedSnapshot, matrixInfo, catalog);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const baseline = await E.readXlsxArrayBuffer(buffer, 'qa-schema-delete.xlsx');

assert(baseline.rows.length === 3, `expected 3 exported rows, got ${baseline.rows.length}`);
assert(baseline.roundtrip.format === 'TESSA_MATRIX_ROUNDTRIP_V6', `physical DELETE safety requires V6 ledger, got ${baseline.roundtrip.format}`);
assert(baseline.roundtrip.baselineRows?.length === 3, `expected 3 baseline ledger rows, got ${baseline.roundtrip.baselineRows?.length || 0}`);
assert(baseline.roundtrip.baselineRows.some(row => row.versionId === 'version-b' && row.baseFingerprint === exportedSnapshot.rows[1].fingerprint),
  'baseline ledger does not preserve row B identity/fingerprint outside the editable row');

// DELETE в современном roundtrip-режиме задаётся физическим удалением строки Excel.
// Убираем вторую исходную строку целиком, включая скрытые identity-ячейки.
const deletedB = {
  ...baseline,
  rows: baseline.rows
    .filter((_, index) => index !== 1)
    .map(row => ({ excelRow: row.excelRow, values: [...row.values] })),
};

// 1. Если B в TESSA не менялась после выгрузки, schema refresh обязан сохранить
// намерение DELETE: B не должна воскреснуть из свежего snapshot.
const refreshed = E.mergeWorkbookIntoCurrentSnapshot(deletedB, structure, exportedSnapshot).snapshot;
assert(!refreshed.rows.some(row => row.versionId === 'version-b'),
  `schema refresh resurrected physically deleted row B: ${JSON.stringify(refreshed.rows.map(row => row.versionId))}`);
assert(refreshed.rows.some(row => row.versionId === 'version-a'), 'row A disappeared unexpectedly');
assert(refreshed.rows.some(row => row.versionId === 'version-c'), 'row C disappeared unexpectedly');

// 2. Если удалённая B после экспорта уже изменилась в TESSA, переносить старое DELETE
// автоматически небезопасно: пользователь принимал решение об удалении другой версии строки.
const freshChangedB = {
  ...exportedSnapshot,
  rows: [
    exportedSnapshot.rows[0],
    currentRow(1, 'card-b', 'version-b', 'org-b', 'Компания Б', 'person-b2', 'Новиков Н.Н.'),
    exportedSnapshot.rows[2],
  ],
};
let staleDeleteConflict = null;
try {
  E.mergeWorkbookIntoCurrentSnapshot(deletedB, structure, freshChangedB);
} catch (error) {
  staleDeleteConflict = error;
}
assert(staleDeleteConflict && /удал|delete|конфликт|измен.*TESSA|свеж/i.test(String(staleDeleteConflict.message || staleDeleteConflict)),
  `schema refresh must reject stale physical DELETE, got: ${staleDeleteConflict?.message || 'no error'}`);

console.log('TESSA Matrix Studio schema-refresh DELETE tests: OK');
