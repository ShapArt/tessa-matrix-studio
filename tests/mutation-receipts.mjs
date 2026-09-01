import fs from 'node:fs';
import vm from 'node:vm';

let code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

// Test-only instrumentation: expose the real session APP object without adding any
// production debug API for private mutation receipts.
code = code.replace('  const APP = {', '  const APP = globalThis.__TMS_RECEIPT_TEST_APP__ = {');

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = {
  body: { innerText: 'Завершить редактирование и разблокировать' },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ click() {}, style: {}, set href(_) {}, set download(_) {} }),
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const APP = globalThis.__TMS_RECEIPT_TEST_APP__;
assert(typeof E.reconciliationSemanticKey === 'function', 'reconciliationSemanticKey is missing');
assert(typeof E.createMutationReceipt === 'function', 'createMutationReceipt is missing');
assert(APP && Object.prototype.hasOwnProperty.call(APP, 'lastMutationReceipts'), 'APP.lastMutationReceipts is missing');

const O = E.constants.OPERAND;
const structure = {
  templateId: 'receipt-template',
  conditions: [
    { criterionRowId: 'criterion-org', criterionName: 'Организация', operandTypeId: O.ReferenceGuid },
    { criterionRowId: 'criterion-enabled', criterionName: 'Активно', operandTypeId: O.Boolean },
    { criterionRowId: 'criterion-limit', criterionName: 'Лимит', operandTypeId: O.Int },
  ],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};

function semanticRow({
  orgId = 'org-1',
  orgDisplay = 'Организация старая',
  enabled = true,
  from = 10,
  to = 20,
  roles = [
    { id: 'person-1', display: 'Сотрудник Старое Имя', roleTypeId: 'role-type-1' },
    { id: 'person-2', display: 'Другой Сотрудник', roleTypeId: 'role-type-2' },
  ],
} = {}) {
  return {
    values: {
      'criterion-org': [{ id: orgId, display: orgDisplay, kind: 'ReferenceGuid' }],
      'criterion-enabled': [{ id: null, display: enabled ? 'true' : 'false', kind: 'Boolean', value: enabled }],
      'criterion-limit': [{ id: null, display: `${from} - ${to}`, kind: 'Int', value: from, to }],
    },
    roles: { 'function-sign': roles },
  };
}

const base = semanticRow();
const renamed = semanticRow({
  orgDisplay: 'Организация НОВОЕ НАЗВАНИЕ',
  roles: [
    { id: 'person-2', display: 'Переименованный второй', roleTypeId: 'role-type-2' },
    { id: 'person-1', display: 'Переименованный первый', roleTypeId: 'role-type-1' },
  ],
});
const changedReference = semanticRow({ orgId: 'org-2', orgDisplay: 'Организация старая' });
const changedBoolean = semanticRow({ enabled: false });
const changedRange = semanticRow({ from: 10, to: 21 });

const baseKey = E.reconciliationSemanticKey(base, structure);
assert(baseKey === E.reconciliationSemanticKey(renamed, structure), 'display rename or multivalue order changed ID-first semantic key');
assert(baseKey !== E.reconciliationSemanticKey(changedReference, structure), 'reference ID change must change semantic key');
assert(baseKey !== E.reconciliationSemanticKey(changedBoolean, structure), 'Boolean change must change semantic key');
assert(baseKey !== E.reconciliationSemanticKey(changedRange, structure), 'numeric range change must change semantic key');

const factoryReceipt = E.createMutationReceipt({
  type: 'update',
  action: { excelRow: { excelRow: 15 } },
  rowCardId: 'card-1',
  versionId: 'version-1',
  expectedRow: base,
  structure,
});
assert(factoryReceipt.type === 'update' && factoryReceipt.excelRow === 15, JSON.stringify(factoryReceipt));
assert(factoryReceipt.rowCardId === 'card-1' && factoryReceipt.versionId === 'version-1', JSON.stringify(factoryReceipt));
assert(factoryReceipt.expectedSemanticKey === baseKey, JSON.stringify(factoryReceipt));
const deleteReceipt = E.createMutationReceipt({ type: 'delete', action: {}, rowCardId: 'card-d', versionId: 'version-d', expectedRow: null, structure });
assert(deleteReceipt.expectedSemanticKey === null, JSON.stringify(deleteReceipt));

