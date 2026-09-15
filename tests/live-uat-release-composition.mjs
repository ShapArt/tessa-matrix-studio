import fs from 'node:fs';
import assert from 'node:assert/strict';

const artifactComposition = fs.readFileSync(new URL('./v1.14-artifact-composition.mjs', import.meta.url), 'utf8');
const releaseWorkflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const rcContract = fs.readFileSync(new URL('./v1.14-rc-contract.mjs', import.meta.url), 'utf8');

assert.match(artifactComposition, /v1\.14-full-uat-inline-failures\.mjs/,
  'canonical composed artifact must keep inline Full UAT failure evidence');
assert.match(artifactComposition, /v1\.14-live-uat-final-four\.mjs/,
  'canonical composed artifact must apply the final-four live UAT fixes');

const inlineIndex = releaseWorkflow.indexOf('node hotfixes/v1.14-full-uat-inline-failures.mjs dist/tessa-matrix-studio.user.js');
const finalFourIndex = releaseWorkflow.indexOf('node hotfixes/v1.14-live-uat-final-four.mjs dist/tessa-matrix-studio.user.js');
assert.ok(inlineIndex >= 0,
  'production release must apply inline Full UAT failure UX to the shipped userscript');
assert.ok(finalFourIndex > inlineIndex,
  'production release must apply final-four fixes after the finalizer/inline-failure transforms');
assert.match(releaseWorkflow, /hotfixes\/v1\.14-live-uat-final-four\.mjs/,
  'release change detection/package must track the final-four transform');
assert.match(releaseWorkflow, /hotfixes\/v1\.14-full-uat-inline-failures\.mjs/,
  'release change detection/package must track the inline-failure transform');

// Release checks must describe the same canonical artifact as the exact UAT builder that
// passed live TESSA 33/33. Do not keep historical diagnostic strings as release gates:
// those strings are not part of the v1.14 artifact contract and can reject a verified build.
for (const obsolete of [
  'DUPLICATE_IDENTITY_COPY_AS_ADD_V1',
  'LIVE_UAT_2026_09_11',
  'diagnosticNativeCardCache',
  'Numeric ranges have an exact grammar',
]) {
  assert.doesNotMatch(releaseWorkflow, new RegExp(obsolete.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `production release must not require obsolete ad-hoc marker: ${obsolete}`);
}

for (const marker of [
  '__TMS_INSTALL_INTERVAL_ADD_VALID_FALLBACK__',
  '__TMS_FULL_UAT_V1__',
  'FULL_UAT_RUNTIME_CONTEXT_V1',
  'FULL_UAT_INLINE_FAILURES_V1',
  'FULL_UAT_PICKER_SOURCE_V2',
  'REFRESH_DICTIONARY_DIRECT_XML_V2',
  'FULL_UAT_BOOLEAN_SEMANTIC_V2',
  'FAIL DETAILS',
]) {
  assert.match(releaseWorkflow, new RegExp(`grep -Fq \\"${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\"`),
    `production release must validate canonical v1.14 marker: ${marker}`);
}

assert.match(rcContract, /import ['"]\.\/live-uat-final-four-regressions\.mjs['"]/,
  'npm-test RC contract must permanently execute the final-four behavioral regression');
assert.match(rcContract, /import ['"]\.\/live-uat-release-composition\.mjs['"]/,
  'npm-test RC contract must permanently execute release/UAT composition parity');

console.log('Live UAT release composition parity: exact candidate and production build use the same final transforms and marker contract: OK');
