import fs from 'node:fs';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url).pathname;
const source = fs.readFileSync(sourcePath, 'utf8');

// Live seed 2991209272: V12 still reported "e is not iterable" before it could
// emit any manual strategy. The remaining precondition was getBaseParameters()
// (mounted getRequestParams). V13 must construct MatrixID/PageLimit/PageOffset
// exclusively from the open matrix card + public ViewRequest.addParameter API.
assert.match(source, /SERVER_PAGED_NATIVE_VIEW_V13/);
assert.match(source, /TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V13/);
assert.match(source, /TMS_V1_16_12_PAGING_V13_SELF_CONTAINED_REQUEST/);
assert.match(source, /target-self-contained-v13/);

const start = source.indexOf("owner === target ? 'target-self-contained-v13'");
const end = source.indexOf('// Mounted control helper', start);
assert.ok(start >= 0 && end > start, 'V13 builder must exist');
const block = source.slice(start, end);
const manualStart = block.indexOf('const manualRequest = new api.serviceModule.TessaViewRequest');
const returnAt = block.indexOf('return { request: manualRequest');
assert.ok(manualStart >= 0 && returnAt > manualStart, 'self-contained request must return before compatibility code');
const livePath = block.slice(manualStart, returnAt);
assert.match(livePath, /this\.mainCard\?\.id/);
assert.match(livePath, /addParameter\('MatrixID', matrixId\)/);
assert.match(livePath, /addParameter\('PageLimit', wireLimit\)/);
assert.match(livePath, /addParameter\('PageOffset', wireOffset\)/);
assert.match(livePath, /ViewCriteriaOperators/);
assert.match(livePath, /EqualsTo/);
assert.doesNotMatch(livePath, /getBaseParameters\(/);
assert.doesNotMatch(livePath, /getRequestParams\(/);
assert.doesNotMatch(livePath, /createDataRequest\(/);
assert.doesNotMatch(livePath, /setupPagingParameters\(/);
assert.match(livePath, /requiredContextPresent\(manualParameters\)/);
assert.match(livePath, /isPagingUsableForPage\(manualParameters, page, lastAcceptedOffset\)/);

console.log('v1.16.12 self-contained direct paging regression: PASS');
