import crypto from 'node:crypto';
import {
  assertReleaseNativeEvidence,
  makeNativeEvidenceAttestation,
  validateFullUatNativeEvidence,
  makeFullUatNativeEvidenceAttestation,
} from '../tools/release-native-evidence-gate.mjs';

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

// v1.14 Full UAT records the whole destructive phase in one native recorder window.
// This is stronger than two manually split recordings, but it must still prove the same
// native DELETE -> final Save -> refresh ordering and bind the exact release userscript.
const v14Source = '// @version      1.14.0\n(function(){})();\n';
const v14Sha256 = crypto.createHash('sha256').update(v14Source).digest('hex');
const uatReport = {
  format: 'TESSA_FULL_UAT_V1',
  studioVersion: '1.14.0',
  status: 'PASSED',
  seed: 3439503818,
  startedAt: '2026-09-15T10:50:00.000Z',
  finishedAt: '2026-09-15T10:53:16.155Z',
  matrix: { matrixId: '11111111-2222-3333-4444-555555555555' },
  writesAttempted: 8,
  writesCompleted: 8,
  finalMatrixSave: { ok: true, method: 'editor-save' },
  checks: [
    { id: 'write-add-delete', status: 'PASS', required: true },
    { id: 'write-update-delete', status: 'PASS', required: true },
    { id: 'write-every-field', status: 'PASS', required: true },
    { id: 'write-clear-delete', status: 'PASS', required: true },
    { id: 'final-baseline', status: 'PASS', required: true },
  ],
  failedChecks: [],
  functionalActionAudit: { missing: [] },
  summary: {
    pass: 33,
    fail: 0,
    warn: 0,
    notRun: 0,
    writesAttempted: 8,
    writesCompleted: 8,
    cleanupFailed: 0,
    cleanupLedgerPending: 0,
    cleanupLedgerFailed: 0,
    restoreStatus: 'VERIFIED',
  },
};
const nativeTrace = {
  format: 'TESSA_NATIVE_OPERATION_RECORD_V1',
  studioVersion: '1.14.0',
  startedAt: '2026-09-15T10:50:10.000Z',
  finishedAt: '2026-09-15T10:53:15.000Z',
  beforeMembership: [{ rowRowID: 'row-a' }, { rowRowID: 'row-b' }],
  afterMembership: [{ rowRowID: 'row-b' }, { rowRowID: 'row-a' }],
  cardHasChangesAfterAction: false,
  surface: { matrixId: '11111111-2222-3333-4444-555555555555' },
  restoration: { failed: 0 },
  truncatedCount: 0,
  records: [
    {
      at: '2026-09-15T10:51:00.000Z', method: 'request', outcome: 'resolved', validationSuccessful: true,
      requestType: 'd090417f-bf4b-45ed-9c82-33ef23acd96f', cardId: 'row-card-id',
      info: { MatrixRowVersionID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    },
    {
      at: '2026-09-15T10:53:10.000Z', method: 'store', outcome: 'resolved', validationSuccessful: true,
      cardId: '11111111-2222-3333-4444-555555555555',
    },
    {
      at: '2026-09-15T10:53:11.000Z', method: 'get', outcome: 'resolved', validationSuccessful: true,
      cardId: '11111111-2222-3333-4444-555555555555',
    },
  ],
};

const fullUatValidated = validateFullUatNativeEvidence(uatReport, nativeTrace);
assert(fullUatValidated.status === 'verified', JSON.stringify(fullUatValidated));
assert(fullUatValidated.fullUatPassed === true, JSON.stringify(fullUatValidated));
assert(fullUatValidated.finalBaselinePassed === true, JSON.stringify(fullUatValidated));
assert(fullUatValidated.finalSaveConfirmed === true, JSON.stringify(fullUatValidated));
assert(fullUatValidated.deleteRequestObserved === true, JSON.stringify(fullUatValidated));
assert(fullUatValidated.deleteInfoHasVersionId === true, JSON.stringify(fullUatValidated));
assert(fullUatValidated.saveObserved === true && fullUatValidated.refreshGetObserved === true, JSON.stringify(fullUatValidated));
assert(fullUatValidated.operationOrderValid === true, JSON.stringify(fullUatValidated));
assert(fullUatValidated.localMembershipRestored === true, JSON.stringify(fullUatValidated));
assert(fullUatValidated.localCardStayedClean === true, JSON.stringify(fullUatValidated));
assert(fullUatValidated.restorationSafe === true && fullUatValidated.truncatedCount === 0, JSON.stringify(fullUatValidated));

const uatBytes = Buffer.from(JSON.stringify(uatReport));
const traceBytes = Buffer.from(JSON.stringify(nativeTrace));
const fullUatAttestation = makeFullUatNativeEvidenceAttestation({
  version: '1.14.0',
  userscriptSource: v14Source,
  uatReport,
  nativeTrace,
  uatEvidenceSha256: crypto.createHash('sha256').update(uatBytes).digest('hex'),
  nativeTraceSha256: crypto.createHash('sha256').update(traceBytes).digest('hex'),
});
assert(fullUatAttestation.schemaVersion === 3, JSON.stringify(fullUatAttestation));
assert(fullUatAttestation.version === '1.14.0', JSON.stringify(fullUatAttestation));
assert(fullUatAttestation.userscriptSha256 === v14Sha256, JSON.stringify(fullUatAttestation));
assert(fullUatAttestation.operation === 'full-uat-native-write-trace', JSON.stringify(fullUatAttestation));
assert(fullUatAttestation.seed === 3439503818, JSON.stringify(fullUatAttestation));
assert(fullUatAttestation.passCount === 33 && fullUatAttestation.failCount === 0 && fullUatAttestation.notRunCount === 0, JSON.stringify(fullUatAttestation));

const fullUatAccepted = assertReleaseNativeEvidence({ version: '1.14.0', userscriptSource: v14Source, attestation: fullUatAttestation });
assert(fullUatAccepted.ok === true && fullUatAccepted.schemaVersion === 3, JSON.stringify(fullUatAccepted));
assert(fullUatAccepted.operation === 'full-uat-native-write-trace', JSON.stringify(fullUatAccepted));

let fullUatNotRunBlocked = false;
try {
  validateFullUatNativeEvidence({ ...uatReport, summary: { ...uatReport.summary, notRun: 1 } }, nativeTrace);
} catch (error) {
  fullUatNotRunBlocked = /not.?run|full uat|pass/i.test(String(error?.message || error));
}
assert(fullUatNotRunBlocked, 'Full UAT evidence with NOT_RUN checks must be rejected');

let orderingBlocked = false;
try {
  validateFullUatNativeEvidence(uatReport, {
    ...nativeTrace,
    records: [nativeTrace.records[1], nativeTrace.records[2], nativeTrace.records[0]],
  });
} catch (error) {
  orderingBlocked = /order|delete|store|save|get/i.test(String(error?.message || error));
}
assert(orderingBlocked, 'Full UAT native evidence must prove DELETE -> Store -> Get ordering');

let fullUatStaleBlocked = false;
try {
  assertReleaseNativeEvidence({ version: '1.14.0', userscriptSource: `${v14Source}// changed`, attestation: fullUatAttestation });
} catch (error) {
  fullUatStaleBlocked = /sha|source|userscript|stale/i.test(String(error?.message || error));
}
assert(fullUatStaleBlocked, 'Full UAT attestation for a different userscript must be rejected');

// A report-only patch may inherit native write evidence only when the exact tested parent
// can be supplied and the candidate differs exclusively inside the reviewed report surface
// plus version metadata. This must never be a generic bypass for write-path changes.
const reportParentSource = `// @version      1.14.0
(function(){
  const CONFIG = {
    version: '1.14.0',
  };
  // REVIEWED_CHANGES_REPORT_V1
  function buildChangesReportModel() { return { format: 'TESSA_MATRIX_CHANGES_REPORT_V1', reportOnly: true }; }
  function changesReportStylesXml() { return ''; }
  function changesReportRowStyle() { return 1; }
  function changesReportWorksheetXml() { return ''; }
  async function createChangesReportXlsxBytes() { return new Uint8Array(); }
  function sanitizeFileName(value) { return String(value); }
  function writeCriticalPath() { return 'unchanged'; }
})();
`;
const reportCandidateSource = `// @version      1.14.1
(function(){
  const CONFIG = {
    version: '1.14.1',
  };
  // REVIEWED_CHANGES_REPORT_V3
  function buildChangesReportModel() {
    const detailHeaders = ['Действие', 'Строка Excel', 'Строка TESSA', 'Поле', 'Было', 'Стало'];
    const actionLabel = type => ({ update: 'Изменена', add: 'Добавлена', delete: 'Удалена' }[type]);
    return { format: 'TESSA_MATRIX_CHANGES_REPORT_V3', reportOnly: true, detailHeaders, actionLabel };
  }
  function changesReportStylesXml() { return '<styles />'; }
  function changesReportRowStyle() { return 4; }
  function changesReportWorksheetXml() { return '<sheet />'; }
  async function createChangesReportXlsxBytes() { return new Uint8Array([1]); }
  function sanitizeFileName(value) { return String(value); }
  function writeCriticalPath() { return 'unchanged'; }
})();
`;
const reportDerivativeAttestation = {
  schemaVersion: 4,
  version: '1.14.1',
  status: 'verified',
  operation: 'report-only-derivative',
  parentVersion: '1.14.0',
  parentUserscriptSha256: crypto.createHash('sha256').update(reportParentSource).digest('hex'),
  allowedSurface: 'changes-report-v3-and-version-metadata',
  parentLiveUat: { status: 'PASSED', pass: 33, fail: 0, notRun: 0, seed: 3439503818 },
};
const reportDerivativeAccepted = assertReleaseNativeEvidence({
  version: '1.14.1',
  userscriptSource: reportCandidateSource,
  parentUserscriptSource: reportParentSource,
  attestation: reportDerivativeAttestation,
});
assert(reportDerivativeAccepted.ok === true && reportDerivativeAccepted.schemaVersion === 4, JSON.stringify(reportDerivativeAccepted));
assert(reportDerivativeAccepted.operation === 'report-only-derivative', JSON.stringify(reportDerivativeAccepted));
assert(reportDerivativeAccepted.parentVersion === '1.14.0', JSON.stringify(reportDerivativeAccepted));

let reportDerivativeWriteChangeBlocked = false;
try {
  assertReleaseNativeEvidence({
    version: '1.14.1',
    userscriptSource: reportCandidateSource.replace("return 'unchanged';", "return 'CHANGED';"),
    parentUserscriptSource: reportParentSource,
    attestation: reportDerivativeAttestation,
  });
} catch (error) {
  reportDerivativeWriteChangeBlocked = /report.?only|surface|derivative|outside|parent/i.test(String(error?.message || error));
}
assert(reportDerivativeWriteChangeBlocked, 'report-only derivative must reject any change outside the report/version surface');

let reportDerivativeWrongParentBlocked = false;
try {
  assertReleaseNativeEvidence({
    version: '1.14.1',
    userscriptSource: reportCandidateSource,
    parentUserscriptSource: `${reportParentSource}// tampered parent`,
    attestation: reportDerivativeAttestation,
  });
} catch (error) {
  reportDerivativeWrongParentBlocked = /parent|sha|hash|evidence/i.test(String(error?.message || error));
}
assert(reportDerivativeWrongParentBlocked, 'report-only derivative must reject a parent that does not match the attested live-tested hash');

console.log('Release native-evidence gate: v2 split + v3 Full UAT + v4 report-only derivative parity: OK');
