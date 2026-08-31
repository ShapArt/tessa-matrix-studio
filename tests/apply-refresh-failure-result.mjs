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

const structure = {
  templateId: 'no-auto-refresh-template',
  conditions: [{
    criterionRowId: 'criterion-org', criterionName: 'Организация', operandTypeId: O.ReferenceGuid,
    autocompleteViewName: 'QaOrganizationView', refSection: 'QaOrganizationView',
  }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};

const flat = {
  'criterion:criterion-org': ['Организация 1'],
  'function:function-sign': ['Сотрудник 1'],
};
const current = {
  index: 0,
  rowCardId: 'card-1',
  versionId: 'version-1',
  fingerprint: E.fingerprintFlat(flat),
  values: { 'criterion-org': [{ id: 'org-1', display: 'Организация 1' }] },
  roles: { 'function-sign': [{ id: 'person-1', display: 'Сотрудник 1', roleTypeId: 'role-type' }] },
  flat,
};
const snapshot = {
  matrixId: 'no-auto-refresh-matrix',
  templateId: structure.templateId,
  rows: [current],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const matrixInfo = {
  matrixId: snapshot.matrixId,
  TemplateID: snapshot.templateId,
  TemplateName: 'No Auto Refresh QA',
  StateName: 'Черновик',
  Name: 'No Auto Refresh QA',
};

const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, matrixInfo, catalog);
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'no-auto-refresh.xlsx');
const signerIndex = workbook.headers.indexOf('Подписание');
const signerIdIndex = workbook.headers.indexOf('Подписание__ID');
assert(signerIndex >= 0 && signerIdIndex >= 0, 'signer columns unavailable');
workbook.rows[0].values[signerIndex] = 'Сотрудник 2';
workbook.rows[0].values[signerIdIndex] = 'person-2|role-type';

const plan = E.buildPlan(workbook, structure, snapshot);
plan.safety = { blocked: false, blockedReasons: [] };
assert(plan.counts.update === 1, `expected one UPDATE, got ${JSON.stringify(plan.counts)}`);

let stores = 0;
let refreshCalls = 0;
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
  storeRowCard: async card => { stores += 1; return { cardId: card?.id || 'card-1' }; },
  refresh: async () => { refreshCalls += 1; throw new Error('native TestMatrixView refresh must not be forced'); },
};

const originalCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => bridge;
let result = null;
let thrown = null;
try {
  result = await E.applyPlan(plan);
} catch (error) {
  thrown = error;
} finally {
  E.TessaBridge.create = originalCreate;
}

assert(!thrown, `successful Store must not depend on a forced card/view refresh: ${thrown?.message || thrown}`);
assert(stores === 1, `expected one successful Store, got ${stores}`);
assert(refreshCalls === 0, `Apply must not force editor.refreshCard()/view reload after Store; got ${refreshCalls} refresh call(s)`);
assert(result, 'Apply must return a result');
assert(result.appliedCount === 1, `appliedCount expected 1, got ${result.appliedCount}`);
assert(result.status === 'completed', `successful Store must stay completed, got ${result.status}`);
assert(result.success === true, `successful Store must stay success=true: ${JSON.stringify(result)}`);
assert(result.refreshError === null, `refreshError must stay null when no forced refresh is attempted: ${JSON.stringify(result)}`);
assert(result.verificationIncomplete === false, `no synthetic refresh failure should mark result partial: ${JSON.stringify(result)}`);

const message = E.applyResultMessage(result);
assert(/свеж/i.test(message), `success UX must still recommend a fresh export before further work: ${message}`);

console.log('TESSA Matrix Studio successful Apply does not force native card/view refresh: OK');
