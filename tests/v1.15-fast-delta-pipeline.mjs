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
assert.equal(E.version, '1.15.0');
assert.equal(E.adaptiveConcurrency(6, 10), 10, '16 logical CPUs may raise bounded read concurrency to cap');

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { hardwareConcurrency: 16, deviceMemory: 4 },
});
assert.equal(E.adaptiveConcurrency(6, 10), 6, 'low-memory Chrome stays at conservative floor');

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
