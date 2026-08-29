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
const decode = E.TessaBridge.prototype.readMatrixRowFromCard;
assert(typeof decode === 'function', 'readMatrixRowFromCard must exist');

const missingVersionCard = {
  sections: {
    MtxRouteMatrixRowVersions: { rows: [{ rowId: 'other-version', state: 0 }] },
    MtxRouteMatrixRowVersionValues: { rows: [] },
    MtxRouteMatrixRowVersionRoles: { rows: [] },
  },
};
const fakeBridge = {
  section: (card, name) => card.sections[name] || null,
  isDeleted: row => row?.state === 3,
  rowValue: () => null,
  readCriterionValue: () => null,
};
const link = {
  index: 0,
  rowCardId: 'card-delete',
  versionId: 'version-delete',
  rowName: 'Строка 1',
  source: 'targeted-delete-recheck',
};
const structure = { conditions: [], functions: [] };

let rejected = false;
try {
  decode.call(fakeBridge, missingVersionCard, link, structure);
} catch (error) {
  rejected = true;
  const message = String(error?.message || error);
  assert(/MatrixVersionID|version-delete|верси/i.test(message),
    `missing target version must have an explicit diagnostic, got: ${message}`);
}
assert(rejected,
  'targeted DELETE decoder must fail closed when the requested MatrixVersionID is absent from the row card');

console.log('TESSA Matrix Studio DELETE target-version presence regression: OK');
