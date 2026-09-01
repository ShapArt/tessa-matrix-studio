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

console.log('TESSA Matrix Studio safe post-Apply native view refresh/backoff: OK');
