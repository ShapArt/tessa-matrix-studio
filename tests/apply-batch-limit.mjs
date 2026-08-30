import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = { body: { innerText: 'Завершить редактирование и разблокировать' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.evaluateApplyBatch === 'function', 'evaluateApplyBatch is missing');

const makeActions = count => Array.from({ length: count }, (_, index) => ({
  type: 'update',
  excelRow: { excelRow: index + 2 },
  currentRow: { rowCardId: `card-${index}`, versionId: `version-${index}` },
  changes: [{ key: 'x', before: ['a'], after: ['b'] }],
}));

let batch = E.evaluateApplyBatch(makeActions(500));
assert(batch.count === 500 && batch.warning === false && batch.blocked === false,
  `500 actions must be normal: ${JSON.stringify(batch)}`);

batch = E.evaluateApplyBatch(makeActions(501));
assert(batch.count === 501 && batch.warning === true && batch.blocked === false,
  `501 actions must require warning only: ${JSON.stringify(batch)}`);

batch = E.evaluateApplyBatch(makeActions(2000));
assert(batch.count === 2000 && batch.warning === true && batch.blocked === false,
  `2000 actions must remain allowed with warning: ${JSON.stringify(batch)}`);

batch = E.evaluateApplyBatch(makeActions(2001));
assert(batch.count === 2001 && batch.blocked === true,
  `2001 actions must be blocked: ${JSON.stringify(batch)}`);
assert(/2000|пакет|операц/i.test(batch.reason || ''), `blocked batch needs readable reason: ${JSON.stringify(batch)}`);

// A blocked batch must fail before creating TessaBridge or issuing any TESSA call.
let bridgeCreated = false;
const originalCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => { bridgeCreated = true; throw new Error('bridge must not be created'); };
const actions = makeActions(2001);
const plan = {
  id: 'batch-blocked',
  actions,
  counts: { update: 2001, add: 0, delete: 0, noop: 0, skip: 0 },
  skippedRows: [],
  safety: { blocked: false, blockedReasons: [] },
};
let error = null;
try {
  await E.applyPlan(plan);
} catch (caught) {
  error = caught;
} finally {
  E.TessaBridge.create = originalCreate;
}
assert(error && /2000|пакет|операц/i.test(String(error.message || error)), `blocked Apply returned wrong error: ${error?.message || 'none'}`);
assert(bridgeCreated === false, 'blocked batch created TessaBridge before rejecting Apply');

console.log('TESSA Matrix Studio Apply batch limits: OK');
