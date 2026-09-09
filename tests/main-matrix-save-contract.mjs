import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const save = E.TessaBridge?.prototype?.saveMainMatrixAfterApply;
assert(typeof save === 'function', 'saveMainMatrixAfterApply must exist');

let nativeSaveCalls = 0;
let directStoreCalls = 0;
const fakeBridge = {
  editor: {
    cardModel: {
      hasChanges: async () => false,
      card: { id: 'matrix-1' },
    },
    async saveCard() {
      nativeSaveCalls += 1;
      return true;
    },
  },
  mainCard: { id: 'matrix-1' },
  cardService: {
    async store() {
      directStoreCalls += 1;
      throw new Error('saveMainMatrixAfterApply must not bypass the native editor save pipeline');
    },
  },
};

const result = await save.call(fakeBridge);
assert(result?.ok === true, `native editor save must succeed: ${JSON.stringify(result)}`);
assert(result?.method === 'native-editor-save', JSON.stringify(result));
assert(nativeSaveCalls === 1, `expected one editor.saveCard call, got ${nativeSaveCalls}`);
assert(directStoreCalls === 0, `direct CardService.store must not be called by Studio save wrapper, got ${directStoreCalls}`);
assert(result?.cardId === 'matrix-1', JSON.stringify(result));

const unavailable = {
  editor: { cardModel: { card: { id: 'matrix-1' } } },
  mainCard: { id: 'matrix-1' },
};
let rejected = false;
try { await save.call(unavailable); }
catch (error) { rejected = /save|сохран|editor/i.test(String(error?.message || error)); }
assert(rejected, 'missing native editor save method must fail closed');

console.log('Main matrix persistence must use the native TESSA editor Save pipeline: OK');
