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

// Full UAT asks once for explicit consent before real temporary writes. Its internal
// operations must not repeat ordinary Apply confirmation dialogs or native main-card Saves.
assert.match(source, /async function applyPlan\(plan, options = \{\}\)/,
  'Apply must support scoped options for pre-approved UAT writes');
assert.match(source, /const confirmApply = typeof options\.confirm === 'function'/,
  'Apply must preserve normal UI confirmation while allowing a scoped UAT confirmer');
assert.match(source, /FULL_UAT_DEFER_MAIN_SAVE_V1/,
  'Apply must expose a scoped deferred native-Save policy for Full UAT');
assert.match(source, /reason:\s*'deferred-by-caller'/,
  'deferred main-card Save must be explicit in Apply accounting');
assert.match(source, /E\.applyPlan\(plan, \{ confirm: \(\) => true, source: 'full-uat', deferMainMatrixSave: true, runtimeBridge: bridge, runtimeStructure: structure \}\)/,
  'Full UAT must auto-confirm internal Apply, defer native Save, and pin the fresh runtime context');
assert.match(source, /FULL_UAT_RUNTIME_CONTEXT_V1/,
  'Full UAT composed artifact must mark the scoped fresh runtime context path');
assert.match(source, /preflightPlan\(plan, \{ bridge: options\.runtimeBridge \|\| undefined, structure: options\.runtimeStructure \|\| undefined \}\)/,
  'Full UAT scoped runtime context must be forwarded into production preflight');
assert.match(source, /FULL_UAT_SINGLE_MAIN_SAVE_V1/,
  'Full UAT must perform one final native Save after write/cleanup work');
assert.match(source, /report\.writesCompleted\s*>\s*0[\s\S]{0,900}saveMainMatrixAfterApply\(\)/,
  'the final native Save must happen only when at least one UAT mutation was accepted');

// Snapshot rows are intentionally DTO-only. Field diagnostics must hydrate a native Card
// on demand instead of expecting row.card to exist in the snapshot.
assert.match(source, /const diagnosticNativeCardCache = new Map\(\)/,
  'field diagnostics must cache native cards loaded on demand');
assert.match(source, /await bridge\.getCard\(row\.rowCardId\)/,
  'field diagnostics must hydrate the native card by RowCardID');
assert.doesNotMatch(source, /if \(!controlRow\.card\?\.clone\) return \{ status: 'not-run', detail: 'Карточка для проверки перестройки недоступна\.'/,
  'field diagnostics must not mark every field NOT RUN merely because snapshot DTOs contain no Card object');

// Schema refresh must use a locally-defined semantic change scorer. Full UAT accepts an
// operation only when exactly one mutation was actually applied with no skipped/failed or
// unstarted work; the runner then owns the authoritative fresh read-back and cleanup proof.
assert.match(source, /MERGE_COPY_IDENTITY_SCORING_V1/,
  'merge-with-current must define copied-identity change scoring in its own scope');
assert.match(source, /FULL_UAT_STRICT_APPLY_RESULT_V1/,
  'Full UAT must keep explicit write-accounting validation');
assert.match(source, /FULL_UAT_ACCEPTED_WRITE_RESULT_V2/,
  'Full UAT must distinguish accepted writes from nested post-write verification status');
assert.doesNotMatch(source, /result\.success\s*!==\s*true\s*\|\|\s*result\.status\s*!==\s*'completed'/,
  'Full UAT must not fail an accepted mutation solely because ordinary Apply post-write verification is partial');
assert.match(source, /FULL_UAT_CLEAR_SCENARIO_DETERMINISTIC_V2/,
  'Full UAT must deterministically prove SET -> CLEAR -> read-back -> cleanup on its temporary row');
assert.doesNotMatch(source, /FULL_UAT_CLEAR_NOT_RUN_CLEANUP_V1/,
  'the clear-field scenario must no longer rely on a data-shape NOT_RUN escape hatch');
assert.doesNotMatch(source, /candidateIndexes = directTokenIndexes\(book\)[\s\S]{0,900}\(book\.rows \|\| \[\]\)\.some\(/,
  'the clear-field scenario must not infer optionality from whether another production row is blank');
assert.match(source, /write-clear-delete[\s\S]{0,14000}SET[\s\S]{0,14000}CLEAR[\s\S]{0,14000}cleanup/i,
  'the live clear-field check must execute the complete SET -> CLEAR -> cleanup lifecycle');
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

console.log('Live UAT regressions: selective XLSX, scoped runtime context, single-consent/single-save writes, deterministic SET/CLEAR, native diagnostics and cleanup invariants: OK');
