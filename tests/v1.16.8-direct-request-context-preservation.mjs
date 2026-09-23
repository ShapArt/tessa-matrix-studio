import fs from 'node:fs';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url).pathname;
const source = fs.readFileSync(sourcePath, 'utf8');

// Live Full UAT seed 12305267:
// canonical V8 request reached DynamicMetadataViewInterceptor but lost required MatrixID.
// A direct request must therefore preserve every contextual parameter from the native
// createDataRequest object, including Web ViewRequest.values as well as Tessa parameters.
assert.match(source, /SERVER_PAGED_NATIVE_VIEW_V9/);
assert.match(source, /nativeContextValues/);
assert.match(source, /nativeRequest\?\.values\s*\?\?\s*nativeRequest\?\.Values/);
assert.match(source, /request\.values\s*=\s*nativeContextValues/);
assert.match(source, /contextParameterNames/);
assert.match(source, /MatrixID/i);
assert.match(source, /TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V9/);
assert.match(source, /TMS_V1_16_8_PAGING_V9_CONTEXT_PRESERVATION/);

console.log('v1.16.8 direct request context preservation contract: PASS');