// Real Apply integration. Reuse the production workbook/planner path so receipt capture
// is proven against the same prepared UPDATE object used by Store.
const oneStructure = {
  templateId: 'receipt-apply-template',
  conditions: [{ criterionRowId: 'criterion-org', criterionName: 'Организация', operandTypeId: O.ReferenceGuid, autocompleteViewName: 'QaOrganizationView', refSection: 'QaOrganizationView' }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};
const flat = { 'criterion:criterion-org': ['Организация 1'], 'function:function-sign': ['Сотрудник 1'] };
const current = {
  index: 0,
  rowCardId: 'card-1',
  versionId: 'version-1',
  fingerprint: E.fingerprintFlat(flat),
  values: { 'criterion-org': [{ id: 'org-1', display: 'Организация 1', kind: 'ReferenceGuid' }] },
  roles: { 'function-sign': [{ id: 'person-1', display: 'Сотрудник 1', roleTypeId: 'role-type' }] },
  flat,
};
const snapshot = { matrixId: 'receipt-matrix', templateId: oneStructure.templateId, rows: [current], criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map() };
const matrixInfo = { matrixId: snapshot.matrixId, TemplateID: snapshot.templateId, TemplateName: 'Receipt QA', StateName: 'Черновик', Name: 'Receipt QA' };
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, oneStructure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(oneStructure, snapshot, matrixInfo, catalog);
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'receipt.xlsx');
const signerIndex = workbook.headers.indexOf('Подписание');
const signerIdIndex = workbook.headers.indexOf('Подписание__ID');
workbook.rows[0].values[signerIndex] = 'Сотрудник 2';
workbook.rows[0].values[signerIdIndex] = 'person-2|role-type';
const plan = E.buildPlan(workbook, oneStructure, snapshot);
plan.safety = { blocked: false, blockedReasons: [] };

const expectedAppliedRow = {
  rowCardId: 'card-1',
  versionId: 'version-1',
  values: { 'criterion-org': [{ id: 'org-1', display: 'Любое новое отображение', kind: 'ReferenceGuid' }] },
  roles: { 'function-sign': [{ id: 'person-2', display: 'Любое имя', roleTypeId: 'role-type' }] },
};
function makeBridge({ failStore = false } = {}) {
  return {
    matrixInfo: () => matrixInfo,
    templateId: () => oneStructure.templateId,
    requestStructure: async () => oneStructure,
    loadSnapshot: async () => snapshot,
    resolveReferenceOnline: async () => null,
    resolveCriterion: (condition, display, id) => ({ id, display }),
    resolveRole: (fn, display, packedId) => { const [id, roleTypeId] = String(packedId || '').split('|'); return { id, display, roleTypeId: roleTypeId || 'role-type' }; },
    getCard: async rowCardId => ({ id: rowCardId }),
    rebuildRowCard: () => {},
    readMatrixRowFromCard: () => expectedAppliedRow,
    validateDuplicate: async () => {},
    assertCanCreateRows: () => {},
    storeRowCard: async card => {
      if (failStore) throw new Error('synthetic store failure');
      return { cardId: card?.id || 'card-1' };
    },
  };
}

const originalCreate = E.TessaBridge.create;
let successResult;
try {
  E.TessaBridge.create = async () => makeBridge();
  successResult = await E.applyPlan(plan);
} finally {
  E.TessaBridge.create = originalCreate;
}
assert(successResult?.status === 'completed', JSON.stringify(successResult));
assert(APP.lastMutationReceipts?.planId === plan.id, JSON.stringify(APP.lastMutationReceipts));
assert(APP.lastMutationReceipts?.matrixId === plan.matrixId, JSON.stringify(APP.lastMutationReceipts));
assert(APP.lastMutationReceipts?.templateId === oneStructure.templateId, JSON.stringify(APP.lastMutationReceipts));
assert(APP.lastMutationReceipts?.receipts?.length === 1, JSON.stringify(APP.lastMutationReceipts));
const storedReceipt = APP.lastMutationReceipts.receipts[0];
assert(storedReceipt.type === 'update' && storedReceipt.rowCardId === 'card-1' && storedReceipt.versionId === 'version-1', JSON.stringify(storedReceipt));
assert(storedReceipt.expectedSemanticKey === E.reconciliationSemanticKey(expectedAppliedRow, oneStructure), JSON.stringify(storedReceipt));
assert(!JSON.stringify(successResult).includes('expectedSemanticKey'), 'private receipt leaked into Apply result');
assert(!JSON.stringify(APP.lastReport).includes('expectedSemanticKey'), 'private receipt leaked into downloadable Apply report');

let failedResult;
try {
  E.TessaBridge.create = async () => makeBridge({ failStore: true });
  failedResult = await E.applyPlan(plan);
} finally {
  E.TessaBridge.create = originalCreate;
}
assert(failedResult?.status === 'partial', JSON.stringify(failedResult));
assert(APP.lastMutationReceipts?.receipts?.length === 0, `failed Store produced private receipt: ${JSON.stringify(APP.lastMutationReceipts)}`);
assert(!JSON.stringify(failedResult).includes('expectedSemanticKey'), 'failed Apply result leaked private receipt');

console.log('TESSA Matrix Studio private mutation receipts + ID-first semantics: OK');
