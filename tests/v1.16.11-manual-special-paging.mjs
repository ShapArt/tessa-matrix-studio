import fs from 'node:fs';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url).pathname;
const source = fs.readFileSync(sourcePath, 'utf8');

// Live seed 1369359921 proved both mounted paging delegates could throw
// "e is not iterable". V12 introduced manual special parameters; V13 hardens the
// same architecture by removing the remaining getBaseParameters precondition.
assert.match(source, /SERVER_PAGED_NATIVE_VIEW_V(?:12|13)/);
assert.match(source, /TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V(?:12|13)/);
assert.match(source, /TMS_V1_16_11_PAGING_V12_MANUAL_SPECIAL_PARAMS/);

const isV13 = source.includes('SERVER_PAGED_NATIVE_VIEW_V13');
const start = source.indexOf(isV13 ? "owner === target ? 'target-self-contained-v13'" : "owner === target ? 'target-createDataRequest-v5'");
const end = source.indexOf('// Mounted control helper', start);
assert.ok(start >= 0 && end > start, 'manual direct paging builder must exist');
const block = source.slice(start, end);

if (isV13) {
  const manualAt = block.indexOf('const manualRequest = new api.serviceModule.TessaViewRequest');
  const mountedAt = block.indexOf('owner.createDataRequest()');
  assert.ok(manualAt >= 0, 'self-contained manual special-parameter path must exist');
  assert.ok(mountedAt > manualAt, 'self-contained path must precede broken mounted delegate');
  assert.match(block, /ViewCriteriaOperators/);
  assert.match(block, /wireLimit = pageLimit \+ 1/);
  assert.match(block, /wireOffset = 1 \+ \(\(page - 1\) \* pageLimit\)/);
  assert.match(block, /addParameter\('MatrixID', matrixId\)/);
  assert.match(block, /addParameter\('PageLimit', wireLimit\)/);
  assert.match(block, /addParameter\('PageOffset', wireOffset\)/);
  assert.match(block, /requiredContextPresent\(manualParameters\)/);
  assert.match(block, /isPagingUsableForPage\(manualParameters, page, lastAcceptedOffset\)/);
  assert.match(block, /return \{ request: manualRequest, parameters: manualParameters/);
  const livePath = block.slice(manualAt, block.indexOf('return { request: manualRequest'));
  assert.doesNotMatch(livePath, /getBaseParameters\(/);
} else {
  const manualAt = block.indexOf('const manualRequest = requestWithParameters');
  const mountedAt = block.indexOf('owner.createDataRequest()');
  assert.ok(manualAt >= 0 && mountedAt > manualAt, 'V12 manual path must precede mounted delegate');
  assert.match(block, /addIntParameter\('PageLimit', wireLimit\)/);
  assert.match(block, /addIntParameter\('PageOffset', wireOffset\)/);
}

console.log('v1.16.11 manual special paging regression: PASS');