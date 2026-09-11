import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(code);
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;

// A successful mutation and post-write verification are two different facts.
// appliedCount keeps the historical meaning: mutation requests accepted by TESSA.
// verifiedCount is the stricter semantic/membership readback. An incomplete readback
// must never rewrite a successful Apply into the misleading "0 applied" result.
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
assert.equal(result.appliedCount, 1);
assert.equal(result.verifiedCount, 0);
assert.equal(result.status, 'partial');
assert.equal(result.success, false);
assert.equal(result.verificationIncomplete, true);

result.reconciliation = E.reconcileMutationReceipts([receipt], { rows: [row] }, structure);
E.finalizeApplyResult(result);
assert.equal(result.appliedCount, 1);
assert.equal(result.verifiedCount, 1);
assert.equal(result.status, 'completed');
assert.equal(result.verificationIncomplete, false);

result.reconciliation = { status: 'incomplete', checkedCount: 0, verifiedCount: 0, unknownCount: 1, reasonCode: 'reconcile-read-failed' };
E.finalizeApplyResult(result);
assert.equal(result.appliedCount, 1);
assert.equal(result.verifiedCount, 0);
assert.equal(result.status, 'partial');
assert.match(E.applyResultMessage(result), /1 из 1/);
assert.doesNotMatch(E.applyResultMessage(result), /Применено:\s*0/);

// Exact regression from the live 2026-09-09 report: all four mutation calls returned
// status=ok, but the native readback failed before checking any receipt (23/25 rows).
// This is "4 writes accepted, verification incomplete", never "0 of 4 applied".
const liveLike = {
  rows: [
    { type: 'update', excelRow: 38, status: 'ok' },
    { type: 'add', excelRow: 39, status: 'ok' },
    { type: 'delete', status: 'ok' },
    { type: 'delete', status: 'ok' },
  ],
  requestedCount: 4,
  plannedCount: 4,
  startedCount: 4,
  skipped: [],
  reconciliation: {
    status: 'incomplete',
    checkedCount: 0,
    verifiedCount: 0,
    divergentCount: 0,
    missingCount: 0,
    unknownCount: 4,
    reasonCode: 'reconcile-read-failed',
  },
};
E.finalizeApplyResult(liveLike);
assert.equal(liveLike.acceptedCount, 4);
assert.equal(liveLike.appliedCount, 4);
assert.equal(liveLike.verifiedCount, 0);
assert.equal(liveLike.verificationIncomplete, true);
assert.equal(liveLike.status, 'partial');
assert.equal(liveLike.success, false);
const liveMessage = E.applyResultMessage(liveLike);
assert.match(liveMessage, /4 из 4/);
assert.match(liveMessage, /провер/i);
assert.doesNotMatch(liveMessage, /Применено:\s*0/);

assert.ok(code.includes("panel.querySelector('#tms-apply').addEventListener('click', () => applySelected(true))"), 'ordinary Apply must also verify writes');
assert.ok(code.includes('APP.lastReconciliation = result.reconciliation;\n          finalizeCrossMatrixTransferVerification(result);\n          finalizeApplyResult(result);'), 'UI must apply transfer readback state before reporting final Apply success');
console.log('Apply accounting separates accepted writes from post-write verification: OK');
