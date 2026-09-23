import fs from 'node:fs';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url).pathname;
const source = fs.readFileSync(sourcePath, 'utf8');

// Live seed 1369359921 reproduced "e is not iterable" in BOTH mounted paging delegates.
// V12 must build PageOffset/PageLimit before owner.createDataRequest() can execute.
assert.match(source, /SERVER_PAGED_NATIVE_VIEW_V12/);
assert.match(source, /TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V12/);
assert.match(source, /TMS_V1_16_11_PAGING_V12_MANUAL_SPECIAL_PARAMS/);

const start = source.indexOf("owner === target ? 'target-createDataRequest-v5'");
const end = source.indexOf('// Mounted control helper', start);
assert.ok(start >= 0 && end > start, 'createDataRequest builder must exist');
const block = source.slice(start, end);
const manualAt = block.indexOf("const manualRequest = requestWithParameters");
const mountedAt = block.indexOf("owner.createDataRequest()");
assert.ok(manualAt >= 0, 'manual special-parameter path must exist');
assert.ok(mountedAt > manualAt, 'manual path must precede broken mounted delegate');
assert.match(block, /ViewCriteriaOperators/);
assert.match(block, /wireLimit = pageLimit \+ 1/);
assert.match(block, /wireOffset = 1 \+ \(\(page - 1\) \* pageLimit\)/);
assert.match(block, /addIntParameter\('PageLimit', wireLimit\)/);
assert.match(block, /addIntParameter\('PageOffset', wireOffset\)/);
assert.match(block, /manualRequest\.addParameter/);
assert.match(block, /requiredContextPresent\(manualParameters\)/);
assert.match(block, /isPagingUsableForPage\(manualParameters, page, lastAcceptedOffset\)/);
assert.match(block, /return \{ request: manualRequest, parameters: manualParameters/);

console.log('v1.16.11 manual special paging regression: PASS');
