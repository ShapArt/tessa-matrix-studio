import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
const storage = new Map();
globalThis.sessionStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};
globalThis.document = {
  body: { innerText: '' },
  querySelector: () => null,
  querySelectorAll: () => [],
};

const configuredSource = process.env.TMS_TEST_SOURCE;
const source = configuredSource
  ? fs.readFileSync(configuredSource, 'utf8')
  : fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source, { filename: 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

assert.match(source, /V1\.15_PERFORMANCE_RELIABILITY_UX_V1/);
assert.match(source, /BLOCKED_ROLE_BASELINE_FALLBACK_V1/);
assert.match(source, /COMPACT_ROLE_CATALOG_V1/);
assert.match(source, /VALUE_LEVEL_RECOVERY_V1/);

assert.match(source, /FULL_UAT_RESOURCE_SAFETY_V1/,
  'Full UAT must include browser resource/OOM-prevention checks');
assert.match(source, /FULL_UAT_DICTIONARY_INVALID_VALUE_LEVEL_V1/,
  'dictionary-invalid UAT must understand field/value-level fail-closed recovery');
for (const id of [
  'resource-input-limit',
  'resource-entry-limit',
  'resource-path-traversal',
  'resource-spreadsheet-bounds',
  'memory-bounded-roundtrip',
]) {
  assert.ok(source.includes(`runCheck('${id}'`), `Full UAT resource check missing: ${id}`);
}
assert.match(source, /skippedValues:\s*\(plan\?\.skippedValues \|\| \[\]\)\.slice\(0, 30\)/,
  'Full UAT compact evidence must include skippedValues');
assert.match(source, /leakedIntoExecutableChange/,
  'dictionary-invalid must prove the bad value never reaches executable changes');
assert.match(source, /XLSX_ARCHIVE_LIMITS, SPREADSHEETML_LIMITS/,
  'resource ceilings must be visible to Full UAT through the test export');

// A disabled account can disappear from live MtxRoles, but an older Studio workbook
// contains cryptographically-equivalent roundtrip evidence: visible value + exact RoleID
// + RoleTypeID inside its baseline. Preserve that identity instead of silently dropping it.
{
  const column = { key: 'function:required', kind: 'function', excelHeader: 'Обязательные' };
  const workbook = {
    roundtrip: {
      enabled: true,
      baselineRows: [{
        rowCardId: 'row-1',
        versionId: 'version-1',
        base: {
          roles: {
            required: [{ id: 'blocked-alanteva', roleTypeId: 1, display: 'Алантьева Е.Ю.' }],
          },
        },
      }],
    },
    dictionaryCatalog: {
      catalogs: {
        roles: {
          id: 'roles',
          sourceView: 'MtxRoles',
          entries: [{ id: 'active-user', roleTypeId: 1, display: 'Активный А.А.', selector: 'Активный А.А.' }],
        },
      },
      columnCatalogIds: { 'function:required': 'roles' },
      stats: { errors: [], warnings: [] },
    },
  };

  const preserved = E.resolveEmbeddedDictionaryValue(workbook, column, 'Алантьева Е.Ю.', 'blocked-alanteva|1');
  assert.equal(preserved.resolved, true);
  assert.equal(preserved.explicit, 'blocked-alanteva|1');
  assert.equal(preserved.resolution, 'historical-role-id');

  const forged = E.resolveEmbeddedDictionaryValue(workbook, column, 'Алантьева Е.Ю.', 'not-in-baseline|1');
  assert.equal(forged.resolved, false, 'an arbitrary hidden GUID must not bypass dictionary validation');
}

// The role catalog is global. Ten custom functions must route to one physical catalog,
// otherwise the hidden Excel sheet grows roughly tenfold and refresh can exhaust memory.
{
  const bridge = Object.create(E.TessaBridge.prototype);
  bridge.localizeValue = value => value == null ? '' : String(value);
  const roleRows = Array.from({ length: 1000 }, (_, i) => [`person-${i}`, `Сотрудник ${i}`, 1]);
  bridge.queryViewSample = async alias => ({
    alias,
    references: [{ colPrefix: 'Role', refSection: ['MtxRole'], displayValueColumn: 'RoleName' }],
    columns: ['RoleID', 'RoleName', 'RoleTypeID'],
    rows: roleRows,
    rowCount: roleRows.length,
    returnedRows: roleRows.length,
    complete: true,
    truncated: false,
  });

  const functions = Array.from({ length: 10 }, (_, i) => ({
    id: `fn-${i}`,
    name: `Функция ${i}`,
    typeId: '10a72b1111f54944a386aa8982e53091',
  }));
  const catalog = await bridge.loadDictionaryCatalog(
    { templateId: 'template-compact', conditions: [], functions },
    { rows: [] },
    { forceRefresh: true, transient: true },
  );
  const routed = new Set(functions.map(fn => catalog.columnCatalogIds[`function:${fn.id}`]));
  assert.deepEqual([...routed], ['roles:MtxRoles']);
  assert.equal(catalog.catalogs['roles:MtxRoles'].entries.length, 1000);
  assert.equal(catalog.stats.entries, 1000, 'stats must count physical entries, not ten virtual copies');
}

// Long-running work gets a tiny resumable checkpoint. Chrome may freeze a hidden tab;
// the checkpoint is about safe recovery/diagnostics, not pretending timers run while frozen.
{
  const checkpoint = E.longJobCheckpoint('preview:plan', { operation: 'preview', rows: 503 });
  assert.equal(checkpoint.stage, 'preview:plan');
  assert.equal(E.restoreLongJobCheckpoint().detail.rows, 503);
  E.clearLongJobCheckpoint();
  assert.equal(E.restoreLongJobCheckpoint(), null);
}

console.log('TESSA Matrix Studio v1.15 reliability regressions: blocked roles + compact catalog + lifecycle checkpoint OK');
