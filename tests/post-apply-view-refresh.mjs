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

// Captured live TESSA Save is the editor pipeline: CardService.store followed by get.
// Studio must invoke the editor method rather than synthesize a partial CardStoreRequest.
let editorSaveCalls = 0;
let directStoreCalls = 0;
const matrixSaveBridge = {
  editor: {
    cardModel: { hasChanges: async () => false, card: { id: 'matrix-1', version: 17 } },
    saveCard: async () => { editorSaveCalls += 1; return true; },
  },
  mainCard: { id: 'matrix-1', version: 16 },
  cardService: {
    store: async () => { directStoreCalls += 1; throw new Error('direct Store is not the native Save pipeline'); },
  },
};
const matrixSave = await E.TessaBridge.prototype.saveMainMatrixAfterApply.call(matrixSaveBridge);
assert(matrixSave?.ok === true, JSON.stringify(matrixSave));
assert(matrixSave?.method === 'native-editor-save', JSON.stringify(matrixSave));
assert(matrixSave?.editorMethod === 'saveCard', JSON.stringify(matrixSave));
assert(editorSaveCalls === 1, `editor.saveCard expected once, got ${editorSaveCalls}`);
assert(directStoreCalls === 0, `Studio wrapper must not call CardService.store directly, got ${directStoreCalls}`);
assert(matrixSaveBridge.mainCard === matrixSaveBridge.editor.cardModel.card, 'bridge must follow the card reloaded by native Save');

// Native Save is valid even when cardModel reported no local changes before the click;
// that is exactly what the captured DELETE -> separate Save sequence demonstrated.
let cleanSaveCalls = 0;
const cleanSave = await E.TessaBridge.prototype.saveMainMatrixAfterApply.call({
  editor: {
    cardModel: { hasChanges: async () => false, card: { id: 'matrix-1' } },
    saveCard: async () => { cleanSaveCalls += 1; return true; },
  },
  mainCard: { id: 'matrix-1' },
});
assert(cleanSave?.ok === true && cleanSaveCalls === 1, JSON.stringify(cleanSave));

// The orchestration helper saves after accepted native mutations. A staged DELETE is
// no longer an accepted state: native DeleteRow is accepted only after the request resolves.
let persistenceCalls = 0;
const persistenceBridge = {
  saveMainMatrixAfterApply: async () => { persistenceCalls += 1; return { ok: true, method: 'native-editor-save' }; },
};
const noWrites = await E.persistMainMatrixAfterApply(persistenceBridge, { rows: [{ status: 'skipped' }] });
assert(noWrites?.skipped === true && persistenceCalls === 0, JSON.stringify(noWrites));
const withWrites = await E.persistMainMatrixAfterApply(persistenceBridge, { rows: [{ status: 'ok' }, { status: 'skipped' }] });
assert(withWrites?.ok === true && persistenceCalls === 1, JSON.stringify(withWrites));
const obsoleteStagedDelete = await E.persistMainMatrixAfterApply(persistenceBridge, { rows: [{ type: 'delete', status: 'staged' }] });
assert(obsoleteStagedDelete?.skipped === true && persistenceCalls === 1, JSON.stringify(obsoleteStagedDelete));
const failedSave = await E.persistMainMatrixAfterApply({ saveMainMatrixAfterApply: async () => { throw new Error('save failed'); } }, { rows: [{ status: 'ok' }] });
assert(failedSave?.ok === false && failedSave?.reason === 'matrix-save-failed', JSON.stringify(failedSave));

console.log('TESSA Matrix Studio post-Apply native editor Save + view refresh/backoff: OK');
