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
  templateId: 'cross-matrix-rollback-verify-template',
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
  matrixId: 'matrix-source-rollback', templateId: structure.templateId,
  rows: [
    row(0, 'source-card-a', 'source-version-a', 'org-a', 'Компания А', 'person-a', 'Иванов И.И.'),
    row(1, 'source-card-b', 'source-version-b', 'org-b', 'Компания Б', 'person-b', 'Петров П.П.'),
  ],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const targetRow = row(0, 'target-card', 'target-version', 'org-c', 'Компания С', 'person-c', 'Сидоров С.С.');
const target = {
  matrixId: 'matrix-target-rollback', templateId: structure.templateId, rows: [targetRow],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const sourceInfo = { matrixId: source.matrixId, TemplateID: structure.templateId, TemplateName: 'ROLLBACK VERIFY QA', Name: 'Источник', StateName: 'Черновик' };
const targetInfo = { matrixId: target.matrixId, TemplateID: structure.templateId, TemplateName: 'ROLLBACK VERIFY QA', Name: 'Цель', StateName: 'Черновик' };
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, source);
const bytes = await E.createRoundtripXlsxBytes(structure, source, sourceInfo, catalog);
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'rollback-source.xlsx');
const plan = E.buildPlan(workbook, structure, target, targetInfo);
assert(plan.crossMatrixReplacement?.enabled && plan.counts.add === 2 && plan.counts.delete === 1,
  `expected transfer plan 2 ADD + 1 DELETE: ${JSON.stringify(plan.counts)}`);

let loadSnapshotCalls = 0;
let createIndex = 0;
let storeIndex = 0;
const deleteCalls = [];
const lingeringAddedRow = row(1, 'new-card-1', 'new-version-1', 'org-a', 'Компания А', 'person-a', 'Иванов И.И.');
const bridge = {
  matrixInfo: () => targetInfo,
  templateId: () => structure.templateId,
  requestStructure: async () => structure,
  loadSnapshot: async () => {
    loadSnapshotCalls += 1;
    if (loadSnapshotCalls === 1) return target;
    // Simulate a resolved cleanup DeleteRow that did NOT actually remove membership.
    return { ...target, rows: [targetRow, lingeringAddedRow] };
  },
  resolveReferenceOnline: async () => null,
  resolveCriterion: (condition, display, id) => ({ id, display }),
  resolveRole: (fn, display, id) => ({ id, display, roleTypeId: 'role-type' }),
  assertCanCreateRows: () => {},
  createRowCard: async () => {
    createIndex += 1;
    return { card: { id: `new-card-${createIndex}`, version: 0 }, cardId: `new-card-${createIndex}`, versionId: `new-version-${createIndex}`, newMethod: 'CardNew' };
  },
  rebuildRowCard: () => {},
  validateDuplicate: async () => {},
  storeRowCard: async card => {
    storeIndex += 1;
    if (storeIndex === 2) throw new Error('simulated second ADD Store failure');
    return { cardId: card.id, cardVersion: 1 };
  },
  tryGetCard: async cardId => ({ card: { id: cardId, version: 1 } }),
  getCard: async cardId => ({ id: cardId }),
  readMatrixRowFromCard: (_card, current) => current?.source === 'targeted-delete-recheck' ? targetRow : null,
  deleteMatrixRow: async versionId => { deleteCalls.push(versionId); },
  saveMainMatrixAfterApply: async () => ({ ok: true }),
  refreshNativeMatrixView: async () => ({ ok: true }),
};

const originalCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => bridge;
try {
  const result = await E.applyPlan(plan);
  assert(deleteCalls.includes('new-version-1') && !deleteCalls.includes('target-version'),
    `test setup must rollback only the created ADD: ${JSON.stringify(deleteCalls)}`);
  assert(loadSnapshotCalls >= 2,
    `rollback must be read back from TESSA, loadSnapshot calls: ${loadSnapshotCalls}`);
  assert(result.crossMatrixTransfer?.status === 'unsafe',
    `lingering rolled-back membership must be UNSAFE: ${JSON.stringify(result.crossMatrixTransfer)}`);
  assert(result.crossMatrixTransfer?.rollbackVerification?.status === 'divergent',
    `rollback verification must report divergence: ${JSON.stringify(result.crossMatrixTransfer?.rollbackVerification)}`);
} finally {
  E.TessaBridge.create = originalCreate;
}

console.log('TESSA Matrix Studio cross-matrix rollback read-back verification: OK');
