import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net', href: 'https://tessa.cherkizovsky.net/matrix' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.URL = globalThis.URL || class URL {};
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(source, { filename: 'tessa-matrix-studio.user.js' });

const UAT = globalThis.__TMS_FULL_UAT_V1__;
assert.ok(UAT, 'Full UAT runner export is required');
assert.equal(typeof UAT.fullUatAcceptedWriteResult, 'function', 'Full UAT must expose its accepted-write policy');

const acceptedButVerificationPending = {
  cancelled: false,
  status: 'partial',
  success: false,
  partial: true,
  appliedCount: 1,
  acceptedCount: 1,
  failedCount: 0,
  notStartedCount: 0,
  preflightSkippedCount: 0,
  storeSkippedCount: 0,
  verificationIncomplete: true,
  matrixSaveIncomplete: true,
};
assert.equal(UAT.fullUatAcceptedWriteResult(acceptedButVerificationPending), true,
  'accepted server mutation must be eligible for the Full UAT fresh read-back even when ordinary Apply verification is still partial');

for (const bad of [
  { ...acceptedButVerificationPending, cancelled: true },
  { ...acceptedButVerificationPending, appliedCount: 0, acceptedCount: 0 },
  { ...acceptedButVerificationPending, appliedCount: 2, acceptedCount: 2 },
  { ...acceptedButVerificationPending, failedCount: 1 },
  { ...acceptedButVerificationPending, notStartedCount: 1 },
  { ...acceptedButVerificationPending, preflightSkippedCount: 1 },
  { ...acceptedButVerificationPending, storeSkippedCount: 1 },
]) {
  assert.equal(UAT.fullUatAcceptedWriteResult(bad), false, `unsafe/incomplete mutation must be rejected: ${JSON.stringify(bad)}`);
}

assert.match(source, /E\.applyPlan\(plan,\s*\{\s*confirm:\s*\(\)\s*=>\s*true,\s*source:\s*'full-uat',\s*deferMatrixSave:\s*true\s*\}\)/,
  'Full UAT internal mutations must auto-confirm and defer main-card Save');
assert.match(source, /FULL_UAT_DEFER_MATRIX_SAVE_V1/,
  'Apply must have an explicit Full UAT matrix-save deferral branch');
assert.match(source, /FULL_UAT_BATCHED_MAIN_SAVE_V1/,
  'Full UAT must perform at most one batched native main-card Save after its write/cleanup phase');
assert.doesNotMatch(source, /FULL_UAT_STRICT_APPLY_RESULT_V1/,
  'obsolete v1.13 status===completed policy must not remain canonical');

console.log('Full UAT write policy: accepted mutation != immediate verification; internal confirms are automatic; main Save is batched: OK');
