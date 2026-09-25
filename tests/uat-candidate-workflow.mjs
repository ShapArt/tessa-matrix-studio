import fs from 'node:fs';

const candidate = fs.readFileSync(new URL('../.github/workflows/uat-candidate.yml', import.meta.url), 'utf8');
const release = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(candidate.includes('workflow_dispatch:'), 'UAT candidate must be explicitly started');
assert(candidate.includes('ref:'), 'UAT candidate must accept an exact ref');
assert(candidate.includes('permissions:\n  contents: read'), 'UAT candidate must remain read-only');
assert(candidate.includes('npm ci --ignore-scripts --no-audit --no-fund'), 'UAT must use the lockfile');
assert(candidate.includes('npm test'), 'UAT packaging must follow the full regression suite');
assert(candidate.includes('npm run build:uat'), 'UAT must use the canonical UAT builder');
assert(release.includes('npm run build:production'), 'Release must use the canonical production builder');
assert(!candidate.includes('node hotfixes/'), 'UAT must not rebuild the candidate through legacy transforms');
assert(!release.includes('node hotfixes/'), 'Release must not rebuild the candidate through legacy transforms');
assert(candidate.includes('__TMS_FULL_UAT_V1__'), 'UAT artifact must verify that the Full UAT runner is present');
assert(candidate.includes('__TESSA_MATRIX_SYNC_EXPORTS__'), 'UAT artifact must verify that test exports are present');
assert(candidate.includes('candidate-manifest.json'), 'UAT artifact must include version/commit/hash metadata');
assert(candidate.includes('SHA256SUMS.txt'), 'UAT artifact must include checksums');
assert(candidate.includes('uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'), 'artifact upload action must be pinned');
assert(!candidate.includes('gh release create') && !candidate.includes('contents: write'), 'UAT workflow must not publish releases');

console.log('UAT candidate workflow exact-artifact contract: OK');
