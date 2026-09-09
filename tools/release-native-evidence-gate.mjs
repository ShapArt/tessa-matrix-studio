import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DELETE_ROW_REQUEST_TYPE = 'd090417f-bf4b-45ed-9c82-33ef23acd96f';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function parseVersion(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Invalid semantic version: ${value}`);
  return match.slice(1).map(Number);
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function assertHash(value, label) {
  if (!/^[a-f0-9]{64}$/i.test(String(value || ''))) throw new Error(`${label} must be a SHA-256 hex digest.`);
}

function assertVerifiedContract(result) {
  if (!result || result.status !== 'verified') {
    throw new Error('Native evidence is not verified; attestation cannot be created.');
  }
  if (result.expectedOperation !== 'delete-save-native-request') {
    throw new Error(`Unsupported native evidence operation: ${result.expectedOperation}`);
  }
  const requiredTrue = [
    'deleteVerified',
    'deleteRequestObserved',
    'deleteInfoHasVersionId',
    'localMembershipStayedStable',
    'localCardStayedCleanAfterDelete',
    'saveObserved',
    'refreshGetObserved',
    'sameMatrix',
    'operationOrderValid',
    'restorationSafe',
  ];
  const missing = requiredTrue.filter(key => result[key] !== true);
  if (missing.length) throw new Error(`Native DELETE/SAVE evidence is incomplete: ${missing.join(', ')}.`);
  if (String(result.deleteRequestType || '').toLowerCase() !== DELETE_ROW_REQUEST_TYPE) {
    throw new Error(`Unexpected native DeleteRow request type: ${result.deleteRequestType || 'missing'}.`);
  }
  if (Number(result.truncatedCount || 0) !== 0) throw new Error('Truncated native evidence cannot be attested.');
}

export function makeNativeEvidenceAttestation({
  version,
  userscriptSource,
  validatedResult,
  deleteEvidenceSha256,
  saveEvidenceSha256,
  capturedAt = null,
}) {
  parseVersion(version);
  assertHash(deleteEvidenceSha256, 'deleteEvidenceSha256');
  assertHash(saveEvidenceSha256, 'saveEvidenceSha256');
  assertVerifiedContract(validatedResult);

  return {
    schemaVersion: 2,
    version: String(version),
    userscriptSha256: sha256(String(userscriptSource ?? '')),
    deleteEvidenceSha256: String(deleteEvidenceSha256).toLowerCase(),
    saveEvidenceSha256: String(saveEvidenceSha256).toLowerCase(),
    capturedAt: capturedAt || null,
    status: 'verified',
    operation: 'delete-save-native-request',
    deleteVerified: true,
    deleteRequestObserved: true,
    deleteRequestType: DELETE_ROW_REQUEST_TYPE,
    deleteInfoHasVersionId: true,
    localMembershipStayedStable: true,
    localCardStayedCleanAfterDelete: true,
    saveObserved: true,
    refreshGetObserved: true,
    sameMatrix: true,
    operationOrderValid: true,
    restorationSafe: true,
    storeRecordCount: Number(validatedResult.storeRecordCount || 0),
    truncatedCount: 0,
  };
}

export function assertReleaseNativeEvidence({ version, userscriptSource, attestation }) {
  if (compareVersions(version, '1.12.2') < 0) {
    return { ok: true, skipped: true, version: String(version), reason: 'legacy-release-before-native-evidence-gate' };
  }

  if (!attestation || typeof attestation !== 'object') {
    throw new Error(`Native evidence attestation is required for release ${version}. Keep this build as RC until live TESSA DELETE + SAVE evidence is verified.`);
  }
  if (Number(attestation.schemaVersion) !== 2) throw new Error('Native evidence attestation schemaVersion must be 2.');
  if (String(attestation.version) !== String(version)) {
    throw new Error(`Native evidence attestation version ${attestation.version || 'missing'} does not match release ${version}.`);
  }
  if (attestation.status !== 'verified') throw new Error(`Native evidence attestation status must be verified, got ${attestation.status || 'missing'}.`);
  if (attestation.operation !== 'delete-save-native-request') {
    throw new Error(`Native evidence attestation operation must be delete-save-native-request, got ${attestation.operation || 'missing'}.`);
  }
  if (String(attestation.deleteRequestType || '').toLowerCase() !== DELETE_ROW_REQUEST_TYPE) {
    throw new Error(`Native evidence attestation has the wrong DeleteRow request type: ${attestation.deleteRequestType || 'missing'}.`);
  }

  const requiredTrue = [
    'deleteVerified',
    'deleteRequestObserved',
    'deleteInfoHasVersionId',
    'localMembershipStayedStable',
    'localCardStayedCleanAfterDelete',
    'saveObserved',
    'refreshGetObserved',
    'sameMatrix',
    'operationOrderValid',
    'restorationSafe',
  ];
  const missing = requiredTrue.filter(key => attestation[key] !== true);
  if (missing.length) throw new Error(`Native evidence attestation does not prove the required contract: ${missing.join(', ')}.`);
  if (Number(attestation.truncatedCount || 0) !== 0) throw new Error('Native evidence attestation reports truncated recorder data.');

  assertHash(attestation.deleteEvidenceSha256, 'attestation.deleteEvidenceSha256');
  assertHash(attestation.saveEvidenceSha256, 'attestation.saveEvidenceSha256');
  assertHash(attestation.userscriptSha256, 'attestation.userscriptSha256');

  const actualUserscriptSha256 = sha256(String(userscriptSource ?? ''));
  if (String(attestation.userscriptSha256).toLowerCase() !== actualUserscriptSha256) {
    throw new Error(`Native evidence attestation is stale: userscript SHA-256 ${attestation.userscriptSha256} does not match current source ${actualUserscriptSha256}.`);
  }

  return {
    ok: true,
    skipped: false,
    version: String(version),
    operation: 'delete-save-native-request',
    userscriptSha256: actualUserscriptSha256,
    deleteEvidenceSha256: String(attestation.deleteEvidenceSha256).toLowerCase(),
    saveEvidenceSha256: String(attestation.saveEvidenceSha256).toLowerCase(),
  };
}

function cli() {
  const args = process.argv.slice(2);
  const version = args.shift();
  const userscriptPath = args.shift();
  const attestationPath = args.shift();
  if (!version || !userscriptPath) {
    throw new Error('Usage: node tools/release-native-evidence-gate.mjs <version> <userscript> [attestation.json]');
  }
  const userscriptSource = fs.readFileSync(path.resolve(userscriptPath), 'utf8');
  const attestation = attestationPath ? JSON.parse(fs.readFileSync(path.resolve(attestationPath), 'utf8')) : null;
  const result = assertReleaseNativeEvidence({ version, userscriptSource, attestation });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath = path.resolve(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  try { cli(); }
  catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}
