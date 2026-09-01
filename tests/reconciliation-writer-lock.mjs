import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = {
  body: { innerText: '' },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ click() {}, style: {}, set href(_) {}, set download(_) {} }),
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.runReconciliationRead === 'function', 'runReconciliationRead is missing');

const O = E.constants.OPERAND;
const structure = {
  templateId: 'reconcile-template',
  conditions: [{ criterionRowId: 'criterion-org', criterionName: 'Организация', operandTypeId: O.ReferenceGuid }],
  functions: [],
};
const row = {
  rowCardId: 'card-1',
  versionId: 'version-1',
  values: { 'criterion-org': [{ id: 'org-1', display: 'Организация 1', kind: 'ReferenceGuid' }] },
  roles: {},
};
const receiptContext = {
  matrixId: 'matrix-1',
  templateId: structure.templateId,
  receipts: [{
    type: 'update', excelRow: 15, rowCardId: row.rowCardId, versionId: row.versionId,
    expectedSemanticKey: E.reconciliationSemanticKey(row, structure),
  }],
};

let attempts = 0;
const retryFactory = async () => ({
  requestStructure: async templateId => {
    assert(templateId === structure.templateId, `unexpected template ${templateId}`);
    return structure;
  },
  loadSnapshot: async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('MatrixRow.WriteHeartbit ObtainWriterLock');
    return { matrixId: receiptContext.matrixId, templateId: structure.templateId, rows: [row] };
  },
});
const retried = await E.runReconciliationRead(retryFactory, receiptContext, { attempts: 3, baseDelayMs: 0 });
assert(attempts === 3, `writer-lock should retry exactly 3 attempts, got ${attempts}`);
assert(retried.attempts === 3 && retried.status === 'verified', JSON.stringify(retried));
assert(retried.retryable === false, JSON.stringify(retried));

let permissionAttempts = 0;
const permissionFactory = async () => ({
  requestStructure: async () => structure,
  loadSnapshot: async () => {
    permissionAttempts += 1;
    throw new Error('permission denied: secret internal detail');
  },
});
const denied = await E.runReconciliationRead(permissionFactory, receiptContext, { attempts: 5, baseDelayMs: 0 });
assert(permissionAttempts === 1, `non-writer-lock error must not retry, got ${permissionAttempts}`);
assert(denied.status === 'incomplete' && denied.attempts === 1 && denied.retryable === false, JSON.stringify(denied));
assert(denied.reasonCode === 'reconcile-read-failed', JSON.stringify(denied));
assert(!JSON.stringify(denied).includes('secret internal detail'), `technical error leaked into result: ${JSON.stringify(denied)}`);

console.log('TESSA Matrix Studio reconciliation writer-lock retry contract: OK');
