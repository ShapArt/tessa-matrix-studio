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

let cleaned = false;
let removeAllButChanged = false;
let storedRequest = null;
const changedCard = {
  clone() {
    return {
      removeAllButChanged() { removeAllButChanged = true; },
      clean() { cleaned = true; },
      id: 'matrix-1',
    };
  },
};
const fakeBridge = {
  editor: { cardModel: { hasChanges: async () => true } },
  mainCard: changedCard,
  cards: { CardStoreRequest: class { constructor() { this.info = {}; } } },
  cardService: { store: async req => { storedRequest = req; return { validationResult: { isSuccessful: true }, cardId: 'matrix-1', cardVersion: 8 }; } },
  validationError: () => null,
};

const result = await save.call(fakeBridge, { allowOwnedChanges: true });
assert(result?.ok === true, `changed main card must save: ${JSON.stringify(result)}`);
assert(removeAllButChanged, 'main matrix save must send only changed data');
assert(cleaned === false, 'changed markers must not be erased with card.clean() before Store');
assert(storedRequest?.forceTransaction !== true, 'client must not use empty forceTransaction Store as a substitute for real changes');

console.log('Main matrix persistence must Store actual changed membership state: OK');
