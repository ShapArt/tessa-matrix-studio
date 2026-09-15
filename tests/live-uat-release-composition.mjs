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

assert.match(rcContract, /import ['"]\.\/live-uat-final-four-regressions\.mjs['"]/,
  'npm-test RC contract must permanently execute the final-four behavioral regression');
assert.match(rcContract, /import ['"]\.\/live-uat-release-composition\.mjs['"]/,
  'npm-test RC contract must permanently execute release/UAT composition parity');

console.log('Live UAT release composition parity: exact candidate and production build use the same final transforms: OK');
