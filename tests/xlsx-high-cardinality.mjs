import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;
const ENTRY_COUNT = 25_000;
const MATRIX_ROWS = 300;
const MAX_TOTAL_MS = 60_000;
const MAX_HEAP_GROWTH = 384 * 1024 * 1024;

const structure = {
  templateId: 'cardinality-template',
  conditions: [{
    criterionRowId: 'criterion-org',
    criterionName: 'Организация',
    operandTypeId: O.ReferenceGuid,
    autocompleteViewName: 'QaOrganizationView',
    refSection: 'QaOrganizationView',
  }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};
const criterionKey = E.definitionKey('criterion', 'criterion-org');
const functionKey = E.definitionKey('function', 'function-sign');
const orgCatalogId = 'catalog-org';
const roleCatalogId = 'catalog-role';

const orgEntries = Array.from({ length: ENTRY_COUNT }, (_, index) => ({
  id: `org-${String(index).padStart(5, '0')}`,
  display: `Организация ${String(index).padStart(5, '0')}`,
  qualifier: `ИНН ${7700000000 + index}`,
  source: 'QaOrganizationView',
  status: 'Доступно',
}));
orgEntries.push(
  { id: 'org-dup-a', display: 'ООО Дубль', qualifier: 'ИНН 7700000001', source: 'QaOrganizationView' },
  { id: 'org-dup-b', display: 'ООО Дубль', qualifier: 'ИНН 7700000002', source: 'QaOrganizationView' },
);
const roleEntries = [{ id: 'role-main', roleTypeId: '1', display: 'Иванов И.И.', source: 'Roles' }];

const rawCatalog = {
  catalogs: {
    [orgCatalogId]: { id: orgCatalogId, title: 'Организация', sourceView: 'QaOrganizationView', entries: orgEntries },
    [roleCatalogId]: { id: roleCatalogId, title: 'Подписание', sourceView: 'Roles', entries: roleEntries },
  },
  columnCatalogIds: { [criterionKey]: orgCatalogId, [functionKey]: roleCatalogId },
  stats: { errors: [] },
};

const beforeHeap = process.memoryUsage().heapUsed;
const started = performance.now();
const normalized = E.normalizeDictionaryCatalog(rawCatalog);
const normalizeMs = performance.now() - started;
assert(normalized.stats.entries === ENTRY_COUNT + 3,
  `dictionary normalization lost entries: ${normalized.stats.entries}`);

const lookupStarted = performance.now();
const lookup = E.dictionaryLookup(normalized.catalogs[orgCatalogId]);
for (let index = 0; index < 10_000; index += 1) {
  const id = `org-${String(index).padStart(5, '0')}`;
  const matches = lookup.byId.get(`${id}|`) || [];
  assert(matches.length === 1 && matches[0].id === id, `exact ID lookup drifted for ${id}`);
}
const lookupMs = performance.now() - lookupStarted;
assert((lookup.byDisplay.get('ооо дубль') || []).length === 2, 'duplicate display must remain ambiguous');

const column = { key: criterionKey, kind: 'criterion', excelHeader: 'Организация' };
const ambiguous = E.resolveEmbeddedDictionaryValue({ dictionaryCatalog: normalized }, column, 'ООО Дубль', '');
assert(ambiguous.resolved === false && /неоднознач/i.test(ambiguous.issue || ''),
  `duplicate display must fail closed as ambiguous: ${JSON.stringify(ambiguous)}`);
const selectorA = normalized.catalogs[orgCatalogId].entries.find(item => item.id === 'org-dup-a')?.selector;
const resolvedA = E.resolveEmbeddedDictionaryValue({ dictionaryCatalog: normalized }, column, selectorA, '');
assert(resolvedA.resolved === true && resolvedA.explicit === 'org-dup-a',
  `qualified selector did not resolve exact ID: ${JSON.stringify(resolvedA)}`);

function snapshotRow(index) {
  const orgIndex = index % ENTRY_COUNT;
  const orgId = `org-${String(orgIndex).padStart(5, '0')}`;
  const org = `Организация ${String(orgIndex).padStart(5, '0')}`;
  const flat = { [criterionKey]: [org], [functionKey]: ['Иванов И.И.'] };
  return {
    index,
    rowCardId: `card-${index}`,
    versionId: `version-${index}`,
    fingerprint: E.fingerprintFlat(flat),
    values: { 'criterion-org': [{ id: orgId, display: org }] },
    roles: { 'function-sign': [{ id: 'role-main', display: 'Иванов И.И.', roleTypeId: '1' }] },
    flat,
  };
}
const snapshot = {
  matrixId: 'cardinality-matrix',
  templateId: structure.templateId,
  rows: Array.from({ length: MATRIX_ROWS }, (_, index) => snapshotRow(index)),
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const info = { matrixId: snapshot.matrixId, TemplateID: snapshot.templateId, Name: 'Cardinality QA' };

const exportStarted = performance.now();
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, info, normalized);
const exportMs = performance.now() - exportStarted;
assert(bytes.byteLength < 32 * 1024 * 1024, `high-cardinality workbook exceeded XLSX input ceiling: ${bytes.byteLength}`);

const importStarted = performance.now();
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const workbook = await E.readXlsxArrayBuffer(buffer, 'cardinality.xlsx');
const importMs = performance.now() - importStarted;
const importedDictionaryEntries = Object.values(workbook.dictionaryCatalog?.catalogs || {})
  .reduce((sum, item) => sum + (item.entries?.length || 0), 0);
assert(importedDictionaryEntries === ENTRY_COUNT + 3,
  `embedded dictionary lost entries after XLSX roundtrip: ${importedDictionaryEntries}`);

const planStarted = performance.now();
const plan = E.buildPlan(workbook, structure, snapshot);
const planMs = performance.now() - planStarted;
assert(plan.counts.noop === MATRIX_ROWS
  && plan.counts.update === 0
  && plan.counts.add === 0
  && plan.counts.delete === 0
  && plan.counts.skip === 0,
  `untouched high-cardinality workbook produced mutations: ${JSON.stringify(plan.counts)}`);

const totalMs = performance.now() - started;
const heapGrowth = Math.max(0, process.memoryUsage().heapUsed - beforeHeap);
assert(totalMs < MAX_TOTAL_MS, `high-cardinality roundtrip exceeded ${MAX_TOTAL_MS}ms ceiling: ${Math.round(totalMs)}ms`);
assert(heapGrowth < MAX_HEAP_GROWTH,
  `high-cardinality regression grew heap by ${Math.round(heapGrowth / 1024 / 1024)} MiB`);

console.log(`TESSA Matrix Studio high-cardinality: entries=${ENTRY_COUNT + 3} normalize=${Math.round(normalizeMs)}ms lookup10k=${Math.round(lookupMs)}ms export=${Math.round(exportMs)}ms import=${Math.round(importMs)}ms plan=${Math.round(planMs)}ms total=${Math.round(totalMs)}ms heap+${Math.round(heapGrowth / 1024 / 1024)}MiB bytes=${bytes.byteLength}`);
console.log('TESSA Matrix Studio high-cardinality dictionary regression: OK');
