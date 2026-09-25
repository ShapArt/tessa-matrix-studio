import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));

const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;
const LIVE_PERFORMER_FUNCTION_TYPE = '10a72b1111f54944a386aa8982e53091';

const structure = {
  templateId: 'template-role-types',
  conditions: [],
  functions: [
    { id: 'signing', name: 'Подписание', typeId: LIVE_PERFORMER_FUNCTION_TYPE, typeName: 'Исполнитель' },
    { id: 'required', name: 'Обязательные', typeId: LIVE_PERFORMER_FUNCTION_TYPE, typeName: 'Исполнитель' },
    // Keep one numeric fixture: old/other installations that really expose RoleType here
    // must retain exact typed filtering instead of being regressed by the live-GUID fix.
    { id: 'numeric-personal', name: 'Legacy Personal', typeId: '1', typeName: 'Personal' },
  ],
};

function bridgeFixture() {
  const bridge = Object.create(E.TessaBridge.prototype);
  bridge.localizeValue = value => value == null ? '' : String(value);
  bridge.queryViewSample = async alias => {
    assert.equal(alias, 'MtxRoles');
    return {
      alias,
      references: [{ colPrefix: 'Role', refSection: ['MtxRole'], displayValueColumn: 'RoleName' }],
      columns: ['RoleID', 'RoleName', 'RoleTypeID'],
      // Deliberately put non-personal roles first, matching the real broken dropdowns.
      rows: [
        ['department-1', 'КУРЧАТОВСКОЕ ОТДЕЛЕНИЕ', 2],
        ['static-1', 'SCHULZ SYSTEMTECHNIK GMBH', 0],
        ['group-1', 'Группа согласующих', 9],
        ['person-1', 'Дольская Т.С.', 1],
        ['person-2', 'Цветаева М.И.', 1],
      ],
      rowCount: 5,
      returnedRows: 5,
      complete: true,
      truncated: false,
    };
  };
  return bridge;
}

const roleTypes = catalog => catalog.entries.map(entry => Number(entry.roleTypeId));
const roleIds = catalog => catalog.entries.map(entry => entry.id);

test('live GUID performer functions share one compact MtxRoles dictionary', async () => {
  const snapshot = {
    rows: [
      {
        roles: {
          signing: [{ id: 'person-1', display: 'Дольская Т.С.', roleTypeId: 1 }],
          required: [{ id: 'group-1', display: 'Группа согласующих', roleTypeId: 9 }],
          'numeric-personal': [],
        },
      },
    ],
  };
  const catalog = await bridgeFixture().loadDictionaryCatalog(structure, snapshot, { forceRefresh: true, transient: true });
  const signingId = catalog.columnCatalogIds['function:signing'];
  const requiredId = catalog.columnCatalogIds['function:required'];

  assert.equal(signingId, 'roles:MtxRoles', 'GUID/custom function must reuse the physical MtxRoles catalog');
  assert.equal(requiredId, 'roles:MtxRoles', 'all compatible performer functions must share one physical catalog');
  assert.equal(signingId, requiredId, 'duplicate 20k–30k role lists must not be materialized per function');

  const shared = catalog.catalogs[signingId];
  assert.deepEqual(new Set(roleTypes(shared)), new Set([0, 1, 2, 9]));
  assert.ok(shared.functionPolicies?.signing, 'per-function observed role metadata must remain available without cloning entries');
  assert.ok(shared.functionPolicies?.required, 'every shared function must retain its ranking policy metadata');
  assert.deepEqual(shared.functionPolicies.signing.observedRoleTypeIds, [1]);
  assert.deepEqual(shared.functionPolicies.required.observedRoleTypeIds, [9]);
});

test('numeric FunctionType installations keep strict RoleType filtering', async () => {
  const catalog = await bridgeFixture().loadDictionaryCatalog(structure, { rows: [] }, { forceRefresh: true, transient: true });
  const personalId = catalog.columnCatalogIds['function:numeric-personal'];
  assert.deepEqual(roleTypes(catalog.catalogs[personalId]), [1, 1]);
  assert.deepEqual(roleIds(catalog.catalogs[personalId]), ['person-1', 'person-2']);
});

test('current exact RoleID/RoleTypeID value survives the shared compact dictionary overlay', async () => {
  const snapshot = {
    rows: [{
      rowCardId: 'row-1',
      versionId: 'version-1',
      values: {},
      roles: {
        signing: [{ id: 'legacy-meta', display: 'Legacy Meta', roleTypeId: 5 }],
        required: [],
        'numeric-personal': [],
      },
      flat: {
        'function:signing': ['Legacy Meta'],
        'function:required': [],
        'function:numeric-personal': [],
      },
    }],
  };
  const catalog = await bridgeFixture().loadDictionaryCatalog(structure, snapshot, { forceRefresh: true, transient: true });
  const signing = catalog.catalogs[catalog.columnCatalogIds['function:signing']];

  const legacy = signing.entries.find(entry => entry.id === 'legacy-meta');
  assert.ok(legacy, 'a role already stored in the matrix must remain roundtrip-readable even when absent from MtxRoles');
  assert.equal(Number(legacy.roleTypeId), 5);
  assert.ok(signing.entries.some(entry => entry.id === 'person-1'));
});
