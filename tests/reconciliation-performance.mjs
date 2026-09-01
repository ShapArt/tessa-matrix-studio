import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = {
  body: { innerText: '' },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ click() {}, style: {}, set href(_) {}, set download(_) {} }),
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.indexSnapshotForReconciliation === 'function', 'indexSnapshotForReconciliation is missing');
assert(typeof E.reconcileMutationReceipts === 'function', 'reconcileMutationReceipts is missing');

const O = E.constants.OPERAND;
const structure = {
  templateId: 'perf-template',
  conditions: [{ criterionRowId: 'criterion-org', criterionName: 'Организация', operandTypeId: O.ReferenceGuid }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};
function makeRow(i) {
  return {
    rowCardId: `card-${i}`,
    versionId: `version-${i}`,
    values: { 'criterion-org': [{ id: `org-${i % 700}`, display: `Организация ${i % 700}`, kind: 'ReferenceGuid' }] },
    roles: { 'function-sign': [{ id: `person-${i % 300}`, display: `Сотрудник ${i % 300}`, roleTypeId: `role-${i % 5}` }] },
  };
}

const rows = Array.from({ length: 20000 }, (_, i) => makeRow(i));
const receipts = rows.slice(0, 500).map((item, i) => ({
  type: 'update',
  excelRow: 15 + i,
  rowCardId: item.rowCardId,
  versionId: item.versionId,
  expectedSemanticKey: E.reconciliationSemanticKey(item, structure),
}));
const snapshot = { matrixId: 'matrix-perf', templateId: structure.templateId, rows };

const started = performance.now();
const result = E.reconcileMutationReceipts(receipts, snapshot, structure);
const elapsed = performance.now() - started;
assert(result.status === 'verified' && result.checkedCount === 500 && result.verifiedCount === 500, JSON.stringify(result));
assert(elapsed < 2000, `20k snapshot + 500 receipts reconciliation took ${elapsed.toFixed(1)}ms`);

const source = String(E.reconcileMutationReceipts);
assert(source.includes('indexSnapshotForReconciliation'), 'reconcileMutationReceipts must build indexes once');
assert(!/snapshot[^\n;]*\.find\s*\(/i.test(source), `receipt loop must not scan snapshot rows with find(): ${source}`);

console.log(`TESSA Matrix Studio reconciliation performance: OK (${elapsed.toFixed(1)}ms for 20k rows / 500 receipts)`);
