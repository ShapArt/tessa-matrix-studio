import fs from 'node:fs';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url).pathname;
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(source, /FULL_UAT_PREFLIGHT_RECOVERY_STATE_V1/,
  'Full UAT must model initialization/recovery state explicitly');
assert.match(source, /let baselineCaptured = false;/,
  'Full UAT must distinguish pre-baseline aborts from recovery failures');
assert.match(source, /baselineSignature = snapshotSignature\(baseline\);\s+baselineCaptured = true;\s+const info = bridge\.matrixInfo\(\);[\s\S]{0,700}?pinnedUatBridge = bridge;[\s\S]{0,700}?initializationPhase = 'dictionary';/,
  'authoritative bridge and baseline identity must be pinned before dictionary loading can fail');
assert.match(source, /const abortedBeforeBaseline = !baselineCaptured && report\.writesAttempted === 0;/,
  'preflight abort before baseline must be classified separately');
assert.match(source, /const recoveryReady = Boolean\(baselineCaptured && baselineSignature && structure && pinnedUatBridge && report\.matrix\?\.matrixId\);/,
  'recovery must require a complete baseline context');
assert.match(source, /if \(!recoveryReady && report\.writesAttempted === 0\) \{[\s\S]{0,900}?status: 'NOT_REQUIRED'[\s\S]{0,900}?'final-restore-proof'[\s\S]{0,300}?'NOT_RUN'/,
  'no-write preflight abort must not execute baseline recovery or become UNSAFE');
assert.match(source, /if \(version !== '1\.16\.(?:3|4|6|7|8|9|10)'\)/,
  'candidate provenance must validate the composed candidate version itself');
assert.doesNotMatch(source, /if \(version !== '1\.16\.1'\)/,
  'stale v1.16.1 provenance gate must not survive v1.16.3 composition');
assert.match(source, /FULL_UAT_UI_PREFLIGHT_V1[\s\S]{0,700}?E\.assertWritableMatrixDraft\(preflightBridge\);[\s\S]{0,300}?E\.assertNativeEditMode\(\);/,
  'UI must reject read-only/non-draft state before confirmation and before any live UAT work');
assert.match(source, /INCOMPLETE · PRECHECK\\n[\s\S]{0,250}?Никаких изменений в TESSA не выполнялось\./,
  'UI precheck must tell the user that no TESSA mutation occurred');

console.log('v1.16.3 Full UAT preflight/recovery regression: PASS');
