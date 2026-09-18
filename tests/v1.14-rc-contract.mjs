import fs from 'node:fs';
import assert from 'node:assert/strict';
import './live-uat-final-four-regressions.mjs';
import './live-uat-release-composition.mjs';
import './live-colleague-excel-regressions.mjs';

// v1.14.1 exact-parent parity is immutable historical release evidence. Re-running that
// test against an intentionally changed v1.14.2 core would require the working tree to
// hash to the old public v1.14.0 parent and would block every legitimate future fix.
// Keep the evidence file present and pinned; current candidates get their own gates.
const historicalParityPath = new URL('./v1.14.1-report-only-release-parity.mjs', import.meta.url);
assert.ok(fs.existsSync(historicalParityPath), 'historical v1.14.1 parity evidence must remain in the repository');
const historicalParity = fs.readFileSync(historicalParityPath, 'utf8');
assert.match(historicalParity, /811a3e7251cc0f89f632814b3ac49d5feb1e280670f34f31c6a631b22d960eff/,
  'historical v1.14.1 parity evidence must stay pinned to the public v1.14.0 parent');
assert.match(historicalParity, /assertReleaseNativeEvidence/,
  'historical v1.14.1 parity evidence must retain the release-native-evidence gate');

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const changelog = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const communicationPath = new URL('../docs/communications/v1.14-colleague-test-message.md', import.meta.url);
const fullUatFinalizer = fs.readFileSync(new URL('../hotfixes/v1.13.0-full-uat-live-finalize.mjs', import.meta.url), 'utf8');
const inlineFailureUxPath = new URL('../hotfixes/v1.14-full-uat-inline-failures.mjs', import.meta.url);
const finalFourPath = new URL('../hotfixes/v1.14-live-uat-final-four.mjs', import.meta.url);

assert.equal(pkg.version, '1.14.2', 'package candidate version must be 1.14.2');
// The checked-in userscript remains the verified v1.14.0 baseline. Release composition bumps
// metadata/runtime version only after applying the ordered release transforms through v1.14.2.
assert.match(source, /^\/\/ @version\s+1\.14\.0$/m, 'canonical userscript baseline must remain 1.14.0');
assert.match(source, /version:\s*'1\.14\.0'/, 'canonical runtime baseline must remain 1.14.0');

assert.match(source, /__TMS_FULL_UAT_V1__/, 'canonical userscript must ship the Full UAT runner');
assert.match(source, /Запустить полный UAT/, 'canonical userscript must expose the Full UAT action');
assert.match(source, /runFullUat/, 'canonical userscript must contain the Full UAT implementation');

// Regression for the live 29 PASS / 4 FAIL run. The single final native Save must still
// be inside the native recorder window, and the verdict must be finalized only after
// cleanup + Save + final baseline proof. A failed run must also expose its failing check
// IDs/details directly to the tester instead of requiring manual ZIP archaeology.
assert.match(fullUatFinalizer, /FULL_UAT_RECORDER_THROUGH_FINAL_SAVE_V2/,
  'Full UAT finalizer must keep the recorder active through the sole final native Save');
assert.match(fullUatFinalizer, /FULL_UAT_FINAL_VERDICT_AFTER_SAVE_V2/,
  'Full UAT verdict must be finalized after cleanup, final Save and baseline proof');
assert.match(fullUatFinalizer, /FULL_UAT_FAILURE_SUMMARY_V1/,
  'Full UAT must surface failing check IDs/details in the immediate result');
assert.match(fullUatFinalizer, /native-write-trace\.json/,
  'finalizer must package native write evidence after the final Save');

// Live rerun on seed 1346937433 still produced the same 29 PASS / 4 FAIL while the
// ChatGPT runtime could not unpack the package. The UAT UI must therefore show the exact
// failed check IDs/details and download a tiny standalone text file in addition to the ZIP.
assert.ok(fs.existsSync(inlineFailureUxPath),
  'Full UAT must ship the inline failure UX transform');
