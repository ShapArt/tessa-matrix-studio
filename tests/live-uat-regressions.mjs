import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');

// Live UAT 2026-09-11: the refreshed dictionary worksheet was 139,568,463 bytes
// uncompressed. It was created by Studio itself and must fit under the bounded per-entry
// ceiling without disabling the total-size and compression-ratio protections.
assert.match(source, /MaxEntryUncompressedBytes:\s*192\s*\*\s*1024\s*\*\s*1024/,
  'self-generated dictionary worksheet above 128 MiB must be accepted by the bounded XLSX policy');
assert.match(source, /MaxTotalUncompressedBytes:\s*256\s*\*\s*1024\s*\*\s*1024/,
  'total XLSX uncompressed ceiling must remain bounded');
assert.match(source, /MaxCompressionRatio:\s*100/,
  'ZIP compression-ratio protection must remain enabled');

// Full UAT already asks for one explicit confirmation before real temporary writes.
// Nested Apply confirmations made the first two live write scenarios return null.
assert.match(source, /async function applyPlan\(plan, options = \{\}\)/,
  'Apply must support an injected confirmation policy for pre-approved UAT writes');
assert.match(source, /const confirmApply = typeof options\.confirm === 'function'/,
  'Apply must preserve normal UI confirmation while allowing a scoped UAT confirmer');
assert.match(source, /E\.applyPlan\(plan, \{ confirm: \(\) => true, source: 'full-uat' \}\)/,
  'Full UAT must not ask a second confirmation for every temporary mutation');

// Snapshot rows are intentionally DTO-only. Field diagnostics must hydrate a native Card
// on demand instead of expecting row.card to exist in the snapshot.
assert.match(source, /const diagnosticNativeCardCache = new Map\(\)/,
  'field diagnostics must cache native cards loaded on demand');
assert.match(source, /await bridge\.getCard\(row\.rowCardId\)/,
  'field diagnostics must hydrate the native card by RowCardID');
assert.doesNotMatch(source, /if \(!controlRow\.card\?\.clone\) return \{ status: 'not-run', detail: 'Карточка для проверки перестройки недоступна\.'/,
  'field diagnostics must not mark every field NOT RUN merely because snapshot DTOs contain no Card object');

// Load the candidate too: this catches syntax/runtime export regressions in the same file
// that the browser will execute.
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.example.test', href: 'https://tessa.example.test/matrix' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(source);
assert.ok(globalThis.__TESSA_MATRIX_SYNC_EXPORTS__?.applyPlan);
assert.ok(globalThis.__TMS_FULL_UAT_V1__?.runFullUat);

console.log('Live UAT regressions: archive ceiling, pre-approved writes and native field diagnostics: OK');
