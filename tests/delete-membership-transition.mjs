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
const deleteMatrixRow = E.TessaBridge?.prototype?.deleteMatrixRow;
assert(typeof deleteMatrixRow === 'function', 'deleteMatrixRow must exist');

let request = null;
let sectionTouched = false;
class CardRequest {
  constructor() { this.info = {}; }
}
const fakeBridge = {
  cards: { CardRequest },
  mainCard: { id: 'matrix-id' },
  TypedField: {
    createGuid(value) { return { kind: 'Guid', value }; },
  },
  cardService: {
    async request(req) {
      request = req;
      return { validationResult: { isSuccessful: true } };
    },
  },
  validationError: () => null,
  section() { sectionTouched = true; throw new Error('native DELETE must not stage local membership'); },
};

const outcome = await deleteMatrixRow.call(fakeBridge, 'version-target');
assert(outcome?.validationResult?.isSuccessful === true, JSON.stringify(outcome));
assert(sectionTouched === false, 'native DELETE must not mutate MtxRouteMatrixRows locally');
assert(request instanceof CardRequest, 'native DELETE must use CardRequest');
assert(request.requestType === 'd090417f-bf4b-45ed-9c82-33ef23acd96f', `unexpected requestType: ${request.requestType}`);
assert(request.cardId === 'matrix-id', `DELETE must target the matrix card: ${request.cardId}`);
assert(request.info?.MatrixRowVersionID?.kind === 'Guid', JSON.stringify(request.info));
assert(request.info?.MatrixRowVersionID?.value === 'version-target', JSON.stringify(request.info));

const failingBridge = {
  ...fakeBridge,
  cardService: {
    async request(req) {
      request = req;
      return { validationResult: { isSuccessful: false } };
    },
  },
  validationError: () => new Error('server rejected native delete'),
};
let rejected = false;
try { await deleteMatrixRow.call(failingBridge, 'version-target'); }
catch (error) { rejected = /server rejected native delete/i.test(String(error?.message || error)); }
assert(rejected, 'failed native DeleteRow request must fail closed');

console.log('DELETE must use the native TESSA DeleteRow CardRequest contract: OK');
