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
assert(typeof E.finalizeCrossMatrixTransferVerification === 'function',
  'finalizeCrossMatrixTransferVerification must be exported');

const verified = {
  crossMatrixTransfer: { status: 'awaiting-verification', acceptedMutationCount: 2 },
  reconciliation: { status: 'verified', verifiedCount: 2, divergentCount: 0, missingCount: 0, unknownCount: 0 },
};
E.finalizeCrossMatrixTransferVerification(verified);
assert(verified.crossMatrixTransfer.status === 'verified',
  `fully reconciled transfer must be verified: ${JSON.stringify(verified.crossMatrixTransfer)}`);

const divergent = {
  crossMatrixTransfer: { status: 'awaiting-verification', acceptedMutationCount: 2 },
  reconciliation: { status: 'divergent', verifiedCount: 1, divergentCount: 1, missingCount: 0, unknownCount: 0 },
};
E.finalizeCrossMatrixTransferVerification(divergent);
assert(divergent.crossMatrixTransfer.status === 'unsafe',
  `divergent transfer must be unsafe: ${JSON.stringify(divergent.crossMatrixTransfer)}`);

const incomplete = {
  crossMatrixTransfer: { status: 'awaiting-verification', acceptedMutationCount: 2 },
  reconciliation: { status: 'incomplete', verifiedCount: 1, divergentCount: 0, missingCount: 0, unknownCount: 1 },
};
E.finalizeCrossMatrixTransferVerification(incomplete);
assert(incomplete.crossMatrixTransfer.status === 'incomplete',
  `incomplete read-back must stay incomplete: ${JSON.stringify(incomplete.crossMatrixTransfer)}`);

const terminal = {
  crossMatrixTransfer: { status: 'rolled-back', acceptedMutationCount: 0 },
  reconciliation: { status: 'verified', verifiedCount: 0 },
};
E.finalizeCrossMatrixTransferVerification(terminal);
assert(terminal.crossMatrixTransfer.status === 'rolled-back', 'terminal rollback state must not be overwritten');

const O = E.constants.OPERAND;
const structure = {
  templateId: 'cross-matrix-success-template',
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
  matrixId: 'matrix-source-success', templateId: structure.templateId,
  rows: [row(0, 'source-card', 'source-version', 'org-source', 'Компания Источник', 'person-source', 'Иванов И.И.')],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const targetRow = row(0, 'target-card', 'target-version', 'org-target', 'Компания Цель', 'person-target', 'Петров П.П.');
const target = {
  matrixId: 'matrix-target-success', templateId: structure.templateId, rows: [targetRow],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const sourceInfo = { matrixId: source.matrixId, TemplateID: structure.templateId, TemplateName: 'SUCCESS VERIFY QA', Name: 'Источник', StateName: 'Черновик' };
const targetInfo = { matrixId: target.matrixId, TemplateID: structure.templateId, TemplateName: 'SUCCESS VERIFY QA', Name: 'Цель', StateName: 'Черновик' };
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, source);
const bytes = await E.createRoundtripXlsxBytes(structure, source, sourceInfo, catalog);
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'success-source.xlsx');
const plan = E.buildPlan(workbook, structure, target, targetInfo);
assert(plan.crossMatrixReplacement?.enabled && plan.counts.add === 1 && plan.counts.delete === 1,
  `expected 1 ADD + 1 DELETE transfer: ${JSON.stringify(plan.counts)}`);

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
  readMatrixRowFromCard: (_card, current) => current?.source === 'targeted-delete-recheck' ? targetRow : null,
  deleteMatrixRow: async () => {},
  saveMainMatrixAfterApply: async () => ({ ok: true }),
  refreshNativeMatrixView: async () => ({ ok: true }),
};
const originalCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => bridge;
try {
  const result = await E.applyPlan(plan);
  assert(result.crossMatrixTransfer?.status === 'awaiting-verification',
    `accepted transfer must await read-back verification: ${JSON.stringify(result.crossMatrixTransfer)}`);
  assert(result.crossMatrixTransfer?.acceptedMutationCount === 2,
    `accepted mutation count must cover ADD + DELETE: ${JSON.stringify(result.crossMatrixTransfer)}`);
} finally {
  E.TessaBridge.create = originalCreate;
}

console.log('TESSA Matrix Studio successful cross-matrix verification state contract: OK');
