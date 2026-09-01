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
  body: { innerText: '' },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ click() {}, style: {}, set href(_) {}, set download(_) {} }),
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(E?.TessaBridge, 'TessaBridge export is missing');

const emptyControl = {
  table: { rows: [] },
  viewMetadata: { alias: 'MtxRouteMatrixDummyView', pageLimit: 50 },
  currentPage: 1,
  async setPageAndRefresh() {},
  async refresh() {},
};
const editor = { cardModel: { controls: new Map([['TestMatrixView', emptyControl]]) } };

// An empty but structurally identifiable matrix view must still be recognized. Without
// this, a brand-new empty matrix is incorrectly classified as incompatible.
{
  const native = E.inspectNativeViewCapabilitiesReadOnly(editor);
  assert(native.found === true, JSON.stringify(native));
  assert(native.refresh === true && native.paging === true, JSON.stringify(native));
}

// Bridge refresh/paging needs the same empty-control fallback so the first ADD can
// refresh the view even though no MatrixRowID exists before Store.
{
  const bridgeLike = {
    controlEntries: () => [['TestMatrixView', emptyControl]],
    rowsOfControl: control => Array.from(control?.table?.rows || []),
    dataValue: () => null,
  };
  const found = E.TessaBridge.prototype.findNativeMatrixControl.call(bridgeLike);
  assert(found?.controlName === 'TestMatrixView', JSON.stringify(found));
  assert(found?.target === emptyControl, 'empty matrix control target was not selected');
  assert(Array.isArray(found?.rows) && found.rows.length === 0, JSON.stringify(found));
}

// A genuinely empty matrix is a valid fresh snapshot: section membership = 0 and
// native identity rows = 0. It must not throw "MatrixRowID not found".
{
  const structure = { templateId: 'template-empty', conditions: [], functions: [] };
  const bridgeLike = {
    collectNativeMatrixViewLinksAllPages: async () => ({
      controlName: 'TestMatrixView', visibleRows: 0, links: [], pageCount: 1, pagesVisited: [1], pagingUsed: false,
    }),
    rawMatrixSectionLinks: () => [],
    matrixSectionSignature: () => '0:empty',
    mainCard: { id: 'matrix-empty' },
    getCard: async () => { throw new Error('CardGet must not run for empty matrix'); },
  };
  const snapshot = await E.TessaBridge.prototype.loadSnapshot.call(bridgeLike, structure);
  assert(String(snapshot.matrixId) === 'matrix-empty', JSON.stringify(snapshot));
  assert(snapshot.templateId === structure.templateId, JSON.stringify(snapshot));
  assert(Array.isArray(snapshot.rows) && snapshot.rows.length === 0, JSON.stringify(snapshot));
}

// Zero rows are safe only when the native matrix control itself was identified.
// "0 section + 0 links" without control evidence must remain fail-closed.
{
  const structure = { templateId: 'template-empty', conditions: [], functions: [] };
  const bridgeLike = {
    collectNativeMatrixViewLinksAllPages: async () => ({
      controlName: null, visibleRows: 0, links: [], pageCount: 1, pagesVisited: [1], pagingUsed: false,
    }),
    rawMatrixSectionLinks: () => [],
    matrixSectionSignature: () => '0:unknown',
    mainCard: { id: 'matrix-empty' },
    getCard: async () => { throw new Error('CardGet must not run without identities'); },
  };
  let failedClosed = false;
  try {
    await E.TessaBridge.prototype.loadSnapshot.call(bridgeLike, structure);
  } catch (error) {
    failedClosed = /MatrixRowID|нативном представлении/i.test(String(error?.message || error));
  }
  assert(failedClosed, 'zero rows without native control evidence must fail closed');
}

console.log('TESSA Matrix Studio empty-matrix runtime/view/snapshot contract: OK');
