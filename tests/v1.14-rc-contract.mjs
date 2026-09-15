import fs from 'node:fs';
import assert from 'node:assert/strict';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const changelog = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const communicationPath = new URL('../docs/communications/v1.14-colleague-test-message.md', import.meta.url);
const fullUatFinalizer = fs.readFileSync(new URL('../hotfixes/v1.13.0-full-uat-live-finalize.mjs', import.meta.url), 'utf8');
const inlineFailureUxPath = new URL('../hotfixes/v1.14-full-uat-inline-failures.mjs', import.meta.url);

assert.equal(pkg.version, '1.14.0', 'package candidate version must be 1.14.0');
assert.match(source, /^\/\/ @version\s+1\.14\.0$/m, 'userscript metadata version must be 1.14.0');
assert.match(source, /version:\s*'1\.14\.0'/, 'runtime version must be 1.14.0');

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

assert.match(readme, /version-1\.14\.0/);
assert.match(readme, /\*\*v1\.14\.0/);
assert.ok(readme.includes('docs/assets/studio-panel.webp'), 'real README screenshot must be preserved');
assert.ok(readme.includes('Скачать изменения в Excel'), 'README should mention reviewed-changes export');

console.log('TESSA Matrix Studio v1.14 RC documentation/version/final-proof contract: OK');
