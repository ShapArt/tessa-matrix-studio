import fs from 'node:fs';
import './v1.14-artifact-composition.mjs';
import './release-native-evidence-workflow-enforcement.mjs';
import './uat-candidate-workflow.mjs';
import './native-evidence-attestation-cli.mjs';

const workflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const canary = fs.readFileSync(new URL('../.github/workflows/delivery-canary.yml', import.meta.url), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(packageJson.version === '1.17.0', `release package version must be 1.17.0, got ${packageJson.version}`);
assert(workflow.includes('workflow_run:'), 'release must wait for Quality & Security');
assert(workflow.includes('workflows: ["Quality & Security"]'), 'release must be chained to Quality & Security');
assert(workflow.includes("github.event.workflow_run.conclusion == 'success'"), 'release must require green quality checks');
assert(workflow.includes('github.event.workflow_run.head_sha'), 'release must checkout the exact verified commit');
assert(workflow.includes('gh release view --json tagName'), 'release must compare against the latest published tag');
assert(/git diff --name-only\s+"\$PREVIOUS_TAG"\.\.HEAD/.test(workflow), 'change gate must cover the full release range');
for (const watched of ['src/', 'tools/build-candidate.mjs', 'package.json', 'package-lock.json']) {
  assert(workflow.includes(watched), `release change gate must watch ${watched}`);
}

const installIndex = workflow.indexOf('npm ci --ignore-scripts --no-audit --no-fund');
const verifyIndex = workflow.indexOf('- name: Verify');
assert(installIndex >= 0 && verifyIndex > installIndex, 'locked dependencies must be installed before verification');
assert(workflow.includes('npm run build:production'), 'release must use the canonical production builder');
assert(!workflow.includes('node hotfixes/'), 'release must not compose production from hotfix transforms');
assert(workflow.includes('TESSA_MATRIX_ROUNDTRIP_V7'), 'release must verify the current roundtrip format');
assert(workflow.includes('TESSA_MATRIX_SUPPORT_BUNDLE_V1'), 'release must verify the unified support package');
assert(workflow.includes('Production build exposed test/UAT globals'), 'release must fail if production exposes test internals');
assert(workflow.includes('tessa-matrix-studio.meta.js'), 'release must publish metadata-only updates');

assert(workflow.includes('Refusing to overwrite published release'), 'published versions must be immutable');
assert(!workflow.includes('--clobber'), 'release assets must never be overwritten');
assert(!workflow.includes('gh release upload'), 'existing releases must not be mutated');
assert(workflow.includes('sha256sum'), 'release assets must have SHA-256 checksums');
assert(workflow.includes('SHA256SUMS.txt'), 'release must publish its checksum manifest');
assert(workflow.includes('attestations: write') && workflow.includes('id-token: write'), 'release must permit provenance signing');
assert(workflow.includes('uses: actions/attest@'), 'release must generate artifact provenance');
assert(workflow.includes('subject-checksums: dist/SHA256SUMS.txt'), 'attestation must bind release checksums');

const evidenceStart = workflow.indexOf('- name: Enforce native TESSA evidence');
const attestStart = workflow.indexOf('- name: Attest release provenance');
const evidence = workflow.slice(evidenceStart, attestStart);
assert(evidence.includes('GH_TOKEN: ${{ github.token }}'), 'native evidence verification must authenticate GitHub API calls');
assert(evidence.includes('candidateArtifactRunId') && evidence.includes('candidateArtifactDigest'), 'evidence must bind the immutable candidate artifact');

assert(workflow.includes('Verify public latest delivery'), 'release must verify public delivery');
assert(workflow.includes('releases/latest/download'), 'delivery verification must use public latest URLs');
assert(workflow.includes('curl --fail --location'), 'delivery verification must fail on HTTP errors');
assert(workflow.includes('sha256sum --check'), 'downloaded assets must be checked against the manifest');

for (const marker of ['schedule:', 'workflow_dispatch:', 'releases/latest/download', 'SHA256SUMS.txt', 'sha256sum --check', '@updateURL', '@downloadURL']) {
  assert(canary.includes(marker), `delivery canary is missing ${marker}`);
}

console.log('TESSA Matrix Studio release workflow checks: OK');
