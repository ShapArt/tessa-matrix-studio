import fs from 'node:fs';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url).pathname;
const source = fs.readFileSync(sourcePath, 'utf8');

// Live Full UAT seed 12305267:
// canonical V8 request reached DynamicMetadataViewInterceptor but lost required MatrixID.
// A direct request must therefore preserve every contextual parameter from the native
// createDataRequest object, including Web ViewRequest.values as well as Tessa parameters.
assert.match(source, /SERVER_PAGED_NATIVE_VIEW_V9/);
assert.match(source, /nativeRequest(?:\?|)\.?(?:parameters|Parameters)[\s\S]{0,180}(?:values|Values)/,
  'context adapter must cover both pre-4.1 values and 4.1+ parameters contracts');
assert.match(source, /(?:request\.values\s*=|mergeContextParameters)/,
  'V9 context-preservation semantics must survive later adapters');
assert.match(source, /contextParameterNames/);
assert.match(source, /MatrixID/i);
assert.match(source, /TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V(?:9|10)/);
assert.match(source, /TMS_V1_16_8_PAGING_V9_CONTEXT_PRESERVATION/);

console.log('v1.16.8 direct request context preservation contract: PASS');
