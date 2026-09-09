import fs from 'node:fs';

const candidate = fs.readFileSync(new URL('../.github/workflows/uat-candidate.yml', import.meta.url), 'utf8');
const release = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(candidate.includes('workflow_dispatch:'), 'UAT candidate must be explicitly started');
assert(candidate.includes('ref:'), 'UAT candidate must accept an exact branch/commit ref');
assert(candidate.includes('permissions:\n  contents: read'), 'UAT candidate must be read-only');
assert(candidate.includes('npm ci --ignore-scripts --no-audit --no-fund'), 'UAT candidate must install the locked test environment');
assert(candidate.includes('npm test'), 'UAT candidate must pass the full regression suite before packaging');

for (const command of [
  'cp tessa-matrix-studio.user.js dist/tessa-matrix-studio.user.js',
  'node hotfixes/malformed-range-diagnostic-transform.mjs dist/tessa-matrix-studio.user.js',
  "cat hotfixes/interval-add-valid-fallback.js >> dist/tessa-matrix-studio.user.js",
  'sha256sum',
]) {
  assert(candidate.includes(command), `UAT candidate is missing release composition command: ${command}`);
  assert(release.includes(command), `Release is missing composition command shared with UAT candidate: ${command}`);
}

assert(candidate.includes('candidate-manifest.json'), 'UAT candidate must include a commit/version/hash manifest');
assert(candidate.includes('tessa-matrix-studio.user.js'), 'UAT candidate must upload the exact installable userscript');
assert(candidate.includes('SHA256SUMS.txt'), 'UAT candidate must upload checksums');
assert(candidate.includes('uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'),
  'UAT candidate artifact upload must be pinned to the reviewed upload-artifact commit');
assert(!candidate.includes('gh release create'), 'UAT candidate must never publish a GitHub Release');
assert(!candidate.includes('contents: write'), 'UAT candidate must not receive release write permissions');

console.log('UAT candidate workflow exact-artifact contract: OK');
