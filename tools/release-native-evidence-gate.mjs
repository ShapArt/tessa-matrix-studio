import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DELETE_ROW_REQUEST_TYPE = 'd090417f-bf4b-45ed-9c82-33ef23acd96f';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => String(value ?? '').trim().toLowerCase();

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

function membershipKey(row) {
  return canonical(row?.rowRowID || row?.versionId || row?.sectionRowId || row?.rowID || '');
}

function membershipKeys(rows) {
  return [...new Set((Array.isArray(rows) ? rows : []).map(membershipKey).filter(Boolean))].sort();
}

function sameStringArray(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function successfulRecord(record, method) {
  return canonical(record?.method) === canonical(method)
    && canonical(record?.outcome) === 'resolved'
    && record?.validationSuccessful !== false;
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

function requireFullUatEvidence(result) {
  if (!result || result.status !== 'verified') {
    throw new Error('Full UAT native evidence is not verified; attestation cannot be created.');
  }
  const requiredTrue = [
    'fullUatPassed',
    'finalBaselinePassed',
    'finalSaveConfirmed',
    'cleanupSafe',
    'deleteRequestObserved',
    'deleteInfoHasVersionId',
    'saveObserved',
    'refreshGetObserved',
    'sameMatrix',
    'operationOrderValid',
    'localMembershipRestored',
    'localCardStayedClean',
    'restorationSafe',
  ];
  const missing = requiredTrue.filter(key => result[key] !== true);
  if (missing.length) throw new Error(`Full UAT native evidence is incomplete: ${missing.join(', ')}.`);
  if (String(result.deleteRequestType || '').toLowerCase() !== DELETE_ROW_REQUEST_TYPE) {
    throw new Error(`Unexpected native DeleteRow request type: ${result.deleteRequestType || 'missing'}.`);
  }
  if (Number(result.failCount || 0) !== 0 || Number(result.notRunCount || 0) !== 0) {
    throw new Error('Full UAT evidence must contain zero FAIL and zero NOT_RUN checks.');
  }
  if (Number(result.passCount || 0) <= 0) throw new Error('Full UAT evidence must contain passing checks.');
  if (Number(result.truncatedCount || 0) !== 0) throw new Error('Truncated Full UAT native evidence cannot be attested.');
}

export function validateFullUatNativeEvidence(uatReport, nativeTrace) {
  if (!uatReport || uatReport.format !== 'TESSA_FULL_UAT_V1') {
    throw new Error('Full UAT evidence must use TESSA_FULL_UAT_V1 format.');
  }
  if (!nativeTrace || nativeTrace.format !== 'TESSA_NATIVE_OPERATION_RECORD_V1') {
    throw new Error('Full UAT native trace must use TESSA_NATIVE_OPERATION_RECORD_V1 format.');
  }

  const summary = uatReport.summary || {};
  const passCount = Number(summary.pass || 0);
  const failCount = Number(summary.fail || 0);
  const notRunCount = Number(summary.notRun || 0);
  const requiredNonPass = (Array.isArray(uatReport.checks) ? uatReport.checks : [])
    .filter(check => check?.required !== false && canonical(check?.status) !== 'pass');
  const fullUatPassed = canonical(uatReport.status) === 'passed'
    && passCount > 0
    && failCount === 0
    && notRunCount === 0
    && requiredNonPass.length === 0
    && (!Array.isArray(uatReport.failedChecks) || uatReport.failedChecks.length === 0);
  if (!fullUatPassed) {
    throw new Error(`Full UAT must be PASSED with zero FAIL/NOT_RUN; got status=${uatReport.status || 'missing'}, PASS=${passCount}, FAIL=${failCount}, NOT_RUN=${notRunCount}.`);
  }

  const finalBaselinePassed = (Array.isArray(uatReport.checks) ? uatReport.checks : [])
    .some(check => check?.id === 'final-baseline' && canonical(check?.status) === 'pass');
  if (!finalBaselinePassed) throw new Error('Full UAT evidence is missing a PASS final-baseline check.');

  const finalSaveConfirmed = Number(uatReport.writesCompleted || summary.writesCompleted || 0) > 0
    && Boolean(uatReport.finalMatrixSave)
    && uatReport.finalMatrixSave?.ok !== false
    && uatReport.finalMatrixSave?.skipped !== true;
  if (!finalSaveConfirmed) throw new Error('Full UAT evidence does not prove the sole final native Save.');

  const cleanupSafe = Number(summary.cleanupFailed || 0) === 0
    && Number(summary.cleanupLedgerPending || 0) === 0
    && Number(summary.cleanupLedgerFailed || 0) === 0
    && canonical(summary.restoreStatus || uatReport.restoreProof?.status || '') !== 'unsafe';
  if (!cleanupSafe) throw new Error('Full UAT evidence reports unsafe or incomplete cleanup/restoration.');

  const records = Array.isArray(nativeTrace.records) ? nativeTrace.records : [];
  const deleteIndex = records.findIndex(record =>
    successfulRecord(record, 'request')
    && canonical(record?.requestType) === DELETE_ROW_REQUEST_TYPE
  );
  const deleteRecord = deleteIndex >= 0 ? records[deleteIndex] : null;
  const deleteRequestObserved = deleteIndex >= 0;
  const deleteInfoHasVersionId = Boolean(deleteRecord?.info
    && Object.prototype.hasOwnProperty.call(deleteRecord.info, 'MatrixRowVersionID'));
  if (!deleteRequestObserved) throw new Error('Full UAT native trace does not contain a successful native DeleteRow request.');
  if (!deleteInfoHasVersionId) throw new Error('Full UAT native DeleteRow request does not contain MatrixRowVersionID.');

  const storeIndex = records.findIndex((record, index) => index > deleteIndex && successfulRecord(record, 'store'));
  const getIndex = records.findIndex((record, index) => index > storeIndex && storeIndex >= 0 && successfulRecord(record, 'get'));
  const saveObserved = storeIndex > deleteIndex;
  const refreshGetObserved = getIndex > storeIndex;
  const operationOrderValid = deleteIndex >= 0 && saveObserved && refreshGetObserved;
  if (!operationOrderValid) throw new Error('Full UAT native trace must prove DELETE -> Store -> Get ordering.');

  const reportMatrixId = canonical(uatReport.matrix?.matrixId);
  const traceMatrixId = canonical(nativeTrace.surface?.matrixId);
  const sameMatrix = Boolean(reportMatrixId && traceMatrixId && reportMatrixId === traceMatrixId);
  if (!sameMatrix) throw new Error('Full UAT report and native trace refer to different or missing MatrixID values.');

  const localMembershipRestored = sameStringArray(
    membershipKeys(nativeTrace.beforeMembership),
    membershipKeys(nativeTrace.afterMembership),
  );
  if (!localMembershipRestored) throw new Error('Full UAT native trace did not restore the original row membership.');

  const localCardStayedClean = nativeTrace.cardHasChangesAfterAction === false;
  if (!localCardStayedClean) throw new Error('Full UAT native trace left the main card dirty after the final Save.');

  const restorationSafe = Boolean(nativeTrace.restoration
    && Number.isFinite(Number(nativeTrace.restoration.failed))
    && Number(nativeTrace.restoration.failed) === 0);
  if (!restorationSafe) throw new Error('Full UAT native recorder restoration is missing or unsafe.');

  const truncatedCount = Number(nativeTrace.truncatedCount || 0);
  if (!Number.isFinite(truncatedCount) || truncatedCount !== 0) {
    throw new Error('Full UAT native trace is truncated.');
  }

  return {
    status: 'verified',
    expectedOperation: 'full-uat-native-write-trace',
    fullUatPassed,
    finalBaselinePassed,
    finalSaveConfirmed,
    cleanupSafe,
    deleteRequestObserved,
    deleteRequestType: DELETE_ROW_REQUEST_TYPE,
    deleteInfoHasVersionId,
    saveObserved,
    refreshGetObserved,
    sameMatrix,
    operationOrderValid,
    localMembershipRestored,
    localCardStayedClean,
    restorationSafe,
    storeRecordCount: records.filter(record => successfulRecord(record, 'store')).length,
    getRecordCount: records.filter(record => successfulRecord(record, 'get')).length,
    truncatedCount,
    passCount,
    failCount,
    notRunCount,
    seed: Number(uatReport.seed) >>> 0,
    capturedAt: uatReport.startedAt || nativeTrace.startedAt || null,
  };
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

export function makeFullUatNativeEvidenceAttestation({
  version,
  userscriptSource,
  uatReport,
  nativeTrace,
  uatEvidenceSha256,
  nativeTraceSha256,
}) {
  parseVersion(version);
  assertHash(uatEvidenceSha256, 'uatEvidenceSha256');
  assertHash(nativeTraceSha256, 'nativeTraceSha256');
  const validated = validateFullUatNativeEvidence(uatReport, nativeTrace);
  requireFullUatEvidence(validated);

  return {
    schemaVersion: 3,
    version: String(version),
    userscriptSha256: sha256(String(userscriptSource ?? '')),
    uatEvidenceSha256: String(uatEvidenceSha256).toLowerCase(),
    nativeTraceSha256: String(nativeTraceSha256).toLowerCase(),
    capturedAt: validated.capturedAt || null,
    status: 'verified',
    operation: 'full-uat-native-write-trace',
    seed: validated.seed,
    passCount: validated.passCount,
    failCount: 0,
    notRunCount: 0,
    fullUatPassed: true,
    finalBaselinePassed: true,
    finalSaveConfirmed: true,
    cleanupSafe: true,
    deleteRequestObserved: true,
    deleteRequestType: DELETE_ROW_REQUEST_TYPE,
    deleteInfoHasVersionId: true,
    saveObserved: true,
    refreshGetObserved: true,
    sameMatrix: true,
    operationOrderValid: true,
    localMembershipRestored: true,
    localCardStayedClean: true,
    restorationSafe: true,
    storeRecordCount: Number(validated.storeRecordCount || 0),
    getRecordCount: Number(validated.getRecordCount || 0),
    truncatedCount: 0,
  };
}

function assertSchema2ReleaseEvidence(attestation) {
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
  return {
    operation: 'delete-save-native-request',
    deleteEvidenceSha256: String(attestation.deleteEvidenceSha256).toLowerCase(),
    saveEvidenceSha256: String(attestation.saveEvidenceSha256).toLowerCase(),
  };
}

function assertSchema3ReleaseEvidence(attestation) {
  if (attestation.operation !== 'full-uat-native-write-trace') {
    throw new Error(`Full UAT evidence operation must be full-uat-native-write-trace, got ${attestation.operation || 'missing'}.`);
  }
  if (String(attestation.deleteRequestType || '').toLowerCase() !== DELETE_ROW_REQUEST_TYPE) {
    throw new Error(`Full UAT evidence has the wrong DeleteRow request type: ${attestation.deleteRequestType || 'missing'}.`);
  }
  const requiredTrue = [
    'fullUatPassed',
    'finalBaselinePassed',
    'finalSaveConfirmed',
    'cleanupSafe',
    'deleteRequestObserved',
    'deleteInfoHasVersionId',
    'saveObserved',
    'refreshGetObserved',
    'sameMatrix',
    'operationOrderValid',
    'localMembershipRestored',
    'localCardStayedClean',
    'restorationSafe',
  ];
  const missing = requiredTrue.filter(key => attestation[key] !== true);
  if (missing.length) throw new Error(`Full UAT attestation does not prove the required contract: ${missing.join(', ')}.`);
  if (Number(attestation.passCount || 0) <= 0 || Number(attestation.failCount || 0) !== 0 || Number(attestation.notRunCount || 0) !== 0) {
    throw new Error('Full UAT attestation must prove PASS > 0, FAIL = 0 and NOT_RUN = 0.');
  }
  if (Number(attestation.truncatedCount || 0) !== 0) throw new Error('Full UAT attestation reports truncated recorder data.');

  assertHash(attestation.uatEvidenceSha256, 'attestation.uatEvidenceSha256');
  assertHash(attestation.nativeTraceSha256, 'attestation.nativeTraceSha256');
  return {
    operation: 'full-uat-native-write-trace',
    schemaVersion: 3,
    uatEvidenceSha256: String(attestation.uatEvidenceSha256).toLowerCase(),
    nativeTraceSha256: String(attestation.nativeTraceSha256).toLowerCase(),
    seed: Number(attestation.seed) >>> 0,
  };
}

export function normalizeReportOnlyReleaseSource(input) {
  let source = String(input ?? '').replace(/\r\n/g, '\n');
  source = source.replace(/^\/\/ @version\s+[0-9.]+$/m, '// @version      <VERSION>');
  source = source.replace(/^(\s*)version:\s*'[0-9.]+'\s*,$/m, "$1version: '<VERSION>',");
  const marker = source.match(/  \/\/ REVIEWED_CHANGES_REPORT_V[123]\b/);
  if (!marker || marker.index === undefined) throw new Error('Report-only derivative source is missing a reviewed changes-report marker.');
  const start = marker.index;
  const end = source.indexOf('  function sanitizeFileName(value)', start);
  if (end < 0 || end <= start) throw new Error('Report-only derivative source has an invalid reviewed report surface.');
  return `${source.slice(0, start)}  // <REVIEWED_CHANGES_REPORT_SURFACE>\n${source.slice(end)}`;
}

function assertSchema4ReleaseEvidence(attestation, version, userscriptSource, parentUserscriptSource) {
  if (attestation.operation !== 'report-only-derivative') {
    throw new Error(`Report-only evidence operation must be report-only-derivative, got ${attestation.operation || 'missing'}.`);
  }
  if (attestation.allowedSurface !== 'changes-report-v3-and-version-metadata') {
    throw new Error(`Unsupported report-only derivative surface: ${attestation.allowedSurface || 'missing'}.`);
  }
  if (!parentUserscriptSource) {
    throw new Error('Report-only derivative evidence requires the exact live-tested parent userscript.');
  }
  const parentVersion = String(attestation.parentVersion || '');
  parseVersion(parentVersion);
  if (compareVersions(parentVersion, version) >= 0) {
    throw new Error(`Report-only derivative parent ${parentVersion} must be older than release ${version}.`);
  }
  assertHash(attestation.parentUserscriptSha256, 'attestation.parentUserscriptSha256');
  const actualParentSha256 = sha256(String(parentUserscriptSource));
  if (String(attestation.parentUserscriptSha256).toLowerCase() !== actualParentSha256) {
    throw new Error(`Report-only derivative parent SHA-256 ${attestation.parentUserscriptSha256} does not match supplied parent ${actualParentSha256}.`);
  }
  const parentLiveUat = attestation.parentLiveUat || {};
  if (canonical(parentLiveUat.status) !== 'passed'
      || Number(parentLiveUat.pass || 0) <= 0
      || Number(parentLiveUat.fail || 0) !== 0
      || Number(parentLiveUat.notRun || 0) !== 0) {
    throw new Error('Report-only derivative requires a parent with PASSED live UAT, FAIL = 0 and NOT_RUN = 0.');
  }
  const candidate = String(userscriptSource ?? '');
  if (!candidate.includes(`// @version      ${version}`) || !new RegExp(`version:\\s*'${String(version).replace(/\./g, '\\.')}'`).test(candidate)) {
    throw new Error(`Report-only derivative userscript metadata does not identify release ${version}.`);
  }
  if (!candidate.includes('REVIEWED_CHANGES_REPORT_V3')
      || !candidate.includes('TESSA_MATRIX_CHANGES_REPORT_V3')
      || !/reportOnly:\s*true/.test(candidate)) {
    throw new Error('Report-only derivative candidate must contain the reviewed V3 report-only implementation.');
  }
  if (candidate.includes('Детали изменений') || candidate.includes("['xl/worksheets/sheet2.xml', sheet2]")) {
    throw new Error('Report-only derivative candidate still contains the obsolete second changes-report sheet.');
  }
  const parentNormalized = normalizeReportOnlyReleaseSource(parentUserscriptSource);
  const candidateNormalized = normalizeReportOnlyReleaseSource(candidate);
  const parentNormalizedSha256 = sha256(parentNormalized);
  const candidateNormalizedSha256 = sha256(candidateNormalized);
  if (candidateNormalizedSha256 !== parentNormalizedSha256) {
    throw new Error('Report-only derivative changed code outside the reviewed report/version surface.');
  }
  return {
    operation: 'report-only-derivative',
    schemaVersion: 4,
    parentVersion,
    parentUserscriptSha256: actualParentSha256,
    parentSeed: Number(parentLiveUat.seed) >>> 0,
    normalizedNonReportSha256: candidateNormalizedSha256,
  };
}

function runTransform(root, target, relativeScript) {
  const script = path.join(root, relativeScript);
  const result = spawnSync(process.execPath, [script, target], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Failed to rebuild live-tested parent with ${relativeScript}: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
}

function buildRepositoryParentUserscript(parentVersion) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-report-parent-'));
  const target = path.join(tmp, 'tessa-matrix-studio.user.js');
  try {
    fs.copyFileSync(path.join(root, 'tessa-matrix-studio.user.js'), target);
    runTransform(root, target, 'hotfixes/malformed-range-diagnostic-transform.mjs');
    runTransform(root, target, 'hotfixes/v1.13.0-user-row-lifecycle-transform.mjs');
    let source = fs.readFileSync(target, 'utf8');
    source = source.replace(/^\/\/ @version\s+[0-9.]+$/m, `// @version      ${parentVersion}`);
    source = source.replace(/^(\s*)version:\s*'[0-9.]+'\s*,$/m, `$1version: '${parentVersion}',`);
    fs.writeFileSync(target, source, 'utf8');
    fs.appendFileSync(target, `\n${fs.readFileSync(path.join(root, 'hotfixes/interval-add-valid-fallback.js'), 'utf8')}\n`, 'utf8');
    runTransform(root, target, 'hotfixes/v1.13.0-full-uat-live-finalize.mjs');
    runTransform(root, target, 'hotfixes/v1.14-full-uat-inline-failures.mjs');
    runTransform(root, target, 'hotfixes/v1.14-live-uat-final-four.mjs');
    return fs.readFileSync(target, 'utf8');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function assertReleaseNativeEvidence({ version, userscriptSource, attestation, parentUserscriptSource = null }) {
  if (compareVersions(version, '1.12.2') < 0) {
    return { ok: true, skipped: true, version: String(version), reason: 'legacy-release-before-native-evidence-gate' };
  }

  if (!attestation || typeof attestation !== 'object') {
    throw new Error(`Native evidence attestation is required for release ${version}. Keep this build as RC until live TESSA evidence is verified.`);
  }
  if (![2, 3, 4].includes(Number(attestation.schemaVersion))) {
    throw new Error('Native evidence attestation schemaVersion must be 2, 3 or 4.');
  }
  if (String(attestation.version) !== String(version)) {
    throw new Error(`Native evidence attestation version ${attestation.version || 'missing'} does not match release ${version}.`);
  }
  if (attestation.status !== 'verified') throw new Error(`Native evidence attestation status must be verified, got ${attestation.status || 'missing'}.`);

  const schemaVersion = Number(attestation.schemaVersion);
  const actualUserscriptSha256 = sha256(String(userscriptSource ?? ''));
  if (schemaVersion === 4) {
    const evidence = assertSchema4ReleaseEvidence(attestation, version, userscriptSource, parentUserscriptSource);
    return {
      ok: true,
      skipped: false,
      version: String(version),
      userscriptSha256: actualUserscriptSha256,
      ...evidence,
    };
  }

  const evidence = schemaVersion === 3
    ? assertSchema3ReleaseEvidence(attestation)
    : assertSchema2ReleaseEvidence(attestation);

  assertHash(attestation.userscriptSha256, 'attestation.userscriptSha256');
  if (String(attestation.userscriptSha256).toLowerCase() !== actualUserscriptSha256) {
    throw new Error(`Native evidence attestation is stale: userscript SHA-256 ${attestation.userscriptSha256} does not match current source ${actualUserscriptSha256}.`);
  }

  return {
    ok: true,
    skipped: false,
    version: String(version),
    userscriptSha256: actualUserscriptSha256,
    ...evidence,
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
  const parentUserscriptSource = Number(attestation?.schemaVersion) === 4
    ? buildRepositoryParentUserscript(String(attestation.parentVersion || ''))
    : null;
  const result = assertReleaseNativeEvidence({ version, userscriptSource, attestation, parentUserscriptSource });
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
