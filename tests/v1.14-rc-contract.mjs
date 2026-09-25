import fs from 'node:fs';
import assert from 'node:assert/strict';
import './live-uat-final-four-regressions.mjs';
import './live-uat-release-composition.mjs';
import './live-colleague-excel-regressions.mjs';

// Historical evidence stays immutable; the active release contract now validates the
// canonical v1.17 source and builder instead of replaying the v1.14 transform chain.
const historicalParityPath = new URL('./v1.14.1-report-only-release-parity.mjs', import.meta.url);
assert.ok(fs.existsSync(historicalParityPath));
assert.match(fs.readFileSync(historicalParityPath, 'utf8'), /811a3e7251cc0f89f632814b3ac49d5feb1e280670f34f31c6a631b22d960eff/);

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const fullUat = fs.readFileSync(new URL('../src/uat/full-uat.js', import.meta.url), 'utf8');
const changelog = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');

assert.equal(pkg.version, '1.17.1');
assert.match(source, /^\/\/ @version\s+1\.17\.1$/m);
assert.match(source, /version:\s*'1\.17\.1'/);
assert.match(source, /__TMS_FULL_UAT_V1__/);
assert.match(source, /TESSA_MATRIX_ROUNDTRIP_V7/);
assert.match(source, /TESSA_MATRIX_SUPPORT_BUNDLE_V1/);
for (const marker of [
  'FULL_UAT_RECORDER_THROUGH_FINAL_SAVE_V2',
  'FULL_UAT_FINAL_VERDICT_AFTER_SAVE_V2',
  'FULL_UAT_FAILURE_SUMMARY_V1',
  'FULL_UAT_INLINE_FAILURES_V1',
  'FULL_UAT_PICKER_SOURCE_V2',
  'REFRESH_DICTIONARY_DIRECT_XML_V2',
  'FULL_UAT_BOOLEAN_SEMANTIC_V2',
  'FULL_UAT_RUNTIME_CONTEXT_V1',
]) assert.ok(fullUat.includes(marker) || source.includes(marker), `canonical UAT is missing ${marker}`);

assert.match(changelog, /## 1\.17\.1/);
assert.match(readme, /version-1\.17\.1/);
assert.match(readme, /Скачать пакет/);
assert.ok(readme.includes('docs/assets/studio-start-v1.14.1.jpg'), 'historical product screenshot must remain available');

console.log('TESSA Matrix Studio v1.17 canonical RC, historical evidence and live-UAT regression contract: OK');
