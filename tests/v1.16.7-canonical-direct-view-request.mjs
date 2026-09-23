import fs from 'node:fs';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url).pathname;
const source = fs.readFileSync(sourcePath, 'utf8');

// Live Full UAT seed 3680395665:
// page 1 and page 2 carried correct PageOffset/PageLimit, but component.getViewData
// returned the exact same first-page MatrixVersionID sequence. The mounted UI helper
// therefore does not honor an explicit direct request in this runtime.
assert.match(source, /SERVER_PAGED_NATIVE_VIEW_V8/,
  'candidate must contain the V8 canonical direct-request adapter');
assert.match(source, /const nativeRequest = await Promise\.resolve\(owner\.createDataRequest\(\)\)/,
  'native createDataRequest must be treated as a contextual-parameter source');
assert.match(source, /request:\s*requestWithParameters\(parameters, page(?:, nativeContextValues)?\)/,
  'contextual parameters must be copied into a canonical TessaViewRequest');
assert.match(source, /nativeRequestType:/,
  'canonical request diagnostics must preserve native request type');
assert.doesNotMatch(source, /\{ name: 'component\.getViewData'/,
  'component.getViewData must not be treated as a direct explicit-request executor');
assert.doesNotMatch(source, /\{ name: 'target\.getViewData'/,
  'target.getViewData must not be treated as a direct explicit-request executor');
assert.match(source, /\{ name: 'view\.getData', owner: view, fn: view\?\.getData \}/,
  'the documented view.getData(request) path must remain primary');
assert.match(source, /\{ name: 'service\.getData', owner: api\.service, fn: api\.service\?\.getData \}/,
  'a direct ViewService.getData(request) compatibility path must be available');
assert.match(source, /directExecutorErrors/,
  'direct API errors must survive into diagnostics');
assert.match(source, /TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V8/,
  'candidate must emit V8 paging diagnostics');
assert.match(source, /TMS_V1_16_7_PAGING_V8_CANONICAL_REQUEST/,
  'candidate must expose the exact V8 build fingerprint');

console.log('v1.16.7 canonical direct view request architecture: PASS');
