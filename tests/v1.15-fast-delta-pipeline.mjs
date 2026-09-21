import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { hardwareConcurrency: 16, deviceMemory: 16 },
});

const configuredSource = process.env.TMS_TEST_SOURCE;
const source = configuredSource
  ? fs.readFileSync(configuredSource, 'utf8')
  : fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source, { filename: configuredSource || 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;

assert.match(source, /FAST_ROUNDTRIP_MEMBERSHIP_V1/);
assert.doesNotMatch(source, /Коротко о работе/);
const metadataVersion = source.match(/\/\/ @version\s+([^\s]+)/)?.[1] || '';
assert.equal(E.version, metadataVersion, 'runtime version must match userscript metadata');
assert.equal(E.adaptiveConcurrency(6, 10), 10, '16 logical CPUs may raise bounded read concurrency to cap');

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { hardwareConcurrency: 16, deviceMemory: 4 },
});
assert.equal(E.adaptiveConcurrency(6, 10), 6, 'low-memory Chrome stays at conservative floor');

const tight = new Uint8Array([1, 2, 3, 4]);
assert.equal(E.exactArrayBuffer(tight), tight.buffer, 'tight Uint8Array must reuse its ArrayBuffer without a copy');
const parent = new Uint8Array([9, 1, 2, 3, 8]);
const sub = parent.subarray(1, 4);
const exactSub = E.exactArrayBuffer(sub);
assert.notEqual(exactSub, parent.buffer, 'subview must receive an exact defensive buffer');
assert.deepEqual([...new Uint8Array(exactSub)], [1, 2, 3]);

const structure = {
  templateId: 'tpl-fast-delta',
  conditions: [{ criterionRowId: 'kind', criterionName: 'Вид', operandTypeId: O.String }],
  functions: [{ id: 'sign', name: 'Подписание' }],
};
const makeRow = i => {
  const n = i + 1;
  const flat = { 'criterion:kind': [`Вид ${n}`], 'function:sign': [`Сотрудник ${n}`] };
  return {
    index: i,
    rowCardId: `card-${n}`,
    versionId: `version-${n}`,
    rowName: `Строка ${n}`,
    flat,
    values: { kind: [{ kind: 'String', value: `Вид ${n}`, display: `Вид ${n}` }] },
    roles: { sign: [{ id: `person-${n}`, display: `Сотрудник ${n}`, roleTypeId: 1 }] },
    fingerprint: E.fingerprintFlat(flat),
  };
};
const rows = Array.from({ length: 20 }, (_, i) => makeRow(i));
const snapshot = { matrixId: 'matrix-fast-delta', templateId: structure.templateId, rows };
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(
  structure,
  snapshot,
  { matrixId: snapshot.matrixId, TemplateID: structure.templateId, TemplateName: 'Fast delta' },
  catalog,
);
const workbook = await E.readXlsxArrayBuffer(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  'fast-delta.xlsx',
);
const kindIx = workbook.headers.indexOf('Вид');
workbook.rows[2].values[kindIx] = 'Вид 3 изменён';
workbook.rows[17].values[kindIx] = 'Вид 18 изменён';

const bridge = Object.create(E.TessaBridge.prototype);
bridge.mainCard = { id: snapshot.matrixId };
bridge.templateId = () => structure.templateId;
bridge.matrixInfo = () => ({ matrixId: snapshot.matrixId, TemplateID: structure.templateId });
bridge.rawMatrixSectionLinks = () => rows.map((row, index) => ({
  index,
  cardRowId: `section-${index + 1}`,
  rowID: `section-row-${index + 1}`,
  rowRowID: row.versionId,
  rowName: row.rowName,
}));
bridge.matrixSectionSignature = () => 'fast-delta-signature';

const baselineLinks = bridge.previewMatrixLinksFromRoundtripBaseline(workbook);
assert.ok(baselineLinks?.baselineMembership);
assert.equal(baselineLinks.links.length, rows.length);
assert.equal(baselineLinks.links[0].rowCardId, 'card-1');
assert.equal(baselineLinks.pagesVisited.length, 0);

// Unknown live membership (e.g. colleague ADD after export) must refuse the fast path.
const originalRaw = bridge.rawMatrixSectionLinks;
bridge.rawMatrixSectionLinks = () => [
  ...originalRaw(),
  { index: 20, cardRowId: 'section-21', rowID: 'section-row-21', rowRowID: 'version-21', rowName: 'Строка 21' },
];
assert.equal(bridge.previewMatrixLinksFromRoundtripBaseline(workbook), null);
bridge.rawMatrixSectionLinks = originalRaw;

