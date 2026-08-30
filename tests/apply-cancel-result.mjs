import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

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
const O = E.constants.OPERAND;
assert(typeof E.requestApplyAbort === 'function', 'requestApplyAbort is missing');

const structure = {
  templateId: 'cancel-template',
  conditions: [{
    criterionRowId: 'criterion-org',
    criterionName: 'Организация',
    operandTypeId: O.ReferenceGuid,
    autocompleteViewName: 'QaOrganizationView',
    refSection: 'QaOrganizationView',
  }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};

function currentRow(index) {
  const org = `Организация ${index + 1}`;
  const person = `Сотрудник ${index + 1}`;
  const flat = {
    'criterion:criterion-org': [org],
    'function:function-sign': [person],
  };
  return {
    index,
    rowCardId: `card-${index + 1}`,
    versionId: `version-${index + 1}`,
    fingerprint: E.fingerprintFlat(flat),
    values: { 'criterion-org': [{ id: `org-${index + 1}`, display: org }] },
    roles: { 'function-sign': [{ id: `person-${index + 1}`, display: person, roleTypeId: 'role-type' }] },
    flat,
  };
}

const snapshot = {
  matrixId: 'cancel-matrix',
  templateId: structure.templateId,
  rows: Array.from({ length: 4 }, (_, index) => currentRow(index)),
  criterionIdCache: new Map(),
  roleIdByFunctionCache: new Map(),
  roleIdCache: new Map(),
};
const matrixInfo = {
  matrixId: snapshot.matrixId,
  TemplateID: snapshot.templateId,
  TemplateName: 'Cancel QA',
  StateName: 'Черновик',
  Name: 'Cancel QA',
};

const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, matrixInfo, catalog);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const workbook = await E.readXlsxArrayBuffer(buffer, 'cancel-qa.xlsx');
const signerIndex = workbook.headers.indexOf('Подписание');
const signerIdIndex = workbook.headers.indexOf('Подписание__ID');
assert(signerIndex >= 0 && signerIdIndex >= 0, 'signer columns unavailable');

// Change all four rows while keeping each organization unique, so preflight prepares 4 UPDATEs.
for (let index = 0; index < workbook.rows.length; index += 1) {
  const source = workbook.rows[(index + 1) % workbook.rows.length];
  workbook.rows[index].values[signerIndex] = source.values[signerIndex];
  workbook.rows[index].values[signerIdIndex] = source.values[signerIdIndex];
}
const plan = E.buildPlan(workbook, structure, snapshot);
plan.safety = { blocked: false, blockedReasons: [] };
assert(plan.counts.update === 4, `expected 4 UPDATEs, got ${JSON.stringify(plan.counts)}`);

let stores = 0;
const bridge = {
  matrixInfo: () => matrixInfo,
  templateId: () => structure.templateId,
  requestStructure: async () => structure,
  loadSnapshot: async () => snapshot,
  resolveReferenceOnline: async () => null,
  resolveCriterion: (condition, display, id) => ({ id, display }),
  resolveRole: (fn, display, packedId) => {
    const [id, roleTypeId] = String(packedId || '').split('|');
    return { id, display, roleTypeId: roleTypeId || 'role-type' };
  },
  getCard: async rowCardId => ({ id: rowCardId }),
  rebuildRowCard: () => {},
  validateDuplicate: async () => {},
  assertCanCreateRows: () => {},
  storeRowCard: async card => {
    stores += 1;
    if (stores === 2) E.requestApplyAbort();
    return { cardId: card?.id || `stored-${stores}` };
  },
  refresh: async () => {},
};

const originalCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => bridge;
let result;
try {
  result = await E.applyPlan(plan);
} finally {
  E.TessaBridge.create = originalCreate;
}

assert(result && result.status === 'cancelled', `expected cancelled result, got ${JSON.stringify(result)}`);
assert(result.cancelled === true, `cancelled flag missing: ${JSON.stringify(result)}`);
assert(result.plannedCount === 4, `plannedCount expected 4, got ${result.plannedCount}`);
assert(result.startedCount === 2, `startedCount expected 2, got ${result.startedCount}`);
assert(result.appliedCount === 2, `appliedCount expected 2, got ${result.appliedCount}`);
assert(result.failedCount === 0, `failedCount expected 0, got ${result.failedCount}`);
assert(result.notStartedCount === 2, `notStartedCount expected 2, got ${result.notStartedCount}`);
assert(stores === 2, `Apply continued after cancellation: stores=${stores}`);

console.log('TESSA Matrix Studio exact cancelled Apply result: OK');
