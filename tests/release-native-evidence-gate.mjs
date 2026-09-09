import crypto from 'node:crypto';
import { assertReleaseNativeEvidence, makeNativeEvidenceAttestation } from '../tools/release-native-evidence-gate.mjs';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const source = '// @version      1.12.2\n(function(){})();\n';
const sourceSha256 = crypto.createHash('sha256').update(source).digest('hex');
const validated = {
  status: 'verified',
  expectedOperation: 'delete-save-native-request',
  deleteVerified: true,
  deleteRequestObserved: true,
  deleteRequestType: 'd090417f-bf4b-45ed-9c82-33ef23acd96f',
  deleteInfoHasVersionId: true,
  localMembershipStayedStable: true,
  localCardStayedCleanAfterDelete: true,
  saveObserved: true,
  refreshGetObserved: true,
  sameMatrix: true,
  operationOrderValid: true,
  restorationSafe: true,
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
  deleteEvidenceSha256: 'a'.repeat(64),
  saveEvidenceSha256: 'b'.repeat(64),
  capturedAt: '2026-09-09T09:51:58.090Z',
});
assert(attestation.schemaVersion === 2, JSON.stringify(attestation));
assert(attestation.version === '1.12.2', JSON.stringify(attestation));
assert(attestation.userscriptSha256 === sourceSha256, JSON.stringify(attestation));
assert(attestation.status === 'verified', JSON.stringify(attestation));
assert(attestation.operation === 'delete-save-native-request', JSON.stringify(attestation));
assert(attestation.deleteRequestType === validated.deleteRequestType, JSON.stringify(attestation));
assert(attestation.deleteEvidenceSha256 === 'a'.repeat(64), JSON.stringify(attestation));
assert(attestation.saveEvidenceSha256 === 'b'.repeat(64), JSON.stringify(attestation));
assert(!JSON.stringify(attestation).includes('reasonCodes'), 'attestation must retain only normalized contract facts');

const accepted = assertReleaseNativeEvidence({ version: '1.12.2', userscriptSource: source, attestation });
assert(accepted.ok === true && accepted.version === '1.12.2', JSON.stringify(accepted));
assert(accepted.operation === 'delete-save-native-request', JSON.stringify(accepted));

let staleBlocked = false;
try {
  assertReleaseNativeEvidence({ version: '1.12.2', userscriptSource: `${source}// changed`, attestation });
} catch (error) {
  staleBlocked = /sha|source|userscript|stale/i.test(String(error?.message || error));
}
assert(staleBlocked, 'attestation for a different userscript must be rejected');

let wrongContractBlocked = false;
try {
  assertReleaseNativeEvidence({ version: '1.12.2', userscriptSource: source, attestation: { ...attestation, deleteRequestType: '0'.repeat(36) } });
} catch (error) {
  wrongContractBlocked = /delete|request|contract|type/i.test(String(error?.message || error));
}
assert(wrongContractBlocked, 'attestation for the wrong DeleteRow request contract must be rejected');

let unverifiedBlocked = false;
try {
  assertReleaseNativeEvidence({ version: '1.12.2', userscriptSource: source, attestation: { ...attestation, status: 'incomplete' } });
} catch (error) {
  unverifiedBlocked = /verified|status/i.test(String(error?.message || error));
}
assert(unverifiedBlocked, 'non-verified attestation must block release');

const legacy = assertReleaseNativeEvidence({ version: '1.12.1', userscriptSource: source, attestation: null });
assert(legacy.ok === true && legacy.skipped === true, JSON.stringify(legacy));

console.log('Release native-evidence gate: v2 split DeleteRow/Save contract + userscript hash binding: OK');
