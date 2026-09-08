import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(code);
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;

// A successful CardStore plus CardGet is insufficient: the row must belong to
// this matrix with the expected values. Exercise real receipt reconciliation.
const structure = { templateId: 't', conditions: [], functions: [{ id: 'f', name: 'Исполнитель' }] };
const row = { rowCardId: 'c', versionId: 'v', roles: { f: [{ id: 'p', roleTypeId: 1, display: 'Тестер' }] } };
const receipt = E.createMutationReceipt({ type: 'add', action: { excelRow: { excelRow: 41 } }, rowCardId: 'c', versionId: 'v', expectedRow: row, structure });
const result = {
  rows: [{ type: 'add', excelRow: 41, status: 'ok' }],
  requestedCount: 1, plannedCount: 1, startedCount: 1, skipped: [],
};
result.reconciliation = E.reconcileMutationReceipts([receipt], { rows: [] }, structure);
E.finalizeApplyResult(result);
assert.equal(result.acceptedCount, 1);
assert.equal(result.appliedCount, 0);
assert.equal(result.status, 'partial');
assert.equal(result.success, false);
assert.equal(result.verificationIncomplete, true);

result.reconciliation = E.reconcileMutationReceipts([receipt], { rows: [row] }, structure);
E.finalizeApplyResult(result);
assert.equal(result.appliedCount, 1);
assert.equal(result.status, 'completed');
assert.equal(result.verificationIncomplete, false);

result.reconciliation = { status: 'incomplete', verifiedCount: 0, unknownCount: 1 };
E.finalizeApplyResult(result);
assert.equal(result.status, 'partial');
assert.equal(result.appliedCount, 0);

assert.ok(code.includes("panel.querySelector('#tms-apply').addEventListener('click', () => applySelected(true))"), 'ordinary Apply must also verify writes');
assert.ok(code.includes('APP.lastReconciliation = result.reconciliation;\n          finalizeApplyResult(result);'), 'UI must account for readback before reporting success');
console.log('Apply requires matrix membership and semantic readback before reporting complete success: OK');
