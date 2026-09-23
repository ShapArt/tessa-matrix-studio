import fs from 'node:fs';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url).pathname;
const source = fs.readFileSync(sourcePath, 'utf8');

// Live Full UAT seed 2589527719:
// V10 merged getRequestParams() context into the collection passed to the mounted
// setupPagingParameters(). In this Cherkizovo runtime that produced "e is not iterable"
// before a request could be built. Paging and business context are separate concerns:
// generate/validate paging against the native request collection, then merge MatrixID.
assert.match(source, /SERVER_PAGED_NATIVE_VIEW_V(?:11|12|13)/);
assert.match(source, /TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V(?:11|12|13)/);
assert.match(source, /TMS_V1_16_10_PAGING_V11_ISOLATED_PAGING_CONTEXT/);

const createStart = source.indexOf("owner === target ? 'target-createDataRequest-v5'");
const createEnd = source.indexOf('// Mounted control helper', createStart);
assert.ok(createStart >= 0 && createEnd > createStart, 'createDataRequest builder must exist');
const createBlock = source.slice(createStart, createEnd);
const setupAt = createBlock.indexOf('setupPagingParameters(candidate)');
const mergeAt = createBlock.indexOf('mergeContextParameters(baseContextParameters, pagingParameters)');
assert.ok(setupAt >= 0, 'native paging setup must remain');
assert.ok(mergeAt > setupAt, 'context must be merged only after paging setup');
assert.match(createBlock, /let pagingParameters = withoutPaging\(nativeContextParameters\)/);
assert.doesNotMatch(createBlock, /withoutPaging\(mergeContextParameters\(baseContextParameters, nativeContextParameters\)\)/);
assert.match(createBlock, /requiredContextPresent\(parameters\)/);

const fallbackStart = source.indexOf("owner === target ? 'target-setupPagingParameters-array'");
const fallbackEnd = source.indexOf('// Official Provide* fallback', fallbackStart);
assert.ok(fallbackStart >= 0 && fallbackEnd > fallbackStart, 'setupPagingParameters fallback must exist');
const fallbackBlock = source.slice(fallbackStart, fallbackEnd);
assert.match(fallbackBlock, /const pagingParameters = \[\];/);
assert.match(fallbackBlock, /setupPagingParameters\(pagingParameters\)/);
assert.match(fallbackBlock, /mergeContextParameters\(baseContextParameters, pagingParameters\)/);
assert.doesNotMatch(fallbackBlock, /setupPagingParameters\(parameters\)/);

console.log('v1.16.10 isolated paging/context regression: PASS');
