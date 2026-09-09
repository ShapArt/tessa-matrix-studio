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
  body: { innerText: 'Завершить редактирование и разблокировать' },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ click() {}, style: {}, set href(_) {}, set download(_) {} }),
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.refreshNativeMatrixViewAfterApply === 'function', 'refreshNativeMatrixViewAfterApply is missing');
assert(typeof E.isWriterLockError === 'function', 'isWriterLockError is missing');
assert(typeof E.persistMainMatrixAfterApply === 'function', 'persistMainMatrixAfterApply is missing');
assert(typeof E.TessaBridge.prototype.saveMainMatrixAfterApply === 'function', 'saveMainMatrixAfterApply is missing');

let calls = 0;
const transientBridge = {
  refreshNativeMatrixView: async () => {
    calls += 1;
    if (calls < 3) throw new Error('Request failed 400: ObtainWriterLock for MatrixRow.WriteHeartbit fail');
    return { ok: true, controlName: 'TestMatrixView', page: 2 };
  },
};
const recovered = await E.refreshNativeMatrixViewAfterApply(transientBridge, { attempts: 3, baseDelayMs: 0 });
assert(recovered.ok === true, `writer-lock retry should recover: ${JSON.stringify(recovered)}`);
assert(calls === 3, `writer-lock retry should use all 3 attempts, got ${calls}`);
assert(recovered.controlName === 'TestMatrixView', `view identity should be preserved: ${JSON.stringify(recovered)}`);

calls = 0;
const permanentBridge = {
  refreshNativeMatrixView: async () => {
    calls += 1;
    throw new Error('Unexpected server validation error');
  },
};
const failed = await E.refreshNativeMatrixViewAfterApply(permanentBridge, { attempts: 4, baseDelayMs: 0 });
assert(failed.ok === false, `non-lock refresh failure should return ok=false: ${JSON.stringify(failed)}`);
assert(calls === 1, `non-lock refresh failure must not retry blindly, got ${calls}`);

assert(E.isWriterLockError(new Error('CardIsLockedByWriterWhileReading')) === true, 'writer lock validation key must be recognized');
assert(E.isWriterLockError(new Error('MatrixRow.WriteHeartbit ObtainWriterLock fail')) === true, 'WriteHeartbit lock must be recognized');
assert(E.isWriterLockError(new Error('permission denied')) === false, 'unrelated errors must not look like writer locks');

// The native view itself should refresh without editor.refreshCard(). Use the
// TessaBridge prototype against a tiny fake object so this test also guards the
// low-level bridge contract.
let viewRefreshCalls = 0;
let cardRefreshCalls = 0;
const fakeTarget = {
  currentPage: 3,
  refresh: async () => { viewRefreshCalls += 1; },
};
const fakeBridge = {
  editor: { refreshCard: async () => { cardRefreshCalls += 1; } },
  findNativeMatrixControl: () => ({ controlName: 'TestMatrixView', target: fakeTarget, rows: [{}] }),
  nativePagingInfo: () => ({ currentPage: 3, pageCount: 4 }),
};
const lowLevel = await E.TessaBridge.prototype.refreshNativeMatrixView.call(fakeBridge);
assert(lowLevel?.ok === true, `native view refresh should succeed: ${JSON.stringify(lowLevel)}`);
assert(viewRefreshCalls === 1, `native view refresh expected once, got ${viewRefreshCalls}`);
assert(cardRefreshCalls === 0, `native refresh must never call editor.refreshCard(), got ${cardRefreshCalls}`);

// Row CardStore/Delete requests are not the same operation as pressing Save on the
// matrix card. After at least one accepted mutation Studio must perform one explicit
// force-transaction Store of the MAIN matrix card. The payload must be a clone reduced
// to changed data so a stale open card can never overwrite unrelated fields.
let cloneCalls = 0;
let trimCalls = 0;
let cleanCalls = 0;
let matrixStoreCalls = 0;
let storedRequest = null;
const reducedMainCard = {
  removeAllButChanged() { trimCalls += 1; },
  clean() { cleanCalls += 1; },
};
class FakeCardStoreRequest {
  constructor() {
    this.forceTransaction = false;
    this.card = null;
  }
}
const matrixSaveBridge = {
  cards: { CardStoreRequest: FakeCardStoreRequest },
  mainCard: {
    id: 'matrix-1',
    clone() { cloneCalls += 1; return reducedMainCard; },
  },
  cardService: {
    store: async request => {
      matrixStoreCalls += 1;
      storedRequest = request;
      return { validationResult: { isSuccessful: true }, cardId: 'matrix-1', cardVersion: 17 };
    },
  },
  validationError: () => null,
};
const matrixSave = await E.TessaBridge.prototype.saveMainMatrixAfterApply.call(matrixSaveBridge);
assert(matrixSave?.ok === true, JSON.stringify(matrixSave));
assert(cloneCalls === 1 && trimCalls === 1 && cleanCalls === 1, `main card must be cloned/reduced/cleaned: ${cloneCalls}/${trimCalls}/${cleanCalls}`);
assert(matrixStoreCalls === 1, `main matrix Store expected once, got ${matrixStoreCalls}`);
assert(storedRequest?.forceTransaction === true, 'main matrix Store must force a transaction even when the card has no dirty fields');
assert(storedRequest?.card === reducedMainCard, 'Store must use the reduced clone, never the live editor card');

// The orchestration helper must save only when a real mutation succeeded. It must not
// invent a save for a fully skipped Apply, and a save failure must be returned as a
// partial result instead of throwing after irreversible row writes already happened.
let persistenceCalls = 0;
const persistenceBridge = {
  saveMainMatrixAfterApply: async () => { persistenceCalls += 1; return { ok: true, method: 'force-transaction-store' }; },
};
const noWrites = await E.persistMainMatrixAfterApply(persistenceBridge, { rows: [{ status: 'skipped' }] });
assert(noWrites?.skipped === true && persistenceCalls === 0, JSON.stringify(noWrites));
const withWrites = await E.persistMainMatrixAfterApply(persistenceBridge, { rows: [{ status: 'ok' }, { status: 'skipped' }] });
assert(withWrites?.ok === true && persistenceCalls === 1, JSON.stringify(withWrites));
const failedSave = await E.persistMainMatrixAfterApply({ saveMainMatrixAfterApply: async () => { throw new Error('save failed'); } }, { rows: [{ status: 'ok' }] });
assert(failedSave?.ok === false && failedSave?.reason === 'matrix-save-failed', JSON.stringify(failedSave));

// Integration contract: persistence happens before the post-Apply native view refresh.
const persistenceCall = code.indexOf('result.matrixSave = await persistMainMatrixAfterApply(bridge, result)');
const refreshCall = code.indexOf("result.viewRefresh = await refreshNativeMatrixViewAfterApply(bridge, { attempts: 3, baseDelayMs: 450 })");
assert(persistenceCall >= 0, 'applyPlan must persist the main matrix after row mutations');
assert(refreshCall > persistenceCall, 'main matrix persistence must happen before refreshing the native view');

console.log('TESSA Matrix Studio post-Apply matrix persistence + native view refresh/backoff: OK');
