import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const buildIndex = workflow.indexOf('- name: Build assets');
const gateIndex = workflow.indexOf('- name: Enforce native TESSA evidence');
const attestIndex = workflow.indexOf('- name: Attest release provenance');
const publishIndex = workflow.indexOf('- name: Publish release');

assert(buildIndex >= 0, 'release build step is missing');
assert(gateIndex >= 0, 'release must enforce live native TESSA evidence');
assert(gateIndex > buildIndex, 'native evidence must validate the exact built public userscript, not only repository source');
assert(attestIndex > gateIndex, 'artifact provenance attestation must happen only after native evidence passes');
assert(publishIndex > gateIndex, 'release publication must happen only after native evidence passes');
assert(workflow.includes('release-evidence/v$VERSION.json'), 'release must use a version-scoped native evidence attestation');
assert(workflow.includes('test -f "$EVIDENCE"'), 'release must fail closed when native evidence is absent');
assert(workflow.includes('node tools/release-native-evidence-gate.mjs "$VERSION" dist/tessa-matrix-studio.user.js "$EVIDENCE"'),
  'release gate must bind evidence to the exact built dist userscript');
assert(workflow.includes('candidateArtifactRunId'), 'schema-v5 release gate must read the exact live-tested Actions run id');
assert(workflow.includes('candidateArtifactName'), 'schema-v5 release gate must read the exact live-tested artifact name');
assert(workflow.includes('candidateArtifactDigest'), 'schema-v5 release gate must read the expected immutable artifact digest');
assert(workflow.includes('gh api "repos/$GITHUB_REPOSITORY/actions/runs/$RUN_ID/artifacts"'),
  'schema-v5 release gate must verify the immutable candidate artifact through GitHub API');
assert(workflow.includes('Live-tested artifact digest mismatch'),
  'schema-v5 release gate must fail closed when the recorded artifact digest differs');

const gateBlock = workflow.slice(gateIndex, attestIndex);
assert(!gateBlock.includes('continue-on-error'), 'native evidence gate must never be advisory');
assert(!gateBlock.includes('|| true'), 'native evidence gate must fail closed');

console.log('Release workflow native-evidence enforcement: OK');
