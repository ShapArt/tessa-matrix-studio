import fs from 'node:fs';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(source, /FULL_UAT_ACTION_COVERAGE_FINAL_V1/,
  'final Full UAT action-coverage marker missing');

const applyEvidence = source.match(/addCheck\(\s*['"]action-apply['"][\s\S]{0,1800}?outcome:\s*applyOk\s*\?\s*['"]live-write-readback['"]/);
assert.ok(applyEvidence, 'Apply must have an explicit addCheck evidence path with live-write-readback');
assert.match(source, /report\.writesCompleted\s*===\s*report\.writesAttempted/,
  'Apply evidence must require all attempted writes to complete');

const reconcileEvidence = source.match(/await E\.runReconciliationRead\([\s\S]{0,2200}?addCheck\(\s*['"]action-reconcile['"][\s\S]{0,1200}?outcome:\s*['"]reconciliation-readback['"]/);
assert.ok(reconcileEvidence, 'Reconcile must execute runReconciliationRead and emit explicit action evidence');
assert.match(source, /E\.createMutationReceipt\(\{[\s\S]{0,600}?type:\s*['"]delete['"]/,
  'Reconcile evidence must be receipt-backed');
assert.match(source, /reconciliationResult\?\.status\s*!==\s*['"]verified['"]/,
  'Reconcile evidence must fail closed unless the product reconciliation result is verified');

const auditIndex = source.lastIndexOf('report.functionalActionAudit = actionCoverageFromChecks');
const applyIndex = source.lastIndexOf("'action-apply'", auditIndex);
const reconcileIndex = source.lastIndexOf("'action-reconcile'", auditIndex);
assert.ok(applyIndex >= 0 && applyIndex < auditIndex, 'Apply evidence must be emitted before final action audit');
assert.ok(reconcileIndex >= 0 && reconcileIndex < auditIndex, 'Reconcile evidence must be emitted before final action audit');

console.log('TESSA Matrix Studio Full UAT final action coverage regression: OK');