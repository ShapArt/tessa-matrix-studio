import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };

const configuredSource = process.env.TMS_TEST_SOURCE;
const source = configuredSource
  ? fs.readFileSync(configuredSource, 'utf8')
  : fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source, { filename: configuredSource || 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;

assert.match(source, /PREVIEW_BASELINE_INCREMENTAL_SNAPSHOT_V1/);

const structure = {
  templateId: 'tpl-preview-inc',
  conditions: [{ criterionRowId: 'kind', criterionName: 'Вид', operandTypeId: O.String }],
  functions: [{ id: 'sign', name: 'Подписание' }],
};
const snapshotRows = Array.from({ length: 4 }, (_, i) => {
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
});
const snapshot = {
  matrixId: 'matrix-preview-inc',
  templateId: structure.templateId,
  rows: snapshotRows,
};
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(
  structure,
  snapshot,
  { matrixId: snapshot.matrixId, TemplateID: structure.templateId, TemplateName: 'Preview incremental' },
  catalog,
);
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'preview-inc.xlsx');
const ix = name => workbook.headers.indexOf(name);

// One edited row => CardGet.
workbook.rows[1].values[ix('Вид')] = 'Вид 2 изменён';
// One deleted Excel row => CardGet, because Preview needs current target contents for DELETE.
workbook.rows = workbook.rows.filter(row => String(row.values[ix('__TESSA_ROW_CARD_ID')]) !== 'card-3');
// One new Excel row has no server identity and therefore causes no existing-row CardGet.
const added = {
  ...workbook.rows[0],
  excelRow: 100,
  values: [...workbook.rows[0].values],
  cellMeta: [...workbook.rows[0].cellMeta],
};
for (const name of ['__TESSA_ROW_CARD_ID', '__TESSA_VERSION_ID', '__TESSA_BASE_FINGERPRINT']) {
  added.values[ix(name)] = '';
}
added.values[ix('Вид')] = 'Новый вид';
added.values[ix('Подписание')] = 'Сотрудник 1';
workbook.rows.push(added);

const links = snapshotRows.map(row => ({
  index: row.index,
  rowCardId: row.rowCardId,
  versionId: row.versionId,
  rowName: row.rowName,
}));

const bridge = Object.create(E.TessaBridge.prototype);
bridge.mainCard = { id: snapshot.matrixId };
bridge.matrixInfo = () => ({ matrixId: snapshot.matrixId, TemplateID: structure.templateId });
bridge.templateId = () => structure.templateId;

const plan = bridge.previewSnapshotBaselineReusePlan(workbook, structure, links);
assert.equal(plan.eligible, true);
assert.equal(plan.total, 4);
assert.equal(plan.reusedCount, 2, 'only untouched rows 1 and 4 should reuse baseline');
assert.equal(plan.fetchedCount, 2, 'edited row 2 and deleted-from-Excel row 3 require CardGet');
assert.deepEqual(plan.reuse.map(item => item.link.rowCardId).sort(), ['card-1', 'card-4']);
assert.deepEqual(plan.fetch.map(item => item.rowCardId).sort(), ['card-2', 'card-3']);

// A current server row unknown to the workbook baseline is always fetched.
const extraLinks = [...links, { index: 4, rowCardId: 'card-5', versionId: 'version-5', rowName: 'Строка 5' }];
const extraPlan = bridge.previewSnapshotBaselineReusePlan(workbook, structure, extraLinks);
assert.equal(extraPlan.reusedCount, 2);
assert.equal(extraPlan.fetchedCount, 3);
assert.ok(extraPlan.fetch.some(link => link.rowCardId === 'card-5'));

// Duplicate/copied identities are intentionally conservative: they require fresh server data.
const copied = {
  ...workbook.rows[0],
  excelRow: 101,
  values: [...workbook.rows[0].values],
  cellMeta: [...workbook.rows[0].cellMeta],
};
workbook.rows.push(copied);
const copiedPlan = bridge.previewSnapshotBaselineReusePlan(workbook, structure, links);
assert.ok(copiedPlan.fetch.some(link => link.rowCardId === 'card-1'), 'copied hidden identity must disable baseline reuse for that source row');

