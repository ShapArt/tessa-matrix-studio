import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.example.test', href: 'https://tessa.example.test/matrix' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');
assert.match(source, /FULL_UAT_VERSION_PROVENANCE_V1/, 'version provenance marker missing');
assert.doesNotMatch(source, /format: 'TESSA_FULL_UAT_V1', studioVersion: '1\.14\.0'/, 'Full UAT must not hardcode the old Studio version');

vm.runInThisContext(source);
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert.equal(typeof E.studioVersion, 'function', 'runtime Studio version getter must be exported');

const metadata = source.match(/^\/\/ @version\s+([^\s]+)$/m)?.[1];
assert.ok(metadata, 'userscript metadata version missing');
assert.equal(E.studioVersion(), metadata, 'Full UAT runtime version must match userscript metadata version');
assert.match(source, /studioVersion: String\(E\.studioVersion\?\.\(\) \|\| 'unknown'\)/, 'Full UAT report must read the runtime Studio version');

console.log(`TESSA Matrix Studio Full UAT version provenance: OK (${metadata})`);
