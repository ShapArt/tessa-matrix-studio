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
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;
const structure = {
  templateId: 'cross-matrix-delete-fail-template',
  conditions: [{ criterionRowId: 'criterion-org', criterionName: 'Организация', operandTypeId: O.ReferenceGuid, autocompleteViewName: 'Organizations', refSection: 'Organizations' }],
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
const source = {
  matrixId: 'matrix-source-delete-fail', templateId: structure.templateId,
  rows: [row(0, 'source-card', 'source-version', 'org-source', 'Компания Источник', 'person-source', 'Иванов И.И.')],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const targetRows = [
  row(0, 'target-card-a', 'target-version-a', 'org-a', 'Компания А', 'person-a', 'Петров П.П.'),
  row(1, 'target-card-b', 'target-version-b', 'org-b', 'Компания Б', 'person-b', 'Сидоров С.С.'),
  row(2, 'target-card-c', 'target-version-c', 'org-c', 'Компания В', 'person-c', 'Козлов К.К.'),
];
const target = {
  matrixId: 'matrix-target-delete-fail', templateId: structure.templateId, rows: targetRows,
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const sourceInfo = { matrixId: source.matrixId, TemplateID: structure.templateId, TemplateName: 'DELETE FAIL QA', Name: 'Источник', StateName: 'Черновик' };
const targetInfo = { matrixId: target.matrixId, TemplateID: structure.templateId, TemplateName: 'DELETE FAIL QA', Name: 'Цель', StateName: 'Черновик' };
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, source);
const bytes = await E.createRoundtripXlsxBytes(structure, source, sourceInfo, catalog);
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'delete-fail-source.xlsx');
const plan = E.buildPlan(workbook, structure, target, targetInfo);
assert(plan.crossMatrixReplacement?.enabled && plan.counts.add === 1 && plan.counts.delete === 3,
  `expected 1 ADD + 3 DELETE transfer: ${JSON.stringify(plan.counts)}`);

const deleteCalls = [];
const bridge = {
  matrixInfo: () => targetInfo,
  templateId: () => structure.templateId,
  requestStructure: async () => structure,
  loadSnapshot: async () => target,
  resolveReferenceOnline: async () => null,
  resolveCriterion: (condition, display, id) => ({ id, display }),
  resolveRole: (fn, display, id) => ({ id, display, roleTypeId: 'role-type' }),
  assertCanCreateRows: () => {},
  createRowCard: async () => ({ card: { id: 'new-card', version: 0 }, cardId: 'new-card', versionId: 'new-version', newMethod: 'CardNew' }),
  rebuildRowCard: () => {},
  validateDuplicate: async () => {},
  storeRowCard: async card => ({ cardId: card.id, cardVersion: 1 }),
  tryGetCard: async cardId => ({ card: { id: cardId, version: 1 } }),
  getCard: async cardId => ({ id: cardId }),
  readMatrixRowFromCard: (_card, current) => targetRows.find(item => item.versionId === current?.versionId) || null,
  deleteMatrixRow: async versionId => {
    deleteCalls.push(versionId);
    if (versionId === 'target-version-a') throw new Error('simulated first target DeleteRow failure');
  },
  saveMainMatrixAfterApply: async () => ({ ok: true }),
  refreshNativeMatrixView: async () => ({ ok: true }),
};

const originalCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => bridge;
try {
  const result = await E.applyPlan(plan);
  assert(deleteCalls[0] === 'target-version-a', `unexpected first target delete: ${JSON.stringify(deleteCalls)}`);
  assert(deleteCalls.length === 1,
    `cross-matrix transfer must stop after first target DELETE failure: ${JSON.stringify(deleteCalls)}`);
  assert(result.crossMatrixTransfer?.status === 'unsafe',
    `target DELETE failure must make transfer UNSAFE: ${JSON.stringify(result.crossMatrixTransfer)}`);
  assert(result.crossMatrixTransfer?.phase === 'delete' && result.crossMatrixTransfer?.targetDeletesStarted === true,
    `delete failure phase must be explicit: ${JSON.stringify(result.crossMatrixTransfer)}`);
  assert(result.status !== 'completed' && result.success === false,
    `delete failure must not report completed: ${JSON.stringify({ status: result.status, success: result.success })}`);
} finally {
  E.TessaBridge.create = originalCreate;
}

console.log('TESSA Matrix Studio cross-matrix target DELETE fail-closed contract: OK');
