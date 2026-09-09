import crypto from 'node:crypto';
import { assertReleaseNativeEvidence, makeNativeEvidenceAttestation } from '../tools/release-native-evidence-gate.mjs';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const source = '// @version      1.12.2\n(function(){})();\n';
const sourceSha256 = crypto.createHash('sha256').update(source).digest('hex');
const validated = {
  status: 'verified',
  expectedOperation: 'delete-save',
  expectedRemovedCount: 1,
  deleteVerified: true,
  saveObserved: true,
  restorationSafe: true,
  removedVersions: ['redacted-version'],
  unexpectedAddedVersions: [],
  storeRecordCount: 1,
  truncatedCount: 0,
  reasonCodes: [],
};

let missingBlocked = false;
try {
  assertReleaseNativeEvidence({ version: '1.12.2', userscriptSource: source, attestation: null });
} catch (error) {
  missingBlocked = /evidence|attestation|native/i.test(String(error?.message || error));
}
assert(missingBlocked, '1.12.2 release must fail closed without native evidence attestation');

const attestation = makeNativeEvidenceAttestation({
  version: '1.12.2',
  userscriptSource: source,
  validatedResult: validated,
  evidenceSha256: 'a'.repeat(64),
  capturedAt: '2026-09-09T09:00:00.000Z',
});
assert(attestation.schemaVersion === 1, JSON.stringify(attestation));
assert(attestation.version === '1.12.2', JSON.stringify(attestation));
assert(attestation.userscriptSha256 === sourceSha256, JSON.stringify(attestation));
assert(attestation.status === 'verified', JSON.stringify(attestation));
assert(attestation.evidenceSha256 === 'a'.repeat(64), JSON.stringify(attestation));
assert(!JSON.stringify(attestation).includes('redacted-version'), 'attestation must not retain row/version identifiers');

const accepted = assertReleaseNativeEvidence({ version: '1.12.2', userscriptSource: source, attestation });
assert(accepted.ok === true && accepted.version === '1.12.2', JSON.stringify(accepted));

let staleBlocked = false;
try {
  assertReleaseNativeEvidence({ version: '1.12.2', userscriptSource: `${source}// changed`, attestation });
} catch (error) {
  staleBlocked = /sha|source|userscript|stale/i.test(String(error?.message || error));
}
assert(staleBlocked, 'attestation for a different userscript must be rejected');

let unverifiedBlocked = false;
try {
  assertReleaseNativeEvidence({ version: '1.12.2', userscriptSource: source, attestation: { ...attestation, status: 'incomplete' } });
} catch (error) {
  unverifiedBlocked = /verified|status/i.test(String(error?.message || error));
}
assert(unverifiedBlocked, 'non-verified attestation must block release');

const legacy = assertReleaseNativeEvidence({ version: '1.12.1', userscriptSource: source, attestation: null });
assert(legacy.ok === true && legacy.skipped === true, JSON.stringify(legacy));

console.log('Release native-evidence gate: fail-closed attestation + userscript hash binding: OK');