let pageScans = 0;
bridge.collectNativeMatrixViewLinksAllPages = async () => {
  pageScans += 1;
  throw new Error('native paging must not run for fully resolvable roundtrip membership');
};
let cardGets = 0;
const byCard = new Map(rows.map(row => [row.rowCardId, row]));
bridge.getCard = async rowCardId => {
  cardGets += 1;
  return { id: rowCardId };
};
bridge.readMatrixRowFromCard = (_card, link) => {
  const row = structuredClone(byCard.get(link.rowCardId));
  row.index = link.index;
  row.rowName = link.rowName;
  return row;
};

const incremental = await bridge.loadPreviewSnapshot(structure, workbook);
assert.ok(incremental?.previewIncremental?.enabled);
assert.equal(incremental.previewIncremental.membershipSource, 'roundtrip-baseline');
assert.equal(incremental.previewIncremental.viewPagesVisited, 0);
assert.equal(pageScans, 0, 'ordinary roundtrip Preview must do zero native UI page flips');
assert.equal(cardGets, 2, 'only two edited rows need CardGet');
assert.equal(incremental.previewIncremental.baselineRows, 18);

// Initial export/full snapshot: use the native view's current request parameters but
// page it directly through View API. No visible grid page changes are allowed.
assert.match(source, /SERVER_PAGED_NATIVE_VIEW_V1/);
const serverRows = Array.from({ length: 125 }, (_, index) => ({
  card: `server-card-${index + 1}`,
  version: `server-version-${index + 1}`,
  order: index + 1,
}));
let serverUiPageCalls = 0;
let serverRequests = 0;
const fakeMetadata = { alias: 'TestMatrixView', paging: 'Always', pageLimit: 50 };
class FakeTessaViewRequest {
  constructor(metadata) {
    this.metadata = metadata;
    this.parameters = [];
    this.calculateRowCounting = false;
    this.canUseCache = true;
  }
}
class FakePagingProvider {
  providePageLimitParameter(parameters, paging, limit) {
    assert.equal(paging, 'Always');
    const existing = parameters.findIndex(item => item?.name === 'PageLimit');
    const value = { name: 'PageLimit', limit };
    if (existing >= 0) parameters[existing] = value;
    else parameters.push(value);
  }
  providePageOffsetParameter(parameters, paging, page, limit) {
    assert.equal(paging, 'Always');
    const existing = parameters.findIndex(item => item?.name === 'PageOffset');
    const value = { name: 'PageOffset', page, limit };
    if (existing >= 0) parameters[existing] = value;
    else parameters.push(value);
  }
}
FakePagingProvider.default = new FakePagingProvider();

const fakeView = {
  metadata: fakeMetadata,
  async getData(request) {
    serverRequests += 1;
    assert.ok(request.parameters.some(item => item?.name === 'CurrentCardId' && item?.value === snapshot.matrixId),
      'server paging must preserve native CurrentCardId');
    const limit = request.parameters.find(item => item?.name === 'PageLimit')?.limit || 50;
    const page = request.parameters.find(item => item?.name === 'PageOffset')?.page || 1;
    const start = (page - 1) * limit;
    const pageRows = serverRows.slice(start, start + limit);
    return {
      columns: ['MatrixRowID', 'MatrixVersionID', 'Order'],
      rows: pageRows.map(item => [item.card, item.version, item.order]),
      rowCount: serverRows.length,
    };
  },
};
const serverBridge = Object.create(E.TessaBridge.prototype);
serverBridge.mainCard = { id: snapshot.matrixId };
serverBridge.rawMatrixSectionLinks = () => serverRows.map((item, index) => ({
  index,
  rowRowID: item.version,
  rowID: `section-${index + 1}`,
  cardRowId: `section-${index + 1}`,
}));
serverBridge.findNativeMatrixControl = () => ({
  controlName: 'TestMatrixView',
  rows: serverRows.slice(0, 50),
  target: {
    viewMetadata: fakeMetadata,
    viewComponent: {
      viewMetadata: fakeMetadata,
      getRequestParams: () => [{
        name: 'CurrentCardId',
        value: snapshot.matrixId,
        clone() { return { ...this, clone: this.clone }; },
      }],
    },
    async setPageAndRefresh() { serverUiPageCalls += 1; },
  },
});
serverBridge.viewApi = () => ({
  service: { getByName: alias => alias === 'TestMatrixView' ? fakeView : null },
  serviceModule: { TessaViewRequest: FakeTessaViewRequest, ViewPagingParameters: FakePagingProvider },
  platformModule: {},
});

