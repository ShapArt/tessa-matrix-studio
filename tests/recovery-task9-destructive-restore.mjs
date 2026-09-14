import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.example.test', href: 'https://tessa.example.test/matrix' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };

const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source, { filename: 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const U = globalThis.__TMS_FULL_UAT_V1__;

assert.equal(typeof U.createCleanupLedger, 'function', 'Task9 cleanup ledger helper missing');
assert.equal(typeof U.baselineRestoreProof, 'function', 'Task9 baseline restore proof helper missing');

const baseline = ['row-a|v1', 'row-b|v2'];
const ledger = U.createCleanupLedger(baseline);
assert.deepEqual(ledger.baselineSignature, baseline, 'ledger must freeze the pre-write baseline signature');

const rowObligation = ledger.register({
  kind: 'temporary-row', scenarioId: 'write-add-delete', rowCardId: 'ROW-1',
  createdAt: '2026-09-14T00:00:00.000Z',
});
const fieldObligation = ledger.register({
  kind: 'field-mutation', scenarioId: 'write-every-field', rowCardId: 'ROW-1', token: 'criterion:Amount',
  before: ['10'], candidate: ['20'], createdAt: '2026-09-14T00:00:01.000Z',
});
assert.notEqual(rowObligation.id, fieldObligation.id, 'cleanup obligation ids must be unique');
assert.equal(ledger.snapshot().pending, 2);
assert.equal(ledger.snapshot().obligations.length, 2);

ledger.resolve(fieldObligation.id, { status: 'verified', observed: ['10'], resolvedAt: '2026-09-14T00:00:02.000Z' });
assert.equal(ledger.snapshot().pending, 1);
assert.equal(ledger.snapshot().verified, 1);
ledger.resolve(rowObligation.id, { status: 'already-absent', resolvedAt: '2026-09-14T00:00:03.000Z' });
const settled = ledger.snapshot();
assert.equal(settled.pending, 0);
assert.equal(settled.verified, 2);
assert.equal(settled.failed, 0);
assert.ok(settled.obligations.every(item => ['verified', 'already-absent'].includes(item.status)));

const proofOk = U.baselineRestoreProof(baseline, [...baseline], settled);
assert.equal(proofOk.status, 'VERIFIED');
assert.equal(proofOk.baselineEquivalent, true);
assert.equal(proofOk.pendingObligations, 0);
assert.equal(proofOk.failedObligations, 0);

const dirtyLedger = U.createCleanupLedger(baseline);
dirtyLedger.register({ kind: 'temporary-row', scenarioId: 'crash-mid-write', rowCardId: 'ROW-LEAK' });
const proofPending = U.baselineRestoreProof(baseline, [...baseline], dirtyLedger.snapshot());
assert.equal(proofPending.status, 'UNSAFE', 'pending cleanup obligations must make restore proof UNSAFE');
assert.equal(proofPending.pendingObligations, 1);

const proofDiverged = U.baselineRestoreProof(baseline, ['row-a|v1', 'row-b|CHANGED'], settled);
assert.equal(proofDiverged.status, 'UNSAFE', 'baseline divergence must make restore proof UNSAFE');
assert.equal(proofDiverged.baselineEquivalent, false);

// Production integration contract: obligations must be recorded before destructive work,
// global recovery must run from finally, and the downloaded package must carry the ledger.
assert.match(source, /cleanupLedger\s*:/, 'Full UAT report must expose cleanupLedger');
assert.match(source, /registerCleanupObligation\([^)]*temporary-row/s, 'temporary rows must become cleanup obligations');
assert.match(source, /registerCleanupObligation\([^)]*field-mutation/s, 'field mutations must become cleanup obligations');
assert.match(source, /finally\s*\{[\s\S]*recoverCleanupObligations\(/, 'global cleanup recovery must execute from finally');
assert.match(source, /baselineRestoreProof\(/, 'finally path must compute canonical baseline restore proof');
assert.match(source, /cleanup-ledger\.json/, 'UAT ZIP must contain cleanup-ledger.json');
assert.match(source, /restoreProof/, 'report must persist final restore proof');
assert.match(source, /UNSAFE/, 'restore failure must remain an UNSAFE outcome');

console.log('Recovery Task9 contract: obligation ledger, finally recovery, fresh baseline proof and ZIP evidence required');
