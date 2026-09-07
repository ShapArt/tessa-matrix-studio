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
const ENTRY_COUNT = 140_000;
const catalogId = 'roles:stack-regression';

// v1.11.5+ can legitimately materialize well over 100k dictionary rows because
// function-specific role catalogs preserve independent ordering/selectors. Export
// must not spread the entire row array into Math.max (V8 throws RangeError before ZIP).
const entries = Array.from({ length: ENTRY_COUNT }, (_, index) => ({
  id: `role-${index}`,
  roleTypeId: '1',
  display: `Пользователь ${String(index).padStart(6, '0')}`,
  selector: `Пользователь ${String(index).padStart(6, '0')}`,
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
  { templateId: 'stack-template', conditions: [], functions: [] },
  { matrixId: 'stack-matrix', templateId: 'stack-template', rows: [] },
  { TemplateName: 'Stack regression' },
  catalog,
);

assert(bytes instanceof Uint8Array && bytes.byteLength > 0, 'large dictionary export must complete without call-stack overflow');
console.log(`TESSA XLSX stack-cardinality regression: ${ENTRY_COUNT} dictionary rows exported without RangeError`);
