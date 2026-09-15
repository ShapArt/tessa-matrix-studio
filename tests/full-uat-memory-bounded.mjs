import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.example.test', href: 'https://tessa.example.test/matrix' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };

const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source, { filename: 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

const catalogId = 'roles:memory-bound';
const catalog = {
  catalogs: {
    [catalogId]: {
      id: catalogId,
      label: 'Memory bounded roles',
      sourceView: 'MtxRoles',
      entries: Array.from({ length: 250 }, (_, index) => ({
        id: `role-${index}`,
        roleTypeId: String(index % 3),
        display: `Роль ${index}`,
        selector: `Роль ${index}`,
        source: 'MtxRoles',
        details: `RoleFullName: Роль ${index} | RolePositionName: Должность ${index}`,
      })),
    },
  },
  columnCatalogIds: { 'function:sign': catalogId },
  stats: { errors: [] },
};
const structure = {
  templateId: 'tpl-memory-bound',
  conditions: [],
  functions: [{ id: 'sign', name: 'Подписание' }],
};
const snapshot = { matrixId: 'matrix-memory-bound', templateId: 'tpl-memory-bound', rows: [] };
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, { TemplateName: 'Memory bounded UAT' }, catalog);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

// Regression for the live browser OOM: Full UAT must be able to parse a generated
// workbook without materializing the huge «Словари» sheet into rows/cell metadata.
const lean = await E.readXlsxArrayBuffer(buffer, 'memory-bound.xlsx', {
  skipSheetNames: ['Словари'],
  dictionaryCatalog: catalog,
  retainArchive: false,
});
assert.equal(lean.parsedSheets.has('Словари'), false, 'lean UAT read must not parse the dictionary sheet');
assert.equal(lean.dictionaryCatalog, catalog, 'lean UAT read must reuse the already loaded live catalog');

assert.equal(typeof E.releaseWorkbookArchive, 'function', 'archive release API is required for bounded Full UAT memory');
assert.equal(E.releaseWorkbookArchive(lean), false, 'retainArchive:false must not pin unzipped workbook parts');

const retained = await E.readXlsxArrayBuffer(buffer, 'memory-retained.xlsx', {
  skipSheetNames: ['Словари'],
  dictionaryCatalog: catalog,
});
assert.equal(retained.parsedSheets.has('Словари'), false);
assert.equal(E.releaseWorkbookArchive(retained), true, 'Full UAT must be able to release the base archive after refresh');
assert.equal(E.releaseWorkbookArchive(retained), false, 'archive release must be idempotent');

// The canonical Full UAT runner must actually use the bounded read path for its large
// roundtrip artifacts and release the only archive it intentionally retains.
assert.match(source, /TESSA_UAT_CURRENT\.xlsx'[\s\S]{0,500}skipSheetNames:\s*\['Словари'\]/,
  'Full UAT base workbook must skip materializing the dictionary sheet');
assert.match(source, /TESSA_UAT_REFRESHED\.xlsx'[\s\S]{0,500}retainArchive:\s*false/,
  'Full UAT refreshed workbook must not retain its unzipped archive');
assert.match(source, /TESSA_UAT_MERGED\.xlsx'[\s\S]{0,500}retainArchive:\s*false/,
  'Full UAT merged workbook must not retain its unzipped archive');
assert.match(source, /releaseWorkbookArchive\(base\.book\)/,
  'Full UAT must release the base workbook archive after dictionary refresh');

console.log('Full UAT bounded-memory XLSX path: dictionary sheet skipped and archives released: OK');
