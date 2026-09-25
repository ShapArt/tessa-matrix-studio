import fs from 'node:fs';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url).pathname;
const source = fs.readFileSync(sourcePath, 'utf8');

// Live seed 2589527719 established that contextual getRequestParams data must never
// be fed into mounted setupPagingParameters before paging is valid. V13 supersedes
// that delegate on the live path entirely, but the compatibility fallback still has
// to retain the V11 isolation rule.
assert.match(source, /SERVER_PAGED_NATIVE_VIEW_V(?:11|12|13)/);
assert.match(source, /TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V(?:11|12|13)/);
assert.match(source, /TMS_V1_16_10_PAGING_V11_ISOLATED_PAGING_CONTEXT/);

const fallbackStart = source.indexOf("owner === target ? 'target-setupPagingParameters-array'");
const fallbackEnd = source.indexOf('// Official Provide* fallback', fallbackStart);
assert.ok(fallbackStart >= 0 && fallbackEnd > fallbackStart, 'setupPagingParameters compatibility fallback must exist');
const fallbackBlock = source.slice(fallbackStart, fallbackEnd);
assert.match(fallbackBlock, /const pagingParameters = \[\];/);
assert.match(fallbackBlock, /setupPagingParameters\(pagingParameters\)/);
assert.match(fallbackBlock, /mergeContextParameters\(baseContextParameters, pagingParameters\)/);
assert.doesNotMatch(fallbackBlock, /setupPagingParameters\(parameters\)/);

if (source.includes('SERVER_PAGED_NATIVE_VIEW_V13')) {
  const start = source.indexOf("owner === target ? 'target-self-contained-v13'");
  const end = source.indexOf('// Mounted control helper', start);
  assert.ok(start >= 0 && end > start, 'V13 self-contained builder must exist');
  const block = source.slice(start, end);
  const liveStart = block.indexOf('const manualRequest = new api.serviceModule.TessaViewRequest');
  const liveEnd = block.indexOf('return { request: manualRequest');
  assert.ok(liveStart >= 0 && liveEnd > liveStart, 'V13 live request path must exist');
  const livePath = block.slice(liveStart, liveEnd);
  assert.doesNotMatch(livePath, /getRequestParams\(/);
  assert.doesNotMatch(livePath, /setupPagingParameters\(/);
  assert.doesNotMatch(livePath, /mergeContextParameters\(/);
  assert.match(livePath, /addParameter\('MatrixID', matrixId\)/);
} else {
  const createStart = source.indexOf("owner === target ? 'target-createDataRequest-v5'");
  const createEnd = source.indexOf('// Mounted control helper', createStart);
  assert.ok(createStart >= 0 && createEnd > createStart, 'createDataRequest builder must exist');
  const createBlock = source.slice(createStart, createEnd);
  const setupAt = createBlock.indexOf('setupPagingParameters(candidate)');
  const mergeAt = createBlock.indexOf('mergeContextParameters(baseContextParameters, pagingParameters)');
  assert.ok(setupAt >= 0, 'native paging setup must remain');
  assert.ok(mergeAt > setupAt, 'context must be merged only after paging setup');
  assert.match(createBlock, /let pagingParameters = withoutPaging\(nativeContextParameters\)/);
}

console.log('v1.16.10 isolated paging/context regression: PASS');