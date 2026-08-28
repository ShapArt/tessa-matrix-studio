import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = {
  body: { innerText: 'Завершить редактирование и разблокировать' },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ click: () => {}, href: '', download: '' }),
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;
const structure = {
  templateId: 'delete-race-template',
  conditions: [{
    criterionRowId: 'criterion-org', criterionName: 'Организация',
    operandTypeId: O.ReferenceGuid, autocompleteViewName: 'Organizations', refSection: 'Organizations',
  }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};
function row(personId, person) {
  const flat = { 'criterion:criterion-org': ['Компания А'], 'function:function-sign': [person] };
  return {
    index: 0,
    rowCardId: 'card-delete',
    versionId: 'version-delete',
    fingerprint: E.fingerprintFlat(flat),
    flat,
    values: { 'criterion-org': [{ id: 'org-a', display: 'Компания А' }] },
    roles: { 'function-sign': [{ id: personId, display: person, roleTypeId: 'role-type' }] },
  };
}
const originalRow = row('person-a', 'Иванов И.И.');
const changedRow = row('person-b', 'Петров П.П.');
const snapshot = {
  matrixId: 'delete-race-matrix', templateId: structure.templateId, rows: [originalRow],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const changedSnapshot = {
  ...snapshot,
  rows: [changedRow],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const matrixInfo = {
  matrixId: snapshot.matrixId, TemplateID: snapshot.templateId,
  TemplateName: 'DELETE RACE QA', StateName: 'Черновик', Name: 'DELETE RACE QA',
};
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, matrixInfo, catalog);
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'delete-race.xlsx');
const edited = { ...workbook, rows: [] };
const plan = E.buildPlan(edited, structure, snapshot);
assert(plan.counts.delete === 1, `expected one DELETE, got ${JSON.stringify(plan.counts)}`);

let snapshotReads = 0;
let deleteCalls = 0;
const bridge = {
  matrixInfo: () => matrixInfo,
  templateId: () => structure.templateId,
  requestStructure: async () => structure,
  // First read is Apply preflight; second read must happen immediately before DeleteRow.
  loadSnapshot: async () => {
    snapshotReads += 1;
    return snapshotReads === 1 ? snapshot : changedSnapshot;
  },
  resolveReferenceOnline: async () => null,
  deleteMatrixRow: async () => { deleteCalls += 1; },
  refresh: async () => {},
};

const originalCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => bridge;
try {
  const result = await E.applyPlan(plan);
  assert(snapshotReads >= 2,
    `DELETE must re-read fresh matrix state immediately before DeleteRow, got ${snapshotReads} snapshot reads`);
  assert(deleteCalls === 0,
    `DELETE must not execute after target fingerprint changed post-preflight, got ${deleteCalls} delete calls`);
  const skippedDelete = result.rows.find(item => item.type === 'delete' && item.status === 'skipped');
  assert(skippedDelete,
    `race-conflicted DELETE must be reported as skipped: ${JSON.stringify(result.rows)}`);
  assert(/изменилась после предварительной проверки/i.test(skippedDelete.reason || ''),
    `DELETE race skip reason must explain the concurrent change: ${skippedDelete.reason}`);
} finally {
  E.TessaBridge.create = originalCreate;
}

console.log('TESSA Matrix Studio DELETE store-time race regression: OK');
