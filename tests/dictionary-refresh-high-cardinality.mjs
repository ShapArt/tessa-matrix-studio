import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

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

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

const ENTRY_COUNT = 100_000;
const ROW_COUNT = 103;
const MAX_REFRESH_MS = 90_000;
const MAX_REFRESH_HEAP_GROWTH = 384 * 1024 * 1024;
const roleCatalogId = 'roles:MtxRoles';

const structure = {
  templateId: 'tpl-refresh-100k',
  conditions: [],
  functions: [{ id: 'sign', name: 'Подписание', typeName: 'Подписание' }],
};
const functionKey = E.definitionKey('function', 'sign');
const entries = Array.from({ length: ENTRY_COUNT }, (_, index) => ({
  id: 'role-' + String(index).padStart(6, '0'),
  roleTypeId: 1,
  display: 'Сотрудник ' + String(index).padStart(6, '0'),
  selector: 'Сотрудник ' + String(index).padStart(6, '0'),
  source: 'MtxRoles',
}));
const catalog = E.normalizeDictionaryCatalog({
  catalogs: {
    [roleCatalogId]: {
      id: roleCatalogId,
      label: 'Роли и пользователи TESSA',
      sourceView: 'MtxRoles',
      entries,
      functionPolicies: { sign: { mode: 'function-observed-types-first', observedRoleTypeIds: [1] } },
    },
  },
  columnCatalogIds: { [functionKey]: roleCatalogId },
  stats: { errors: [] },
});

const snapshotRows = Array.from({ length: ROW_COUNT }, (_, index) => {
  const item = entries[index];
  const flat = { [functionKey]: [item.display] };
  return {
    index,
    rowCardId: 'card-' + index,
    versionId: 'ver-' + index,
    fingerprint: E.fingerprintFlat(flat),
    flat,
    values: {},
    roles: { sign: [{ id: item.id, display: item.display, roleTypeId: 1 }] },
  };
});
const snapshot = {
  matrixId: 'matrix-refresh-100k',
  templateId: structure.templateId,
  rows: snapshotRows,
};

const baseBytes = await E.createRoundtripXlsxBytes(
  structure,
  snapshot,
  { matrixId: snapshot.matrixId, TemplateID: structure.templateId, Name: 'Refresh 100k' },
  catalog,
);
const baseBuffer = E.exactArrayBuffer(baseBytes);
const workbook = await E.readXlsxArrayBuffer(baseBuffer, 'refresh-100k.xlsx', {
  skipSheetNames: ['Словари'],
  selectiveInflate: true,
  dictionaryCatalog: catalog,
  retainArchive: true,
});
assert.equal(workbook.rows.length, ROW_COUNT);
assert.equal(workbook.parsedSheets.has('Словари'), false);

const freshEntries = entries.map((item, index) => index === 77
  ? { ...item, display: item.display + ' (новое имя)', selector: item.display + ' (новое имя)' }
  : item);
freshEntries.push({
  id: 'role-new',
  roleTypeId: 1,
  display: 'Новый сотрудник',
  selector: 'Новый сотрудник',
  source: 'MtxRoles',
});
const freshCatalog = E.normalizeDictionaryCatalog({
  catalogs: {
    [roleCatalogId]: {
      id: roleCatalogId,
      label: 'Роли и пользователи TESSA',
      sourceView: 'MtxRoles',
      entries: freshEntries,
      functionPolicies: { sign: { mode: 'function-observed-types-first', observedRoleTypeIds: [1] } },
    },
  },
  columnCatalogIds: { [functionKey]: roleCatalogId },
  stats: { errors: [] },
});

const heapBefore = process.memoryUsage().heapUsed;
const started = performance.now();
const refreshedBytes = await E.refreshWorkbookDictionaries(workbook, structure, freshCatalog);
const refreshMs = performance.now() - started;
const heapGrowth = Math.max(0, process.memoryUsage().heapUsed - heapBefore);

assert.ok(refreshedBytes.byteLength > 0, 'refresh produced an empty XLSX');
assert.ok(refreshedBytes.byteLength < 32 * 1024 * 1024,
  'refreshed XLSX exceeded production input ceiling: ' + refreshedBytes.byteLength);
assert.ok(refreshMs < MAX_REFRESH_MS,
  '100k dictionary refresh exceeded ' + MAX_REFRESH_MS + 'ms: ' + Math.round(refreshMs) + 'ms');
assert.ok(heapGrowth < MAX_REFRESH_HEAP_GROWTH,
  '100k dictionary refresh heap growth exceeded ceiling: '
    + Math.round(heapGrowth / 1024 / 1024) + ' MiB');

const refreshed = await E.readXlsxArrayBuffer(
  E.exactArrayBuffer(refreshedBytes),
  'refresh-100k-result.xlsx',
  {
    skipSheetNames: ['Словари'],
    selectiveInflate: true,
    dictionaryCatalog: freshCatalog,
    retainArchive: false,
  },
);
assert.deepEqual(refreshed.rows, workbook.rows, 'refresh changed matrix cells/hidden IDs');
assert.deepEqual(refreshed.roundtrip.baselineRows, workbook.roundtrip.baselineRows,
  'refresh changed baseline ledger');
const plan = E.buildPlan(refreshed, structure, snapshot);
assert.deepEqual(
  { noop: plan.counts.noop, update: plan.counts.update, add: plan.counts.add, delete: plan.counts.delete, skip: plan.counts.skip },
  { noop: ROW_COUNT, update: 0, add: 0, delete: 0, skip: 0 },
  'refresh changed untouched matrix semantics: ' + JSON.stringify(plan.counts),
);

console.log(
  'TESSA 100k dictionary refresh stress: OK '
  + '(entries=' + freshEntries.length
  + ', rows=' + ROW_COUNT
  + ', refresh=' + Math.round(refreshMs) + 'ms'
  + ', heap+' + Math.round(heapGrowth / 1024 / 1024) + 'MiB'
  + ', xlsx=' + refreshedBytes.byteLength + ' bytes)'
);
