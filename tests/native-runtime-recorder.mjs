import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.collectNativeRuntimeSurface === 'function', 'collectNativeRuntimeSurface export is required');
assert(typeof E.sanitizeNativeOperationRecord === 'function', 'sanitizeNativeOperationRecord export is required');

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
console.log('Native runtime recorder exposes methods and redacts business values: OK');