// Exercise the actual Preview loader: only planned rows hit getCard.
workbook.rows.pop();
bridge.collectNativeMatrixViewLinksAllPages = async () => ({
  controlName: 'TestMatrixView',
  links,
  pageCount: 1,
  pagesVisited: [1],
  pagingUsed: false,
});
bridge.rawMatrixSectionLinks = () => links.map(link => ({
  rowID: link.versionId,
  rowRowID: link.versionId,
  cardRowId: `section-${link.index}`,
  rowName: link.rowName,
}));
bridge.matrixSectionSignature = () => 'sig-preview-inc';
let cardGets = 0;
bridge.getCard = async rowCardId => {
  cardGets += 1;
  return { id: rowCardId };
};
const serverByCard = new Map(snapshotRows.map(row => [row.rowCardId, row]));
bridge.readMatrixRowFromCard = (_card, link) => {
  const row = structuredClone(serverByCard.get(link.rowCardId));
  row.index = link.index;
  row.rowName = link.rowName;
  return row;
};

const incremental = await bridge.loadPreviewSnapshot(structure, workbook);
assert.ok(incremental?.previewIncremental?.enabled);
assert.equal(cardGets, 2);
assert.equal(incremental.previewIncremental.cardGets, 2);
assert.equal(incremental.previewIncremental.baselineRows, 2);
assert.equal(incremental.rows.length, 4);
assert.equal(incremental.rows.find(row => row.rowCardId === 'card-1').previewSource, 'baseline');
assert.equal(incremental.rows.find(row => row.rowCardId === 'card-2').previewSource, 'card-get');

// Production-shape guard: 503 current rows with only 15 edited rows must not regress
// into 503 CardGet calls. This test exercises only the local read planner, so it remains
// deterministic and cheap while pinning the network-complexity contract.
{
  const largeRows = Array.from({ length: 503 }, (_, i) => {
    const n = i + 1;
    const flat = { 'criterion:kind': [`Вид ${n}`], 'function:sign': [`Сотрудник ${n}`] };
    return {
      index: i,
      rowCardId: `large-card-${n}`,
      versionId: `large-version-${n}`,
      rowName: `Строка ${n}`,
      flat,
      values: { kind: [{ kind: 'String', value: `Вид ${n}`, display: `Вид ${n}` }] },
      roles: { sign: [{ id: `large-person-${n}`, display: `Сотрудник ${n}`, roleTypeId: 1 }] },
      fingerprint: E.fingerprintFlat(flat),
    };
  });
  const largeSnapshot = { matrixId: 'matrix-preview-large', templateId: structure.templateId, rows: largeRows };
  const largeCatalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, largeSnapshot);
  const largeBytes = await E.createRoundtripXlsxBytes(
    structure,
    largeSnapshot,
    { matrixId: largeSnapshot.matrixId, TemplateID: structure.templateId, TemplateName: 'Preview 503' },
    largeCatalog,
  );
  const largeWorkbook = await E.readXlsxArrayBuffer(
    largeBytes.buffer.slice(largeBytes.byteOffset, largeBytes.byteOffset + largeBytes.byteLength),
    'preview-503.xlsx',
  );
  const kindIx = largeWorkbook.headers.indexOf('Вид');
  for (let i = 0; i < 15; i += 1) largeWorkbook.rows[i].values[kindIx] = `Изменено ${i + 1}`;

  const largeBridge = Object.create(E.TessaBridge.prototype);
  largeBridge.mainCard = { id: largeSnapshot.matrixId };
  largeBridge.matrixInfo = () => ({ matrixId: largeSnapshot.matrixId, TemplateID: structure.templateId });
  largeBridge.templateId = () => structure.templateId;
  const largeLinks = largeRows.map(row => ({
    index: row.index,
    rowCardId: row.rowCardId,
    versionId: row.versionId,
    rowName: row.rowName,
  }));
  const largePlan = largeBridge.previewSnapshotBaselineReusePlan(largeWorkbook, structure, largeLinks);
  assert.equal(largePlan.eligible, true);
  assert.equal(largePlan.total, 503);
  assert.equal(largePlan.fetchedCount, 15, '503-row Preview with 15 edits should need only 15 CardGet reads');
  assert.equal(largePlan.reusedCount, 488);
}

console.log('TESSA Matrix Studio incremental Preview snapshot: 2 CardGet for 4 rows, unchanged baseline rows reused safely: OK');
