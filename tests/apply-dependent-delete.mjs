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
  templateId: 'apply-dependent-delete-template',
  conditions: [{
    criterionRowId: 'criterion-org', criterionName: 'Организация',
    operandTypeId: O.ReferenceGuid, autocompleteViewName: 'Organizations', refSection: 'Organizations',
  }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};
function row(index, card, version, orgId, org, personId, person) {
  const flat = { 'criterion:criterion-org': [org], 'function:function-sign': [person] };
  return {
    index, rowCardId: card, versionId: version, fingerprint: E.fingerprintFlat(flat), flat,
    values: { 'criterion-org': [{ id: orgId, display: org }] },
    roles: { 'function-sign': [{ id: personId, display: person, roleTypeId: 'role-type' }] },
  };
}
const snapshot = {
  matrixId: 'apply-dependent-delete-matrix', templateId: structure.templateId,
  rows: [
    row(0, 'card-a', 'version-a', 'org-a', 'Компания А', 'person-a', 'Иванов И.И.'),
    row(1, 'card-b', 'version-b', 'org-b', 'Компания Б', 'person-b', 'Петров П.П.'),
  ],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const matrixInfo = {
  matrixId: snapshot.matrixId, TemplateID: snapshot.templateId,
  TemplateName: 'APPLY DEPENDENT DELETE QA', StateName: 'Черновик',
};
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, matrixInfo, catalog);
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'apply-dependent-delete.xlsx');
const edited = { ...workbook, rows: workbook.rows.map(item => ({ excelRow: item.excelRow, values: [...item.values] })) };
const indexes = ['Организация', 'Организация__ID', 'Подписание', 'Подписание__ID'].map(header => workbook.headers.indexOf(header));
assert(indexes.every(index => index >= 0), 'matrix columns unavailable');
for (const index of indexes) edited.rows[0].values[index] = workbook.rows[1].values[index];
edited.rows.splice(1, 1);
const plan = E.buildPlan(edited, structure, snapshot);
const update = plan.actions.find(action => action.type === 'update' && action.currentRow?.versionId === 'version-a');
const deletion = plan.actions.find(action => action.type === 'delete' && action.currentRow?.versionId === 'version-b');
assert(update && deletion, `dependent UPDATE/DELETE pair missing: ${JSON.stringify(plan.counts)}`);
assert(E.fingerprintFlat(update.excelRow.flat) === deletion.currentRow.fingerprint, 'dependency fingerprint mismatch');

let deleteCalls = 0;
const bridge = {
  matrixInfo: () => matrixInfo,
  templateId: () => structure.templateId,
  requestStructure: async () => structure,
  loadSnapshot: async () => snapshot,
  resolveReferenceOnline: async () => null,
  resolveCriterion: (condition, display, id) => ({ id, display }),
  resolveRole: (fn, display, id) => ({ id, display }),
  getCard: async () => ({}),
  rebuildRowCard: () => {},
  validateDuplicate: async () => {},
  storeRowCard: async () => { throw new Error('simulated UPDATE store failure'); },
  deleteMatrixRow: async () => { deleteCalls += 1; },
  refresh: async () => {},
};
const originalCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => bridge;
try {
  const result = await E.applyPlan(plan);
  assert(deleteCalls === 0, `dependent DELETE must not execute after UPDATE store failure: ${deleteCalls}`);
  assert(result.rows.some(item => item.type === 'update' && item.status === 'skipped'),
    `UPDATE store SKIP missing: ${JSON.stringify(result.rows)}`);
  assert(result.rows.some(item => item.type === 'delete' && item.status === 'skipped'),
    `dependent DELETE store SKIP missing: ${JSON.stringify(result.rows)}`);
} finally {
  E.TessaBridge.create = originalCreate;
}

console.log('TESSA Matrix Studio store-time dependent DELETE regression: OK');
