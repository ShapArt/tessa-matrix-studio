import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DELETE_ROW_REQUEST_TYPE = 'd090417f-bf4b-45ed-9c82-33ef23acd96f';
const canonical = value => String(value ?? '').trim().toLowerCase();

function membershipKey(row) {
  return canonical(row?.rowRowID || row?.versionId || row?.sectionRowId || row?.rowID || '');
}

function membershipKeys(rows) {
  return [...new Set((Array.isArray(rows) ? rows : []).map(membershipKey).filter(Boolean))].sort();
}

function sameStringArray(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function finiteNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function validReport(report) {
  return Boolean(report && typeof report === 'object' && report.format === 'TESSA_NATIVE_OPERATION_RECORD_V1');
}

function successfulRecord(record, method) {
  return canonical(record?.method) === canonical(method)
    && canonical(record?.outcome) === 'resolved'
    && record?.validationSuccessful !== false;
}

function matrixIdOf(report) {
  const surfaceId = canonical(report?.surface?.matrixId);
  if (surfaceId) return surfaceId;
  const records = Array.isArray(report?.records) ? report.records : [];
  for (const record of records) {
    const id = canonical(record?.cardId || record?.responseCardId);
    if (id) return id;
  }
  return '';
}

function restorationSafe(report) {
  const restoration = report?.restoration;
  return Boolean(restoration
    && Number.isFinite(Number(restoration.failed))
    && Number(restoration.failed) === 0);
}

export function validateNativeEvidencePair(deleteReport, saveReport) {
  const reasonCodes = [];
  const expectedOperation = 'delete-save-native-request';

  if (!validReport(deleteReport) || !validReport(saveReport)) {
    return {
      status: 'invalid',
      expectedOperation,
      deleteVerified: false,
      deleteRequestObserved: false,
      deleteRequestType: DELETE_ROW_REQUEST_TYPE,
      deleteInfoHasVersionId: false,
      localMembershipStayedStable: false,
      localCardStayedCleanAfterDelete: false,
      saveObserved: false,
      refreshGetObserved: false,
      sameMatrix: false,
      operationOrderValid: false,
      restorationSafe: false,
      storeRecordCount: 0,
      truncatedCount: 0,
      reasonCodes: ['invalid-native-evidence-format'],
    };
  }

  const deleteRecords = Array.isArray(deleteReport.records) ? deleteReport.records : [];
  const saveRecords = Array.isArray(saveReport.records) ? saveReport.records : [];
  const deleteRequest = deleteRecords.find(record =>
    successfulRecord(record, 'request')
    && canonical(record?.requestType) === DELETE_ROW_REQUEST_TYPE
  ) || null;
  const deleteRequestObserved = Boolean(deleteRequest);
  const deleteInfoHasVersionId = Boolean(deleteRequest?.info
    && Object.prototype.hasOwnProperty.call(deleteRequest.info, 'MatrixRowVersionID'));

  const deleteBefore = membershipKeys(deleteReport.beforeMembership);
  const deleteAfter = membershipKeys(deleteReport.afterMembership);
  const localMembershipStayedStable = sameStringArray(deleteBefore, deleteAfter);
  const localCardStayedCleanAfterDelete = deleteReport.cardHasChangesAfterAction === false;

  const stores = saveRecords.filter(record => successfulRecord(record, 'store'));
  const gets = saveRecords.filter(record => successfulRecord(record, 'get'));
  const saveObserved = stores.length > 0;
  const refreshGetObserved = gets.length > 0;

  const deleteMatrixId = matrixIdOf(deleteReport);
  const saveMatrixId = matrixIdOf(saveReport);
  const sameMatrix = Boolean(deleteMatrixId && saveMatrixId && deleteMatrixId === saveMatrixId);

  const deleteFinished = Date.parse(deleteReport.finishedAt || '');
  const saveStarted = Date.parse(saveReport.startedAt || '');
  const operationOrderValid = Number.isFinite(deleteFinished) && Number.isFinite(saveStarted)
    ? deleteFinished <= saveStarted
    : true;

  const restorationIsSafe = restorationSafe(deleteReport) && restorationSafe(saveReport);
  const truncatedCount = finiteNonNegative(deleteReport.truncatedCount) + finiteNonNegative(saveReport.truncatedCount);
  const deleteVerified = deleteRequestObserved
    && deleteInfoHasVersionId
    && localMembershipStayedStable
    && localCardStayedCleanAfterDelete;

  if (!deleteRequestObserved) reasonCodes.push('native-delete-request-not-observed');
  if (deleteRequestObserved && !deleteInfoHasVersionId) reasonCodes.push('delete-version-id-not-observed');
  if (!localMembershipStayedStable) reasonCodes.push('delete-mutated-local-membership');
  if (!localCardStayedCleanAfterDelete) reasonCodes.push('delete-left-local-card-dirty');
  if (!saveObserved) reasonCodes.push('store-not-observed');
  if (!refreshGetObserved) reasonCodes.push('post-save-get-not-observed');
  if (!sameMatrix) reasonCodes.push('matrix-mismatch');
  if (!operationOrderValid) reasonCodes.push('operation-order-invalid');
  if (!restorationIsSafe) reasonCodes.push('recorder-restore-failed');
  if (truncatedCount > 0) reasonCodes.push('recorder-truncated');

  let status = 'verified';
  if (!restorationIsSafe) status = 'unsafe';
  else if (!deleteVerified || !sameMatrix || !operationOrderValid) status = 'divergent';
  else if (!saveObserved || !refreshGetObserved || truncatedCount > 0) status = 'incomplete';

  return {
    status,
    expectedOperation,
    deleteVerified,
    deleteRequestObserved,
    deleteRequestType: DELETE_ROW_REQUEST_TYPE,
    deleteInfoHasVersionId,
    localMembershipStayedStable,
    localCardStayedCleanAfterDelete,
    saveObserved,
    refreshGetObserved,
    sameMatrix,
    operationOrderValid,
    restorationSafe: restorationIsSafe,
    storeRecordCount: stores.length,
    getRecordCount: gets.length,
    truncatedCount,
    reasonCodes,
  };
}

// Backward-compatible export name for callers that can already provide a pair.
export function validateNativeEvidence(deleteReport, options = {}) {
  if (options?.saveReport) return validateNativeEvidencePair(deleteReport, options.saveReport);
  return {
    status: 'incomplete',
    expectedOperation: 'delete-save-native-request',
    deleteVerified: false,
    saveObserved: false,
    restorationSafe: restorationSafe(deleteReport),
    truncatedCount: finiteNonNegative(deleteReport?.truncatedCount),
    reasonCodes: ['split-native-evidence-required'],
  };
}

function parseCli(argv) {
  const deleteFile = argv[0];
  const saveFile = argv[1];
  if (!deleteFile || !saveFile) {
    throw new Error('Usage: node tools/native-evidence-validator.mjs <TESSA_Native_Delete.json> <TESSA_Native_Save.json>');
  }
  return { deleteFile, saveFile };
}

function exitCode(status) {
  if (status === 'verified') return 0;
  if (status === 'incomplete') return 2;
  if (status === 'divergent') return 3;
  return 4;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath = path.resolve(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  try {
    const cli = parseCli(process.argv.slice(2));
    const deleteReport = JSON.parse(fs.readFileSync(path.resolve(cli.deleteFile), 'utf8'));
    const saveReport = JSON.parse(fs.readFileSync(path.resolve(cli.saveFile), 'utf8'));
    const result = validateNativeEvidencePair(deleteReport, saveReport);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = exitCode(result.status);
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 4;
  }
}
