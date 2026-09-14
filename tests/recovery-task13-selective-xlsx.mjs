import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Make the production bug cheap to reproduce: the generated service sheet exceeds the
// per-entry ceiling, while the actual matrix/metadata parts remain small.
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.__TESSA_MATRIX_SYNC_TEST_ARCHIVE_LIMITS__ = {
  MaxInputBytes: 4 * 1024 * 1024,
  MaxEntries: 256,
  MaxEntryUncompressedBytes: 64 * 1024,
  MaxTotalUncompressedBytes: 4 * 1024 * 1024,
  MaxCompressionRatio: 1000,
};
globalThis.location = { origin: 'https://tessa.example.test', href: 'https://tessa.example.test/matrix' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };

const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source, { filename: 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

const catalogId = 'roles:task13';
const entries = Array.from({ length: 900 }, (_, index) => ({
  id: `role-${String(index).padStart(5, '0')}`,
  roleTypeId: String(index % 4),
  display: `Сотрудник ${index}`,
  selector: `Сотрудник ${index} — Должность`,
  source: 'MtxRoles',
  details: `RoleFullName: Сотрудник ${index} | RolePositionName: Должность ${index}`,
}));
const catalog = {
  catalogs: { [catalogId]: { id: catalogId, label: 'Большой справочник', sourceView: 'MtxRoles', entries } },
  columnCatalogIds: { 'function:sign': catalogId },
  stats: { errors: [] },
};
const structure = { templateId: 'tpl-task13', conditions: [], functions: [{ id: 'sign', name: 'Подписание' }] };
const snapshot = { matrixId: 'matrix-task13', templateId: 'tpl-task13', rows: [] };
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, { TemplateName: 'Task13 selective inflate' }, catalog);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

// Sanity: the ordinary full reader MUST still reject an entry that crosses the safety cap.
await assert.rejects(
  () => E.readXlsxArrayBuffer(buffer, 'task13-full.xlsx'),
  /распакованн.*размер.*xl\/worksheets\/sheet\d+\.xml.*64 КБ|распакованн.*размер.*безопасн.*лимит/i,
  'full XLSX reader should preserve the per-entry resource guard',
);

// Product regression: when the caller explicitly replaces «Словари» with a fresh TESSA
// catalog, that worksheet must be excluded BEFORE entry-size validation and decompression.
// This is the reported 21MB/192MB class of failure: skipped service XML must consume zero
// decompression budget and must not be materialized merely to throw it away afterwards.
const lean = await E.readXlsxArrayBuffer(buffer, 'task13-lean.xlsx', {
  skipSheetNames: ['Словари'],
  dictionaryCatalog: catalog,
  retainArchive: false,
  selectiveInflate: true,
});
assert.equal(lean.parsedSheets.has('Словари'), false);
assert.equal(lean.dictionaryCatalog, catalog);
assert.equal(E.releaseWorkbookArchive(lean), false);

// Static integration contract: the production file-ingest/preview and refresh paths must use
// the same selective reader with a live TESSA catalog, not only the synthetic Full UAT path.
assert.match(source, /async function readSelectedWorkbookWithLiveCatalog\s*\(/,
  'a canonical live-catalog user-file reader is required');
assert.match(source, /readSelectedWorkbookWithLiveCatalog\([^)]*file[^)]*\)/,
  'selected workbook workflow must route through the live-catalog reader');
assert.match(source, /skipSheetNames:\s*\['Словари'\][\s\S]{0,300}selectiveInflate:\s*true/,
  'user-file live reader must skip dictionary XML before decompression');

console.log('Task13 selective XLSX regression: oversized skipped service sheet is never inflated; ordinary unsafe entries remain rejected: OK');