const inlineFailureUx = fs.readFileSync(inlineFailureUxPath, 'utf8');
assert.match(inlineFailureUx, /FULL_UAT_INLINE_FAILURES_V1/,
  'inline failure UX transform must have a stable marker');
assert.match(inlineFailureUx, /result\.failedChecks/,
  'inline failure UX must consume failedChecks from the finalized report');
assert.match(inlineFailureUx, /TESSA_Full_UAT_FAILURES_/,
  'inline failure UX must download standalone failure evidence');
assert.match(inlineFailureUx, /FAIL DETAILS/,
  'inline failure UX must render explicit failure details in the panel');

assert.ok(fs.existsSync(finalFourPath), 'final-four live UAT transform must exist');
const finalFour = fs.readFileSync(finalFourPath, 'utf8');
assert.match(finalFour, /FULL_UAT_PICKER_SOURCE_V2/);
assert.match(finalFour, /REFRESH_DICTIONARY_DIRECT_XML_V2/);
assert.match(finalFour, /FULL_UAT_BOOLEAN_SEMANTIC_V2/);

// The three post-ADD write scenarios build UPDATE plans from a fresh bridge/snapshot.
// Apply/preflight must use that same runtime context, otherwise the temporary row can be
// checked against another context between plan construction and Store.
assert.match(fullUatFinalizer, /FULL_UAT_RUNTIME_CONTEXT_V1/,
  'Full UAT must pin Apply to the fresh runtime context used to build update plans');
assert.match(fullUatFinalizer, /runtimeBridge:\s*bridge/,
  'Full UAT internal Apply must forward the fresh bridge');
assert.match(fullUatFinalizer, /runtimeStructure:\s*structure/,
  'Full UAT internal Apply must forward the matching structure');
assert.match(fullUatFinalizer, /bridge:\s*options\.runtimeBridge\s*\|\|\s*undefined/,
  'scoped runtime bridge must be forwarded into production preflight');
assert.match(fullUatFinalizer, /structure:\s*options\.runtimeStructure\s*\|\|\s*undefined/,
  'scoped runtime structure must be forwarded into production preflight');

assert.match(changelog, /## 1\.14\.1 — 2026-09-15/);
assert.match(changelog, /## 1\.14\.0 — 2026-09-11/);
for (const token of ['session', 'touched', 'ФИО', 'Скачать изменения в Excel', 'Performance UAT']) {
  assert.ok(changelog.includes(token), `CHANGELOG must mention ${token}`);
}
assert.match(changelog, /synthetic/i, 'CHANGELOG must distinguish synthetic measurements');
assert.match(changelog, /live TESSA/i, 'CHANGELOG must state live TESSA is still required');

assert.ok(fs.existsSync(communicationPath), 'colleague UAT message must exist');
const communication = fs.readFileSync(communicationPath, 'utf8');
for (const token of ['0 изменений', 'ADD', 'UPDATE', 'DELETE', '3000', 'Скачать изменения в Excel', 'пакет диагностики']) {
  assert.ok(communication.includes(token), `colleague message must mention ${token}`);
}
assert.match(communication, /не.*подтвержден.*live TESSA/is, 'message must not claim live speedup before live UAT');
assert.match(communication, /1\.14\.0/);

assert.match(readme, /version-1\.14\.1/);
assert.match(readme, /\*\*v1\.14\.1/);
assert.ok(readme.includes('docs/assets/studio-start-v1.14.1.jpg'), 'current v1.14.1 Studio screenshot must be preserved');
assert.ok(readme.includes('docs/assets/changes-report-v1.14.1.jpg'), 'current v1.14.1 changes-report screenshot must be preserved');
assert.ok(readme.includes('Скачать изменения в Excel'), 'README should mention reviewed-changes export');

console.log('TESSA Matrix Studio v1.14.1 RC documentation/final-proof/inline-failures/runtime-context/final-four/report-only-release contract: OK');
