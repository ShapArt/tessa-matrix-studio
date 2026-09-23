import fs from 'node:fs';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url).pathname;
const source = fs.readFileSync(sourcePath, 'utf8');

// Live seed 1369359921 reproduced V11's "e is not iterable" in BOTH mounted
// createDataRequest and setupPagingParameters. V12 must have a first-class builder
// that does not invoke either private delegate and instead creates TESSA's documented
// PageOffset/PageLimit special parameters through ViewRequest.addParameter().
assert.match(source, /SERVER_PAGED_NATIVE_VIEW_V12/);
assert.match(source, /TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V12/);
assert.match(source, /TMS_V1_16_11_PAGING_V12_MANUAL_SPECIAL_PARAMS/);

const start = source.indexOf("name: 'manual-special-parameters-v12'");
const end = source.indexOf("name: 'paging-parameter-factory'", start);
assert.ok(start >= 0 && end > start, 'manual V12 builder must run before legacy paging builders');
const block = source.slice(start, end);
assert.match(block, /withoutPaging\(await getBaseParameters\(\)\)/);
assert.match(block, /ViewCriteriaOperators/);
assert.match(block, /EqualsTo/);
assert.match(block, /wireLimit = pageLimit \+ 1/);
assert.match(block, /wireOffset = 1 \+ \(\(page - 1\) \* pageLimit\)/);
assert.match(block, /addIntParameter\('PageLimit', wireLimit\)/);
assert.match(block, /addIntParameter\('PageOffset', wireOffset\)/);
assert.match(block, /request\.addParameter/);
assert.match(block, /requiredContextPresent\(parameters\)/);
assert.doesNotMatch(block, /createDataRequest\(/);
assert.doesNotMatch(block, /setupPagingParameters\(/);

console.log('v1.16.11 manual special paging regression: PASS');
