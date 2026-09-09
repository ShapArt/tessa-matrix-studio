import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = {
  body: { innerText: 'Завершить редактирование и разблокировать' },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ click: () => {}, href: '', download: '' }),
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.refreshNativeMatrixViewAfterApply === 'function', 'refreshNativeMatrixViewAfterApply is missing');
assert(typeof E.persistMainMatrixAfterApply === 'function', 'persistMainMatrixAfterApply is missing');

// Native display refresh is view-local and retries writer-locks without reloading the
// entire matrix card. Full editor.refreshCard() would replace the in-memory card model
// and can race with the explicit post-Apply verification flow.
let viewRefreshCalls = 0;
let cardRefreshCalls = 0;
const bridge = {
  refreshNativeMatrixView: async () => {
    viewRefreshCalls += 1;
    if (viewRefreshCalls < 3) throw new Error('ObtainWriterLock failed');
    return { ok: true, controlName: 'TestMatrixView', page: 1 };
  },
  refresh: async () => { cardRefreshCalls += 1; },
};
const refresh = await E.refreshNativeMatrixViewAfterApply(bridge, { attempts: 3, baseDelayMs: 0 });
assert(refresh?.ok === true, JSON.stringify(refresh));
assert(refresh.attempts === 3, JSON.stringify(refresh));
assert(viewRefreshCalls === 3, `native view refresh expected three attempts, got ${viewRefreshCalls}`);
assert(cardRefreshCalls === 0, `native refresh must never call editor.refreshCard(), got ${cardRefreshCalls}`);

let singleRefreshCalls = 0;
const single = await E.refreshNativeMatrixViewAfterApply({
  refreshNativeMatrixView: async () => { singleRefreshCalls += 1; return { ok: true, controlName: 'TestMatrixView', page: 1 }; },
  refresh: async () => { cardRefreshCalls += 1; },
}, { attempts: 3, baseDelayMs: 0 });
assert(single?.ok === true && single.attempts === 1, JSON.stringify(single));
assert(singleRefreshCalls === 1, `native view refresh expected once, got ${singleRefreshCalls}`);
assert(cardRefreshCalls === 0, `native refresh must never call editor.refreshCard(), got ${cardRefreshCalls}`);

// Live v1.12.1 evidence showed that an empty forceTransaction Store is rejected by
// CheckRequestStoreExtension. The main matrix must be stored only when it contains
// actual Studio-owned changed state (for example a staged membership DELETE). The
// changed markers must survive removeAllButChanged(); clean() must NOT erase them.
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
    this.affectVersion = false;
    this.card = null;
  }
}
const matrixSaveBridge = {
  cards: { CardStoreRequest: FakeCardStoreRequest },
  editor: { cardModel: { hasChanges: async () => true } },
  _ownedMatrixDeleteSectionRowIds: new Set(['section-row-1']),
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
assert(cloneCalls === 1 && trimCalls === 1 && cleanCalls === 0,
  `main card must be cloned/reduced without clean(): ${cloneCalls}/${trimCalls}/${cleanCalls}`);
assert(matrixStoreCalls === 1, `main matrix Store expected once, got ${matrixStoreCalls}`);
assert(storedRequest?.forceTransaction !== true, 'main matrix Store must not fake an empty forceTransaction save');
assert(storedRequest?.affectVersion === true, 'main matrix changed-card Store should use optimistic version semantics when supported');
assert(storedRequest?.card === reducedMainCard, 'Store must use the reduced clone, never the live editor card');
assert(matrixSave.method === 'changed-card-store', JSON.stringify(matrixSave));

// No dirty main-card state means there is nothing valid to Store. UPDATE/ADD row-card
// writes do not justify sending an empty matrix-card request.
let noChangeStoreCalls = 0;
const noChangeSave = await E.TessaBridge.prototype.saveMainMatrixAfterApply.call({
  cards: { CardStoreRequest: FakeCardStoreRequest },
  editor: { cardModel: { hasChanges: async () => false } },
  mainCard: { id: 'matrix-1', clone: () => reducedMainCard },
  cardService: { store: async () => { noChangeStoreCalls += 1; return {}; } },
  validationError: () => null,
});
assert(noChangeSave?.skipped === true && noChangeSave.reason === 'no-main-card-changes', JSON.stringify(noChangeSave));
assert(noChangeStoreCalls === 0, `no-change matrix Store must not run, got ${noChangeStoreCalls}`);

// The orchestration helper must save when a real mutation/staged membership change
// exists. It must not invent a save for a fully skipped Apply, and a save failure is
// returned as a partial result instead of throwing after irreversible row writes.
let persistenceCalls = 0;
const persistenceBridge = {
  saveMainMatrixAfterApply: async () => { persistenceCalls += 1; return { ok: true, method: 'changed-card-store' }; },
};
const noWrites = await E.persistMainMatrixAfterApply(persistenceBridge, { rows: [{ status: 'skipped' }] });
assert(noWrites?.skipped === true && persistenceCalls === 0, JSON.stringify(noWrites));
const withWrites = await E.persistMainMatrixAfterApply(persistenceBridge, { rows: [{ status: 'ok' }, { status: 'skipped' }] });
assert(withWrites?.ok === true && persistenceCalls === 1, JSON.stringify(withWrites));
const withStagedDelete = await E.persistMainMatrixAfterApply(persistenceBridge, { rows: [{ type: 'delete', status: 'staged' }] });
assert(withStagedDelete?.ok === true && persistenceCalls === 2, JSON.stringify(withStagedDelete));
const failedSave = await E.persistMainMatrixAfterApply({ saveMainMatrixAfterApply: async () => { throw new Error('save failed'); } }, { rows: [{ status: 'ok' }] });
assert(failedSave?.ok === false && failedSave?.reason === 'matrix-save-failed', JSON.stringify(failedSave));

console.log('TESSA Matrix Studio post-Apply changed-card persistence + native view refresh/backoff: OK');
