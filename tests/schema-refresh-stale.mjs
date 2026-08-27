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

const exportedSnapshot = {
  matrixId: 'qa-schema-stale',
  templateId: structure.templateId,
  rows: [
    currentRow(0, 'card-a', 'version-a', 'org-a', 'Компания А', 'person-a', 'Иванов И.И.'),
    currentRow(1, 'card-b', 'version-b', 'org-b', 'Компания Б', 'person-b', 'Петров П.П.'),
  ],
};
const matrixInfo = { matrixId: exportedSnapshot.matrixId, TemplateID: exportedSnapshot.templateId, Name: 'QA Schema Stale' };
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, exportedSnapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, exportedSnapshot, matrixInfo, catalog);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const baseline = await E.readXlsxArrayBuffer(buffer, 'qa-schema-stale.xlsx');

// После выгрузки A изменили в TESSA. Это новый authoritative snapshot для schema refresh.
const freshSnapshot = {
  ...exportedSnapshot,
  rows: [
    currentRow(0, 'card-a', 'version-a', 'org-a', 'Компания А', 'person-z', 'Сидоров С.С.'),
    exportedSnapshot.rows[1],
  ],
};

// 1. Если пользователь НЕ менял stale-строку в Excel, актуализация схемы обязана
// сохранить свежую TESSA-версию. Иначе старое значение получает новый baseFingerprint
// и последующее применение уже не сможет распознать, что данные устарели.
const refreshedNoEdit = E.mergeWorkbookIntoCurrentSnapshot(baseline, structure, freshSnapshot).snapshot;
const freshA = refreshedNoEdit.rows.find(row => row.versionId === 'version-a');
assert(freshA?.flat?.['function:function-sign']?.[0] === 'Сидоров С.С.',
  `schema refresh laundered stale unchanged row A: ${JSON.stringify(freshA?.flat)}`);
assert(freshA?.fingerprint === freshSnapshot.rows[0].fingerprint,
  'schema refresh must retain the fresh TESSA fingerprint for an unchanged stale workbook row');

// 2. Если stale-строку одновременно меняли и в Excel, и в TESSA, автоматический merge
// небезопасен: нельзя молча назначить старому Excel-изменению свежий fingerprint.
const localEdit = {
  ...baseline,
  rows: baseline.rows.map(row => ({ excelRow: row.excelRow, values: [...row.values] })),
};
const signerIndex = baseline.headers.indexOf('Подписание');
const signerIdIndex = baseline.headers.indexOf('Подписание__ID');
assert(signerIndex >= 0 && signerIdIndex >= 0, 'signer columns unavailable');
localEdit.rows[0].values[signerIndex] = baseline.rows[1].values[signerIndex];
localEdit.rows[0].values[signerIdIndex] = baseline.rows[1].values[signerIdIndex];

let conflict = null;
try {
  E.mergeWorkbookIntoCurrentSnapshot(localEdit, structure, freshSnapshot);
} catch (error) {
  conflict = error;
}
assert(conflict && /измен.*TESSA|конфликт|свеж/i.test(String(conflict.message || conflict)),
  `schema refresh must reject concurrent Excel/TESSA edit, got: ${conflict?.message || 'no error'}`);

console.log('TESSA Matrix Studio stale schema-refresh tests: OK');
