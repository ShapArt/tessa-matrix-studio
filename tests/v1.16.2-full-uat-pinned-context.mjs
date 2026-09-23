import fs from 'node:fs';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url).pathname;
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(source, /FULL_UAT_PINNED_CONTEXT_RECOVERY_V1/,
  'Full UAT must pin its authoritative runtime context for recovery/read-back');
assert.match(source, /let pinnedUatBridge = null;/,
  'Full UAT must keep a pinned bridge');
assert.match(source, /pinnedUatBridge = bridge;/,
  'Full UAT must pin the initial validated bridge');
assert.match(source, /const freshBridge = pinnedUatBridge \|\| await E\.TessaBridge\.create\(\);/,
  'freshSnapshot must prefer the pinned bridge instead of rediscovering mutable UI context');
assert.match(source, /async function assertActiveUatContextBeforeWrite\(\)/,
  'destructive writes still need an active-context guard');
assert.match(source, /await assertActiveUatContextBeforeWrite\(\);[\s\S]{0,600}?report\.writesAttempted \+= 1;/,
  'context guard must run immediately before write accounting/mutation');

assert.match(source, /const noWriteAbort = Boolean\(report\.fatalError\) && report\.writesAttempted === 0;/,
  'pre-write abort must be recognized explicitly');
assert.match(source, /'action-apply'[\s\S]{0,1800}?noWriteAbort \? 'NOT_RUN' :/,
  'Apply must be NOT_RUN rather than FAIL when UAT aborts before any mutation');
assert.match(source, /'action-reconcile'[\s\S]{0,2200}?noWriteAbort[\s\S]{0,900}?'NOT_RUN'/,
  'Reconcile must be NOT_RUN rather than fake-fail without any mutation receipt');
assert.match(source, /fatalError: report\.fatalError \|\| null/,
  'compact failure evidence must include the primary fatalError');

console.log('v1.16.2 Full UAT pinned-context recovery regression: PASS');