const serverPaged = await serverBridge.collectNativeMatrixViewLinksAllPages();
assert.equal(serverPaged.serverPaging, true);
assert.equal(serverPaged.links.length, 125);
assert.equal(serverPaged.pagesVisited.length, 3);
assert.equal(serverPaged.pageLimit, 50);
assert.equal(serverUiPageCalls, 0, 'server paging must not move the visible native grid');
assert.equal(serverRequests, 3, '125 rows at pageLimit 50 should require exactly 3 server requests');

const validServerMembership = serverBridge.rawMatrixSectionLinks;
serverBridge.rawMatrixSectionLinks = () => [
  ...validServerMembership(),
  { index: 125, rowRowID: 'unknown-version', rowID: 'unknown-section', cardRowId: 'unknown-section' },
];
const rejectedServerPaged = await serverBridge.collectNativeMatrixViewLinksServerPaged();
assert.equal(rejectedServerPaged, null, 'membership count mismatch must fail closed before UI fallback');
serverBridge.rawMatrixSectionLinks = validServerMembership;

// Targeted reconciliation: UPDATE/ADD receipts with membership already known from the
// main-card section must not scan the visible matrix. CardGet reads should overlap.
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { hardwareConcurrency: 16, deviceMemory: 16 },
});
const recBridge = {
  mainCard: { id: snapshot.matrixId },
  rawMatrixSectionLinks: () => rows.slice(0, 8).map((row, index) => ({
    index,
    rowRowID: row.versionId,
    rowID: `section-row-${index + 1}`,
    cardRowId: `section-${index + 1}`,
  })),
  collectNativeMatrixViewLinksAllPages: async () => {
    throw new Error('native membership scan is unnecessary for covered UPDATE receipts');
  },
};
let active = 0;
let maxActive = 0;
let recGets = 0;
recBridge.getCard = async rowCardId => {
  recGets += 1;
  active += 1;
  maxActive = Math.max(maxActive, active);
  await new Promise(resolve => setTimeout(resolve, 8));
  active -= 1;
  return { id: rowCardId };
};
recBridge.readMatrixRowFromCard = (_card, link) => structuredClone(byCard.get(link.rowCardId));

const updateReceipts = rows.slice(0, 8).map((row, index) => ({
  type: 'update',
  excelRow: index + 15,
  rowCardId: row.rowCardId,
  versionId: row.versionId,
}));
const targeted = await E.buildTargetedReconciliationSnapshot(
  recBridge,
  { matrixId: snapshot.matrixId, templateId: structure.templateId, receipts: updateReceipts },
  structure,
);
assert.equal(targeted.rows.length, 8);
assert.equal(targeted.targetedTelemetry.nativeMembershipFallback, false);
assert.equal(targeted.targetedTelemetry.nativePagesVisited, 0);
assert.equal(recGets, 8);
assert.ok(maxActive > 1, 'receipt CardGet verification should run with bounded parallelism');

// DELETE requires absence evidence, therefore native membership fallback is intentional.
let deleteNativeCalls = 0;
recBridge.collectNativeMatrixViewLinksAllPages = async () => {
  deleteNativeCalls += 1;
  return {
    links: rows.slice(1, 8).map(row => ({ rowCardId: row.rowCardId, versionId: row.versionId })),
    pagesVisited: [1],
  };
};
const deleted = await E.buildTargetedReconciliationSnapshot(
  recBridge,
  {
    matrixId: snapshot.matrixId,
    templateId: structure.templateId,
    receipts: [{ type: 'delete', excelRow: 15, rowCardId: rows[0].rowCardId, versionId: rows[0].versionId }],
  },
  structure,
);
assert.equal(deleteNativeCalls, 1);
assert.equal(deleted.targetedTelemetry.nativeMembershipFallback, true);
assert.equal(deleted.targetedTelemetry.nativePagesVisited, 1);

console.log('TESSA Matrix Studio fast delta pipeline: zero-page-flip Preview + bounded parallel receipt verification: OK');
