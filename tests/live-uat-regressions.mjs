import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');

// Task13 replaced the old "raise the single-entry ceiling until Словари fits" workaround
// with selective inflate. Ordinary XLSX parsing keeps the strict per-entry guard, while a
// caller that replaces «Словари» from live TESSA explicitly skips that worksheet before
// validation/decompression. The total archive and compression-ratio protections stay bounded.
assert.match(source, /MaxEntryUncompressedBytes:\s*128\s*\*\s*1024\s*\*\s*1024/,
  'ordinary XLSX reader must retain the canonical 128 MiB per-entry resource guard');
assert.match(source, /MaxTotalUncompressedBytes:\s*512\s*\*\s*1024\s*\*\s*1024/,
  'total XLSX uncompressed ceiling must remain bounded');
assert.match(source, /MaxCompressionRatio:\s*100/,
  'ZIP compression-ratio protection must remain enabled');
assert.match(source, /skipSheetNames:\s*\['Словари'\][\s\S]{0,300}selectiveInflate:\s*true/,
  'live-catalog workbook reads must skip the disposable dictionary XML before inflate');

// Full UAT already asks for one explicit confirmation before real temporary writes.
// Nested Apply confirmations made live temporary write scenarios nondeterministic.
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

// Schema refresh must use a locally-defined semantic change scorer. Full UAT accepts only
// a complete single mutation, and every temporary ADD is bound to the exact receipt ID in
// the Task9 cleanup ledger before post-write read-back begins.
assert.match(source, /MERGE_COPY_IDENTITY_SCORING_V1/,
  'merge-with-current must define copied-identity change scoring in its own scope');
assert.match(source, /FULL_UAT_STRICT_APPLY_RESULT_V1/,
  'Full UAT must reject partial, skipped or incomplete Apply results');
assert.match(source, /FULL_UAT_CLEAR_NOT_RUN_CLEANUP_V1/,
  'Full UAT must cleanup a temporary row before returning NOT_RUN from clear-field scenario');
assert.match(source, /FULL_UAT_ADD_RECEIPT_RECOVERY_V2/,
  'Full UAT must bind the Task9 cleanup obligation to the exact ADD receipt before read-back');
assert.match(source, /Number\(result\.appliedCount \|\| 0\) !== 1/,
  'Full UAT write helper must require exactly one applied mutation');
assert.match(source, /cleanupCreatedRow\(receiptRowCardId, `\$\{scenarioId\}-add-readback-recovery`\)/,
  'post-ADD read-back failure must cleanup by the exact stored RowCardID from the Apply receipt');

// Load the composed candidate too: this catches syntax/runtime export regressions in the
// same file that the browser will execute.
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

console.log('Live UAT regressions: selective XLSX, pre-approved writes, native diagnostics and cleanup invariants: OK');
