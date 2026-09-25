import fs from 'node:fs';
import assert from 'node:assert/strict';

const builder = fs.readFileSync(new URL('../tools/build-candidate.mjs', import.meta.url), 'utf8');
const releaseWorkflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const uatWorkflow = fs.readFileSync(new URL('../.github/workflows/uat-candidate.yml', import.meta.url), 'utf8');
const uatSource = fs.readFileSync(new URL('../src/uat/full-uat.js', import.meta.url), 'utf8');
const rcContract = fs.readFileSync(new URL('./v1.14-rc-contract.mjs', import.meta.url), 'utf8');

assert.match(builder, /if \(profile === 'uat'\) modules\.push\(read\('src\/uat\/full-uat\.js'\)\)/,
  'the UAT profile must append the canonical Full UAT module');
assert.match(builder, /if \(profile === 'production'\)/,
  'the builder must have an explicit production boundary');
assert.match(builder, /delete window\.__TMS_RUNTIME_BRIDGE__/,
  'production must remove the temporary runtime bridge');
assert.match(uatSource, /FULL_UAT_INLINE_FAILURES_V1/,
  'canonical Full UAT must retain inline failure evidence');
assert.match(uatSource, /FAIL DETAILS/,
  'canonical Full UAT must show exact failed checks without ZIP extraction');
assert.match(uatSource, /FULL_UAT_FINAL_VERDICT_AFTER_SAVE_V2/,
  'canonical Full UAT must calculate its verdict after final Save evidence');

assert.match(uatWorkflow, /npm run build:uat/);
assert.match(releaseWorkflow, /npm run build:production/);
assert.doesNotMatch(releaseWorkflow, /node hotfixes\//,
  'production release must not replay historical hotfix transforms');
assert.match(releaseWorkflow, /Production build exposed test\/UAT globals/,
  'release must verify the production trust boundary');

assert.match(rcContract, /import ['"]\.\/live-uat-final-four-regressions\.mjs['"]/,
  'RC contract must retain the final-four behavior regression');
assert.match(rcContract, /import ['"]\.\/live-uat-release-composition\.mjs['"]/,
  'RC contract must execute production/UAT composition parity');

console.log('Live UAT/release parity: one canonical source with isolated production and UAT profiles: OK');
