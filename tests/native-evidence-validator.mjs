import { validateNativeEvidencePair } from '../tools/native-evidence-validator.mjs';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const member = id => ({ sectionRowId: `section-${id}`, rowRowID: id, rowID: `section-${id}` });
const membership = [member('version-a'), member('version-b')];

const deleteReport = {
  format: 'TESSA_NATIVE_OPERATION_RECORD_V1',
  studioVersion: '1.12.2',
  startedAt: '2026-09-09T09:51:58.090Z',
  finishedAt: '2026-09-09T09:52:03.433Z',
  beforeMembership: membership,
  afterMembership: membership,
  cardHasChangesAfterAction: false,
  surface: { matrixId: 'matrix-id', templateId: 'template-id' },
  records: [
    {
      method: 'request',
      requestType: 'd090417f-bf4b-45ed-9c82-33ef23acd96f',
      cardId: 'matrix-id',
      info: { MatrixRowVersionID: { __class__: '[REDACTED]', $__type: '[REDACTED]', $__value: '[REDACTED]' } },
      outcome: 'resolved',
      validationSuccessful: true,
    },
  ],
  restoration: { restored: 5, failed: 0 },
  truncatedCount: 0,
};

const saveReport = {
  format: 'TESSA_NATIVE_OPERATION_RECORD_V1',
  studioVersion: '1.12.2',
  startedAt: '2026-09-09T09:52:05.186Z',
  finishedAt: '2026-09-09T09:52:08.853Z',
  beforeMembership: membership,
  afterMembership: membership,
  cardHasChangesAfterAction: false,
  surface: { matrixId: 'matrix-id', templateId: 'template-id' },
  records: [
    {
      method: 'store', outcome: 'resolved', validationSuccessful: true,
      cardId: 'matrix-id', responseCardId: 'matrix-id', responseCardVersion: 38,
    },
    {
      method: 'get', outcome: 'resolved', validationSuccessful: true,
      cardId: 'matrix-id', responseCardId: 'matrix-id', responseCardVersion: null,
    },
  ],
  restoration: { restored: 5, failed: 0 },
  truncatedCount: 0,
};

const good = validateNativeEvidencePair(deleteReport, saveReport);
assert(good.status === 'verified', JSON.stringify(good));
assert(good.expectedOperation === 'delete-save-native-request', JSON.stringify(good));
assert(good.deleteVerified === true, JSON.stringify(good));
assert(good.deleteRequestObserved === true, JSON.stringify(good));
assert(good.deleteRequestType === 'd090417f-bf4b-45ed-9c82-33ef23acd96f', JSON.stringify(good));
assert(good.deleteInfoHasVersionId === true, JSON.stringify(good));
assert(good.localMembershipStayedStable === true, JSON.stringify(good));
assert(good.localCardStayedCleanAfterDelete === true, JSON.stringify(good));
assert(good.saveObserved === true && good.storeRecordCount === 1, JSON.stringify(good));
assert(good.refreshGetObserved === true, JSON.stringify(good));
assert(good.sameMatrix === true, JSON.stringify(good));
assert(good.operationOrderValid === true, JSON.stringify(good));
assert(good.restorationSafe === true && good.truncatedCount === 0, JSON.stringify(good));

const wrongDeleteType = validateNativeEvidencePair({
  ...deleteReport,
  records: [{ ...deleteReport.records[0], requestType: '00000000-0000-0000-0000-000000000000' }],
}, saveReport);
assert(wrongDeleteType.status === 'divergent', JSON.stringify(wrongDeleteType));
assert(wrongDeleteType.reasonCodes.includes('native-delete-request-not-observed'), JSON.stringify(wrongDeleteType));

const missingVersionInfo = validateNativeEvidencePair({
  ...deleteReport,
  records: [{ ...deleteReport.records[0], info: {} }],
}, saveReport);
assert(missingVersionInfo.status === 'divergent', JSON.stringify(missingVersionInfo));
assert(missingVersionInfo.reasonCodes.includes('delete-version-id-not-observed'), JSON.stringify(missingVersionInfo));

const noStore = validateNativeEvidencePair(deleteReport, { ...saveReport, records: saveReport.records.filter(item => item.method !== 'store') });
assert(noStore.status === 'incomplete', JSON.stringify(noStore));
assert(noStore.reasonCodes.includes('store-not-observed'), JSON.stringify(noStore));

const otherMatrix = validateNativeEvidencePair(deleteReport, {
  ...saveReport,
  surface: { ...saveReport.surface, matrixId: 'other-matrix' },
  records: saveReport.records.map(item => ({ ...item, cardId: 'other-matrix', responseCardId: 'other-matrix' })),
});
assert(otherMatrix.status === 'divergent', JSON.stringify(otherMatrix));
assert(otherMatrix.reasonCodes.includes('matrix-mismatch'), JSON.stringify(otherMatrix));

const unsafeRestore = validateNativeEvidencePair({ ...deleteReport, restoration: { restored: 4, failed: 1 } }, saveReport);
assert(unsafeRestore.status === 'unsafe', JSON.stringify(unsafeRestore));
assert(unsafeRestore.reasonCodes.includes('recorder-restore-failed'), JSON.stringify(unsafeRestore));

const truncated = validateNativeEvidencePair({ ...deleteReport, truncatedCount: 1 }, saveReport);
assert(truncated.status === 'incomplete', JSON.stringify(truncated));
assert(truncated.reasonCodes.includes('recorder-truncated'), JSON.stringify(truncated));

console.log('Native TESSA evidence validator: split DeleteRow request + Save Store/Get contract: OK');
