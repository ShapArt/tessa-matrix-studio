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
  templateId: 'cross-matrix-atomic-template',
  conditions: [{
    criterionRowId: 'criterion-org', criterionName: 'Организация',
    operandTypeId: O.ReferenceGuid, autocompleteViewName: 'Organizations', refSection: 'Organizations',
  }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};
function matrixRow(index, card, version, orgId, org, personId, person) {
  const flat = { 'criterion:criterion-org': [org], 'function:function-sign': [person] };
  return {
    index, rowCardId: card, versionId: version, fingerprint: E.fingerprintFlat(flat), flat,
    values: { 'criterion-org': [{ id: orgId, display: org }] },
    roles: { 'function-sign': [{ id: personId, display: person, roleTypeId: 'role-type' }] },
  };
}

const sourceSnapshot = {
  matrixId: 'matrix-source', templateId: structure.templateId,
  rows: [
    matrixRow(0, 'source-card-a', 'source-version-a', 'org-a', 'Компания А', 'person-a', 'Иванов И.И.'),
    matrixRow(1, 'source-card-b', 'source-version-b', 'org-b', 'Компания Б', 'person-b', 'Петров П.П.'),
  ],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const sourceInfo = {
  matrixId: sourceSnapshot.matrixId, TemplateID: structure.templateId,
  TemplateName: 'CROSS MATRIX ATOMIC QA', Name: 'Матрица источник', StateName: 'Черновик',
};
const targetRow = matrixRow(0, 'target-card-old', 'target-version-old', 'org-old', 'Компания С', 'person-old', 'Сидоров С.С.');
const targetSnapshot = {
  matrixId: 'matrix-target', templateId: structure.templateId, rows: [targetRow],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const targetInfo = {
  matrixId: targetSnapshot.matrixId, TemplateID: structure.templateId,
  TemplateName: 'CROSS MATRIX ATOMIC QA', Name: 'Матрица цель', StateName: 'Черновик',
};

const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, sourceSnapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, sourceSnapshot, sourceInfo, catalog);
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'source.xlsx');
const plan = E.buildPlan(workbook, structure, targetSnapshot, targetInfo);
assert(plan.crossMatrixReplacement?.enabled === true, 'test must exercise cross-matrix replacement mode');
assert(plan.counts.add === 2 && plan.counts.delete === 1,
  `expected 2 ADD + 1 DELETE replacement plan, got ${JSON.stringify(plan.counts)}`);

let createIndex = 0;
let storeIndex = 0;
const deleteCalls = [];
const bridge = {
  matrixInfo: () => targetInfo,
  templateId: () => structure.templateId,
  requestStructure: async () => structure,
  loadSnapshot: async () => targetSnapshot,
  resolveReferenceOnline: async () => null,
  resolveCriterion: (condition, display, id) => ({ id, display }),
  resolveRole: (fn, display, id) => ({ id, display, roleTypeId: 'role-type' }),
  assertCanCreateRows: () => {},
  createRowCard: async () => {
    createIndex += 1;
    return {
      card: { id: `new-card-${createIndex}`, version: 0 },
      cardId: `new-card-${createIndex}`,
      versionId: `new-version-${createIndex}`,
      newMethod: 'CardNew',
    };
  },
  rebuildRowCard: () => {},
  validateDuplicate: async () => {},
  storeRowCard: async card => {
    storeIndex += 1;
    if (storeIndex === 2) throw new Error('simulated second ADD Store failure');
    return { cardId: card.id, cardVersion: 1 };
  },
  tryGetCard: async cardId => ({ card: { id: cardId, version: 1 } }),
  getCard: async cardId => ({ id: cardId, version: 1 }),
  readMatrixRowFromCard: (_card, current) => current?.source === 'targeted-delete-recheck' ? targetRow : null,
  deleteMatrixRow: async versionId => { deleteCalls.push(versionId); },
  saveMainMatrixAfterApply: async () => ({ ok: true, method: 'test-save' }),
  refreshNativeMatrixView: async () => ({ ok: true, controlName: 'test-view' }),
};

const originalCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => bridge;
try {
  const result = await E.applyPlan(plan);
  assert(!deleteCalls.includes('target-version-old'),
    `old target row must never be deleted after a failed transfer ADD: ${JSON.stringify(deleteCalls)}`);
  assert(deleteCalls.includes('new-version-1'),
    `the already-created transfer ADD must be compensatingly deleted: ${JSON.stringify(deleteCalls)}`);
  assert(result.crossMatrixTransfer?.status === 'rolled-back',
    `failed transfer must report rolled-back status: ${JSON.stringify(result.crossMatrixTransfer)}`);
  assert(result.status !== 'completed' && result.success === false,
    `failed transfer must not be reported completed: ${JSON.stringify({ status: result.status, success: result.success })}`);
} finally {
  E.TessaBridge.create = originalCreate;
}

console.log('TESSA Matrix Studio atomic cross-matrix Apply rollback contract: OK');
