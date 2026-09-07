import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const ENTRY_COUNT = 70_000;
const catalogId = 'roles:self-roundtrip-limit';

// Regression for a production invariant: a workbook successfully produced by Studio
// must be accepted by the same Studio parser. v1.11.7 can generate a hidden
// dictionary sheet above the old 500k physical-cell guard after per-function
// dictionaries were introduced, so export succeeds but Preview rejects its own XLSX.
// 70k entries are deliberately enough to cross the v1.11.7 parser ceiling.
const entries = Array.from({ length: ENTRY_COUNT }, (_, index) => ({
  id: `role-${index}`,
  roleTypeId: String((index % 3) + 1),
  display: `Роль ${String(index).padStart(6, '0')}`,
  selector: `Роль ${String(index).padStart(6, '0')}`,
  source: 'MtxRoles',
}));
const catalog = {
  catalogs: {
    [catalogId]: { id: catalogId, label: 'Большой справочник ролей', sourceView: 'MtxRoles', entries },
  },
  columnCatalogIds: {},
  stats: { errors: [] },
};

const bytes = await E.createRoundtripXlsxBytes(
  { templateId: 'self-roundtrip-template', conditions: [], functions: [] },
  { matrixId: 'self-roundtrip-matrix', templateId: 'self-roundtrip-template', rows: [] },
  { TemplateName: 'Self roundtrip limit' },
  catalog,
);

const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const workbook = await E.readXlsxArrayBuffer(buffer, 'self-roundtrip-limit.xlsx');
const imported = workbook.dictionaryCatalog?.catalogs?.[catalogId]?.entries || [];
assert.equal(imported.length, ENTRY_COUNT, `Studio rejected or truncated its own large dictionary: ${imported.length}/${ENTRY_COUNT}`);
console.log(`TESSA XLSX self-roundtrip ceiling regression: ${ENTRY_COUNT} dictionary entries export+import OK`);
