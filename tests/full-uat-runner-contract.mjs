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

vm.runInThisContext(fs.readFileSync(process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const U = globalThis.__TMS_FULL_UAT_V1__;
assert.ok(U, 'Full UAT runner must be installed');
assert.equal(typeof U.runFullUat, 'function');
assert.equal(typeof U.installUi, 'function');
assert.equal(typeof E.makeZip, 'function', 'Full UAT must reuse the audited ZIP writer');
const a = U.seededRandom(0x12345678), b = U.seededRandom(0x12345678);
for (let i = 0; i < 20; i += 1) assert.equal(a(), b(), 'same seed must reproduce candidate choices');
const sigA = U.snapshotSignature({ rows: [{ rowCardId: 'b', fingerprint: '2' }, { rowCardId: 'a', fingerprint: '1' }] });
const sigB = U.snapshotSignature({ rows: [{ rowCardId: 'a', fingerprint: '1' }, { rowCardId: 'b', fingerprint: '2' }] });
assert.deepEqual(sigA, sigB, 'cleanup signature must ignore row ordering');
assert.equal(U.installUi(), undefined, 'test mode must never inject or click live UI');
console.log('TESSA Matrix Studio Full UAT runner contract: OK');
