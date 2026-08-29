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
assert(typeof E.TessaBridge?.prototype?.storeRowCard === 'function', 'storeRowCard is unavailable');

// A Store built from the preflight Card must make TESSA validate that exact card version atomically.
// DoesNotAffectVersion must remain disabled because TESSA gives it priority over AffectVersion.
class FakeCardStoreRequest {
  constructor() {
    this.card = null;
    this.info = {};
    this.affectVersion = false;
    this.doesNotAffectVersion = false;
  }
}

let capturedRequest = null;
const fakeBridge = {
  cards: { CardStoreRequest: FakeCardStoreRequest },
  TypedField: { createGuid: value => value },
  mainCard: { id: 'matrix-race-test' },
  cardService: {
    store: async request => {
      capturedRequest = request;
      return { cardId: 'row-card', cardVersion: 8 };
    },
  },
  validationError: () => null,
};

const card = { id: 'row-card', version: 7 };
await E.TessaBridge.prototype.storeRowCard.call(fakeBridge, card);

assert(capturedRequest, 'CardStoreRequest was not sent');
assert(capturedRequest.card === card, 'storeRowCard replaced the prepared card');
assert(capturedRequest.info.MatrixID === 'matrix-race-test', 'matrix identity was not preserved');
assert(capturedRequest.affectVersion === true,
  `UPDATE/ADD store must require atomic TESSA version validation, got affectVersion=${capturedRequest.affectVersion}`);
assert(capturedRequest.doesNotAffectVersion !== true,
  'version checking must not be disabled by DoesNotAffectVersion');

console.log('TESSA Matrix Studio apply version race regression: OK');
