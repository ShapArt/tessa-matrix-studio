import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const controls = new Map();
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.Element = class Element {};
globalThis.document = {
  body: { innerText: '' },
  querySelector: selector => controls.get(selector) || null,
  querySelectorAll: () => [],
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.collectNativeRuntimeSurface === 'function', 'collectNativeRuntimeSurface export is required');
assert(typeof E.sanitizeNativeOperationRecord === 'function', 'sanitizeNativeOperationRecord export is required');
assert(typeof E.startNativeOperationRecorder === 'function', 'startNativeOperationRecorder export is required');
assert(typeof E.stopNativeOperationRecorder === 'function', 'stopNativeOperationRecorder export is required');
assert(typeof E.restoreNativeRecorderMethods === 'function', 'restoreNativeRecorderMethods export is required');

const surface = E.collectNativeRuntimeSurface({
  editor: { refreshCard() {}, saveCard() {}, secretValue: 'business text' },
  cardModel: { hasChanges() {}, save() {}, executeInContext() {} },
  controls: new Map([['TestMatrixView', { refresh() {}, setPageAndRefresh() {}, table: { rows: [] } }]]),
  cardService: { get() {}, request() {}, store() {}, create() {}, delete() {} },
});
assert(surface.editorMethods.includes('refreshCard'), JSON.stringify(surface));
assert(surface.cardModelMethods.includes('save'), JSON.stringify(surface));
assert(surface.cardServiceMethods.includes('request') && surface.cardServiceMethods.includes('store'), JSON.stringify(surface));
assert(!JSON.stringify(surface).includes('business text'), 'runtime surface must not capture arbitrary business values');

const record = E.sanitizeNativeOperationRecord({
  method: 'request',
  requestType: 'd090417f-bf4b-45ed-9c82-33ef23acd96f',
  cardId: 'f5ec6fe5-1111-2222-3333-444444444444',
  info: {
    MatrixRowVersionID: 'bd57f8b6-7032-4346-a1a2-19c576a1bbea',
    RoleName: 'Иванов Иван Иванович',
    Amount: 123456.78,
  },
});
assert(record.info.MatrixRowVersionID === 'bd57f8b6-7032-4346-a1a2-19c576a1bbea', JSON.stringify(record));
assert(record.info.RoleName === '[REDACTED]', JSON.stringify(record));
assert(record.info.Amount === '[REDACTED]', JSON.stringify(record));

// Recorder lifecycle is part of the safety contract: every method we wrap must be
// restored even when the recording is stopped without downloading a report.
const originalRequest = async request => ({ validationResult: { isSuccessful: true }, cardId: request?.cardId || null });
const originalStore = async request => ({ validationResult: { isSuccessful: true }, cardId: request?.card?.id || null, cardVersion: 2 });
const fakeBridge = {
  mainCard: { id: 'matrix-id' },
  templateId: () => 'template-id',
  editor: { cardModel: { hasChanges: async () => false } },
  cardService: { request: originalRequest, store: originalStore },
  rawMatrixSectionLinks: () => [],
  controlEntries: () => [],
};
const oldCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => fakeBridge;
controls.set('#tms-native-record-start', { disabled: false });
controls.set('#tms-native-record-stop', { disabled: true });
try {
  await E.startNativeOperationRecorder();
  assert(fakeBridge.cardService.request !== originalRequest, 'request must be wrapped while recorder is active');
  assert(fakeBridge.cardService.store !== originalStore, 'store must be wrapped while recorder is active');
  await fakeBridge.cardService.request({ requestType: 'technical-request', cardId: 'f5ec6fe5-1111-2222-3333-444444444444', info: { RoleName: 'секрет' } });
  const report = await E.stopNativeOperationRecorder(false);
  assert(report?.records?.length >= 1, 'recorder must return captured calls');
  assert(fakeBridge.cardService.request === originalRequest, 'request must be restored after stop');
  assert(fakeBridge.cardService.store === originalStore, 'store must be restored after stop');
  assert(controls.get('#tms-native-record-start').disabled === false, 'start control must be re-enabled after stop');
  assert(controls.get('#tms-native-record-stop').disabled === true, 'stop control must be disabled after stop');
} finally {
  E.TessaBridge.create = oldCreate;
  // Idempotent emergency cleanup must be safe even after normal stop.
  E.restoreNativeRecorderMethods(null);
}

// Source-level guard: lifecycle cleanup belongs to a finally block, so later report
// formatting/download changes cannot accidentally leave CardService patched.
assert(/finally\s*\{[\s\S]{0,1200}restoreNativeRecorderMethods\(/.test(code),
  'recorder cleanup must be enforced from a finally block');

console.log('Native runtime recorder exposes methods, redacts values, and restores CardService safely: OK');
