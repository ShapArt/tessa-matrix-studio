import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { applyMalformedRangeDiagnosticTransform } from '../hotfixes/malformed-range-diagnostic-transform.mjs';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.example.test' };
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };

const baseSource = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const source = applyMalformedRangeDiagnosticTransform(baseSource);
vm.runInThisContext(source, { filename: 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

for (const input of ['2 - 3', '2-3', '2 – 3', '2 — 3', '2..3', '2 до 3']) {
  assert.deepEqual(E.parseRange(input, 'Int'), { kind: 'Int', value: 2, to: 3 }, `valid range must stay accepted: ${input}`);
}

let message = '';
try {
  E.parseRange('1 - 2 - 3', 'Int');
  assert.fail('malformed triple range must be rejected');
} catch (error) {
  message = String(error?.message || error);
}
assert.match(message, /1\s*-\s*2\s*-\s*3/, `error must identify the full malformed cell value, got: ${message}`);
assert.doesNotMatch(message, /«2\s*-\s*3»/, `error must not make the valid tail range look broken, got: ${message}`);

console.log('TESSA malformed numeric range diagnostic regression: OK');
