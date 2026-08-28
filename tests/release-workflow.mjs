import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const canary = fs.readFileSync(new URL('../.github/workflows/delivery-canary.yml', import.meta.url), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(workflow.includes('workflow_run:'), 'release must wait for Quality & Security workflow completion');
assert(workflow.includes('workflows: ["Quality & Security"]'), 'release must be chained to Quality & Security');
assert(workflow.includes('types: [completed]'), 'release workflow_run must wait for completed');
assert(workflow.includes('branches: [main]'), 'release workflow_run must be limited to main');
assert(workflow.includes("github.event.workflow_run.conclusion == 'success'"), 'release must require successful Quality & Security');
assert(workflow.includes('workflow_dispatch:'), 'manual release fallback must stay available');
assert(workflow.includes('github.event.workflow_run.head_sha'), 'release must checkout the exact verified commit');
assert(workflow.includes('git diff-tree'), 'release must detect whether userscript changed');
assert(workflow.includes('tessa-matrix-studio.user.js'), 'release change gate must watch the userscript');

// Tampermonkey should check a tiny metadata asset and download the full script only when needed.
assert(workflow.includes('tessa-matrix-studio.meta.js'), 'release must build and publish the metadata-only update asset');
assert(workflow.includes('tessa-matrix-studio.user.js'), 'release must continue publishing the full userscript asset');

// Release assets must be independently verifiable after download.
assert(workflow.includes('sha256sum'), 'release must calculate SHA-256 checksums');
assert(workflow.includes('SHA256SUMS.txt'), 'release must publish SHA256SUMS.txt');
const checksumMentions = (workflow.match(/SHA256SUMS\.txt/g) || []).length;
assert(checksumMentions >= 3, 'SHA256SUMS.txt must be built and published');

// Release assets must carry GitHub/Sigstore build provenance.
assert(workflow.includes('attestations: write'), 'release must allow writing artifact attestations');
assert(workflow.includes('id-token: write'), 'release must allow OIDC signing for attestations');
assert(workflow.includes('uses: actions/attest@'), 'release must generate GitHub artifact attestations');
assert(workflow.includes('subject-checksums: dist/SHA256SUMS.txt'), 'attestation must bind the checksummed release assets');

// Published versions are immutable: a repeated run may finish a release after a tag-only partial failure,
// but it must never replace assets of an already published GitHub Release.
assert(!workflow.includes('--clobber'), 'published release assets must never be overwritten with --clobber');
assert(!workflow.includes('gh release upload'), 'release workflow must not mutate assets of an existing release');
assert(workflow.includes('Refusing to overwrite published release'), 'workflow must fail explicitly when the version is already published');

// Do not trust a successful upload alone: verify what anonymous users actually receive through /latest/download.
assert(workflow.includes('Verify public latest delivery'), 'release must verify the public latest endpoint after publication');
assert(workflow.includes('releases/latest/download'), 'public verification must use the anonymous latest-download endpoint');
assert(workflow.includes('tessa-matrix-studio.meta.js'), 'public verification must fetch the latest metadata asset');
assert(workflow.includes('tessa-matrix-studio.user.js'), 'public verification must fetch the latest full userscript asset');
assert(workflow.includes('curl --fail --location'), 'public verification must fail on HTTP errors and follow GitHub redirects');
assert(workflow.includes('EXPECTED_VERSION'), 'public verification must compare the published metadata version with the release version');
assert(workflow.includes('sha256sum --check'), 'public verification must validate downloaded asset checksums');

// Delivery remains monitored after release day too.
assert(canary.includes('schedule:'), 'delivery canary must run on a schedule');
assert(canary.includes('cron:'), 'delivery canary must define a cron cadence');
assert(canary.includes('workflow_dispatch:'), 'delivery canary must also be runnable manually');
assert(canary.includes('releases/latest/download'), 'delivery canary must exercise public latest-download URLs');
assert(canary.includes('tessa-matrix-studio.meta.js'), 'delivery canary must download metadata');
assert(canary.includes('tessa-matrix-studio.user.js'), 'delivery canary must download userscript');
assert(canary.includes('SHA256SUMS.txt'), 'delivery canary must download checksum manifest');
assert(canary.includes('sha256sum --check'), 'delivery canary must verify checksums');
assert(canary.includes('@updateURL'), 'delivery canary must verify Tampermonkey update metadata');
assert(canary.includes('@downloadURL'), 'delivery canary must verify Tampermonkey download metadata');

console.log('TESSA Matrix Studio release workflow checks: OK');
