import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

assert(/^\/\/ @version\s+1\.9\.34$/m.test(code), 'this cancellation/delivery fix must ship under userscript @version 1.9.34');

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
assert(typeof E.requestApplyAbort === 'function', 'requestApplyAbort is missing');

const functionColumn = {
  id: 'function-sign', name: 'Подписание', kind: 'function',
  key: 'function:function-sign', excelHeader: 'Подписание',
};
const structure = {
  templateId: 'stop-preflight-template',
  conditions: [],
  functions: [{ id: functionColumn.id, name: functionColumn.name, typeName: functionColumn.name }],
};
const action = {
  type: 'add',
  excelRow: {
    excelRow: 151,
    flat: { [functionColumn.key]: ['Иванов И.И.'] },
    ids: { [functionColumn.key]: ['signer-1|role-type'] },
    compare: { [functionColumn.key]: ['id:signer-1|role-type'] },
    columns: new Map([[functionColumn.id, functionColumn]]),
    system: {},
    hasData: true,
  },
  currentRow: null,
  changes: [],
  match: { matchedBy: 'new-row-no-id', lowConfidence: false },
};
const plan = {
  id: 'stop-pending-preflight',
  matrixId: 'stop-preflight-matrix',
  actions: [action],
  skippedRows: [],
  counts: { update: 0, add: 1, delete: 0, noop: 0, skip: 0 },
  safety: { blocked: false, blockedReasons: [] },
};
const fresh = {
  matrixId: plan.matrixId,
  templateId: structure.templateId,
  rows: [],
  criterionIdCache: new Map(),
  roleIdByFunctionCache: new Map(),
  roleIdCache: new Map(),
};

let releaseCreate;
const createGate = new Promise(resolve => { releaseCreate = resolve; });
let createStarted = false;
let stores = 0;
const bridge = {
  matrixInfo: () => ({ matrixId: plan.matrixId, TemplateID: structure.templateId, StateName: 'Черновик' }),
  templateId: () => structure.templateId,
  requestStructure: async () => structure,
  loadSnapshot: async () => fresh,
  resolveReferenceOnline: async () => null,
  resolveRole: (fn, display, packedId) => {
    const [id, roleTypeId] = String(packedId || '').split('|');
    return { id, display, roleTypeId: roleTypeId || 'role-type' };
  },
  assertCanCreateRows: () => {},
  createRowCard: async () => {
    createStarted = true;
    await createGate;
    return { card: {}, cardId: 'late-card', versionId: 'late-version', newMethod: 'CardNew' };
  },
  rebuildRowCard: () => {},
  validateDuplicate: async () => {},
  storeRowCard: async () => { stores += 1; },
  refresh: async () => {},
};

const originalCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => bridge;
let applyPromise;
try {
  applyPromise = E.applyPlan(plan);
  for (let i = 0; i < 50 && !createStarted; i += 1) await sleep(10);
  assert(createStarted, 'Apply did not reach the simulated pending CardNew request');

  E.requestApplyAbort();
  const stoppedAt = Date.now();
  const outcome = await Promise.race([
    applyPromise.then(result => ({ type: 'result', result, elapsed: Date.now() - stoppedAt })),
    sleep(500).then(() => ({ type: 'timeout', elapsed: Date.now() - stoppedAt })),
  ]);

  if (outcome.type === 'timeout') {
    releaseCreate();
    await applyPromise;
    throw new Error(`Stop waited for the pending TESSA preflight request for more than ${outcome.elapsed}ms`);
  }

  assert(outcome.elapsed < 500, `preflight Stop took too long: ${outcome.elapsed}ms`);
  assert(outcome.result?.status === 'cancelled', `expected cancelled result, got ${JSON.stringify(outcome.result)}`);
  assert(outcome.result?.appliedCount === 0, `preflight cancellation must not Store rows: ${JSON.stringify(outcome.result)}`);
  assert(stores === 0, `Store started after preflight cancellation: ${stores}`);
} finally {
  releaseCreate?.();
  E.TessaBridge.create = originalCreate;
}

console.log('TESSA Matrix Studio pending-preflight Stop regression: OK');
