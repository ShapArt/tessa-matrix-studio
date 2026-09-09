import { validateNativeEvidence } from '../tools/native-evidence-validator.mjs';

const assert = (condition, message) => { if (!condition) throw new Error(message); };

const member = id => ({ sectionRowId: `section-${id}`, rowRowID: id, rowID: null });
const base = {
  format: 'TESSA_NATIVE_OPERATION_RECORD_V1',
  studioVersion: '1.12.2',
  beforeMembership: [member('version-a'), member('version-b')],
  afterMembership: [member('version-b')],
  records: [
    { method: 'store', outcome: 'resolved', validationSuccessful: true, responseCardId: 'matrix-id', responseCardVersion: 9 },
  ],
  restoration: { restored: 2, failed: 0 },
  truncatedCount: 0,
};

const good = validateNativeEvidence(base, { expectedOperation: 'delete-save', expectedRemovedCount: 1 });
assert(good.status === 'verified', JSON.stringify(good));
assert(good.deleteVerified === true, JSON.stringify(good));
assert(good.saveObserved === true, JSON.stringify(good));
assert(good.removedVersions.length === 1 && good.removedVersions[0] === 'version-a', JSON.stringify(good));
assert(good.unexpectedAddedVersions.length === 0, JSON.stringify(good));
assert(good.restorationSafe === true, JSON.stringify(good));

const noDelete = validateNativeEvidence({ ...base, afterMembership: base.beforeMembership }, { expectedOperation: 'delete-save', expectedRemovedCount: 1 });
assert(noDelete.status === 'divergent', JSON.stringify(noDelete));
assert(noDelete.deleteVerified === false, JSON.stringify(noDelete));
assert(noDelete.reasonCodes.includes('expected-delete-not-observed'), JSON.stringify(noDelete));

const noStore = validateNativeEvidence({ ...base, records: [] }, { expectedOperation: 'delete-save', expectedRemovedCount: 1 });
assert(noStore.status === 'incomplete', JSON.stringify(noStore));
assert(noStore.saveObserved === false, JSON.stringify(noStore));
assert(noStore.reasonCodes.includes('store-not-observed'), JSON.stringify(noStore));

const unsafeRestore = validateNativeEvidence({ ...base, restoration: { restored: 1, failed: 1 } }, { expectedOperation: 'delete-save', expectedRemovedCount: 1 });
assert(unsafeRestore.status === 'unsafe', JSON.stringify(unsafeRestore));
assert(unsafeRestore.reasonCodes.includes('recorder-restore-failed'), JSON.stringify(unsafeRestore));

const unexpectedAdd = validateNativeEvidence({ ...base, afterMembership: [member('version-b'), member('version-c')] }, { expectedOperation: 'delete-save', expectedRemovedCount: 1 });
assert(unexpectedAdd.status === 'divergent', JSON.stringify(unexpectedAdd));
assert(unexpectedAdd.reasonCodes.includes('unexpected-membership-add'), JSON.stringify(unexpectedAdd));

const truncated = validateNativeEvidence({ ...base, truncatedCount: 3 }, { expectedOperation: 'delete-save', expectedRemovedCount: 1 });
assert(truncated.status === 'incomplete', JSON.stringify(truncated));
assert(truncated.reasonCodes.includes('recorder-truncated'), JSON.stringify(truncated));

console.log('Native TESSA evidence validator: DELETE + SAVE proof semantics: OK');
