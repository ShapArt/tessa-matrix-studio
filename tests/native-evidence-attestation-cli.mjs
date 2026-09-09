import crypto from 'node:crypto';
import { createNativeEvidenceAttestation } from '../tools/create-native-evidence-attestation.mjs';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

const matrixId = 'f5ec6fe5-55ce-49a7-9fdd-f24a6e7c11cb';
const deleteBytes = Buffer.from('{"delete":"evidence"}\n');
const saveBytes = Buffer.from('{"save":"evidence"}\n');
const userscriptSource = '// @version      1.12.3\n(function(){})();\n';

const deleteReport = {
  format: 'TESSA_NATIVE_OPERATION_RECORD_V1',
  startedAt: '2026-09-09T09:51:58.090Z',
  finishedAt: '2026-09-09T09:52:03.433Z',
  surface: { matrixId },
  beforeMembership: [{ rowRowID: 'row-a' }, { rowRowID: 'row-b' }],
  afterMembership: [{ rowRowID: 'row-a' }, { rowRowID: 'row-b' }],
  cardHasChangesAfterAction: false,
  truncatedCount: 0,
  restoration: { restored: 5, failed: 0 },
  records: [{
    method: 'request',
    outcome: 'resolved',
    requestType: 'd090417f-bf4b-45ed-9c82-33ef23acd96f',
    validationSuccessful: true,
    cardId: matrixId,
    info: { MatrixRowVersionID: { $__value: '[REDACTED]' } },
  }],
};

const saveReport = {
  format: 'TESSA_NATIVE_OPERATION_RECORD_V1',
  startedAt: '2026-09-09T09:52:05.186Z',
  finishedAt: '2026-09-09T09:52:08.853Z',
  surface: { matrixId },
  beforeMembership: [{ rowRowID: 'row-a' }, { rowRowID: 'row-b' }],
  afterMembership: [{ rowRowID: 'row-a' }, { rowRowID: 'row-b' }],
  cardHasChangesAfterAction: false,
  truncatedCount: 0,
  restoration: { restored: 5, failed: 0 },
  records: [
    { method: 'store', outcome: 'resolved', validationSuccessful: true, cardId: matrixId, responseCardId: matrixId },
    { method: 'get', outcome: 'resolved', validationSuccessful: true, cardId: matrixId, responseCardId: matrixId },
  ],
};

const attestation = createNativeEvidenceAttestation({
  version: '1.12.3',
  userscriptSource,
  deleteReport,
  saveReport,
  deleteEvidenceBytes: deleteBytes,
  saveEvidenceBytes: saveBytes,
});

assert(attestation.status === 'verified', JSON.stringify(attestation));
assert(attestation.operation === 'delete-save-native-request', JSON.stringify(attestation));
assert(attestation.userscriptSha256 === sha256(userscriptSource), JSON.stringify(attestation));
assert(attestation.deleteEvidenceSha256 === sha256(deleteBytes), JSON.stringify(attestation));
assert(attestation.saveEvidenceSha256 === sha256(saveBytes), JSON.stringify(attestation));
assert(attestation.deleteRequestType === 'd090417f-bf4b-45ed-9c82-33ef23acd96f', JSON.stringify(attestation));
assert(attestation.truncatedCount === 0, JSON.stringify(attestation));

console.log('Native evidence attestation creator: exact candidate hash + evidence hashes: OK');
