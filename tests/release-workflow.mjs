import fs from 'node:fs';
import './v1.14-artifact-composition.mjs';
import './release-native-evidence-workflow-enforcement.mjs';
import './uat-candidate-workflow.mjs';
import './native-evidence-attestation-cli.mjs';

const workflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const canary = fs.readFileSync(new URL('../.github/workflows/delivery-canary.yml', import.meta.url), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
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
assert(workflow.includes('tessa-matrix-studio.user.js'), 'release change gate must watch the userscript');

// v1.14.2 is the exact live-tested production candidate. The public Release must build the
// same transform chain that produced the PASSED 37/37 TEST artifact.
assert(packageJson.version === '1.14.2', `release package version must be 1.14.2, got ${packageJson.version}`);
assert(workflow.includes('hotfixes/v1.14.1-changes-report-full-row.mjs'),
  'release change detection/package must track the v1.14.1 changes-report transform');
assert(workflow.includes('node hotfixes/v1.14.1-changes-report-full-row.mjs dist/tessa-matrix-studio.user.js'),
  'release build must compose the v1.14.1 changes-report transform into the public userscript');
assert(workflow.includes('REVIEWED_CHANGES_REPORT_V3'),
  'release build/public verification must require the current reviewed report V3 marker');
for (const marker of [
  'LIVE_EXCEL_PREVIEW_UX_V1',
  'LIVE_PICKER_DELIMITER_SAFE_V2',
  'PREVIEW_COUNTER_FILTERS_V1',
  'LIVE_EXCEL_FULL_UAT_SCOPE_FIX_V1',
  'FULL_UAT_CLEAR_SCENARIO_DETERMINISTIC_V2',
  'FULL_UAT_COPIED_IDENTITY_COLLISION_SAFE_V1',
  'FULL_UAT_ACTION_COVERAGE_FINAL_V1',
  'FULL_UAT_VERSION_PROVENANCE_V1',
  'PROD_SHADOW_UAT_V1',
]) {
  assert(workflow.includes(marker), `release build/public verification must require ${marker}`);
}
for (const transform of [
  'hotfixes/v1.14.2-live-excel-preview-ux.mjs',
  'hotfixes/v1.14.2-preview-counter-filters.mjs',
  'hotfixes/v1.14.2-full-uat-scope-fix.mjs',
  'hotfixes/v1.14.2-full-uat-deterministic-clear.mjs',
  'hotfixes/v1.14.2-full-uat-copied-identity-collision-safe.mjs',
  'hotfixes/v1.14.2-full-uat-action-coverage-final.mjs',
  'hotfixes/v1.14.2-full-uat-version-provenance.mjs',
]) {
  assert(workflow.includes(`node ${transform} dist/tessa-matrix-studio.user.js`),
    `release composition must apply exact v1.14.2 transform: ${transform}`);
}
assert(workflow.includes('! grep -Fq "Детали изменений"'),
  'release must prove the obsolete second changes-report sheet is absent');

// Release verification executes the same npm suite as Quality & Security. It must install the
// lockfile-pinned devDependencies first, otherwise tests that require jsdom fail only at publish time.
const installDependenciesIndex = workflow.indexOf('npm ci --ignore-scripts --no-audit --no-fund');
const verifyStepIndex = workflow.indexOf('- name: Verify');
assert(installDependenciesIndex >= 0, 'release must install test dependencies before npm test');
assert(verifyStepIndex >= 0 && installDependenciesIndex < verifyStepIndex,
  'release dependency installation must happen before the Verify step');

// A release can land through a multi-commit/fast-forward integration. Looking only at HEAD^..HEAD
// misses the userscript when the tip commit is docs-only. Compare the latest published release tag
// with the exact verified HEAD instead. Formatting may wrap the watched paths across YAML lines.
assert(workflow.includes('gh release view --json tagName'), 'release must resolve the latest published release tag');
assert(workflow.includes('PREVIOUS_TAG'), 'release change gate must keep the previous published tag');
assert(/git diff --name-only\s+"\$PREVIOUS_TAG"\.\.HEAD\s+--[\s\\\S]*?tessa-matrix-studio\.user\.js/.test(workflow),
  'release must detect userscript changes across the full published-release-to-HEAD range');
assert(!workflow.includes('git diff-tree --no-commit-id --name-only -r HEAD^ HEAD'),
  'release must not rely on only the last commit for userscript change detection');

// Tampermonkey should check a tiny metadata asset and download the full script only when needed.
assert(workflow.includes('tessa-matrix-studio.meta.js'), 'release must build and publish the metadata-only update asset');
assert(workflow.includes('tessa-matrix-studio.user.js'), 'release must continue publishing the full userscript asset');

// v1.14 production verification must track current artifact markers only. The historical
// LIVE_UAT_2026_09_11 marker was removed from the canonical artifact long ago and must not
// be able to block a release after the exact userscript has already passed live Full UAT.
assert(workflow.includes('FULL_UAT_RUNTIME_CONTEXT_V1'), 'release must verify the current Full UAT runtime-context marker');
assert(!workflow.includes('LIVE_UAT_2026_09_11'), 'release must not require the obsolete LIVE_UAT_2026_09_11 marker');

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
