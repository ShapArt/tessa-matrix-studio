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

test('live GUID performer functions receive independent function dictionaries', async () => {
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

  assert.notEqual(signingId, 'roles:MtxRoles', 'real GUID FunctionType must not fall back to the raw shared MtxRoles catalog');
  assert.notEqual(requiredId, 'roles:MtxRoles', 'each real function column needs its own picker catalog');
  assert.notEqual(signingId, requiredId, 'different function columns must not share one mutable/ordered role catalog');

  const signing = catalog.catalogs[signingId];
  const required = catalog.catalogs[requiredId];
  assert.equal(roleTypes(signing)[0], 1, 'Подписание already uses Personal roles, so people must be offered first');
  assert.equal(roleTypes(required)[0], 9, 'Обязательные already uses Group roles, so that function-specific role type must be offered first');

  // Personal stays the universal safe next choice for performer functions, while other
  // legitimate TESSA role classes remain available instead of being destructively filtered.
  assert.equal(roleTypes(required)[1], 1);
  assert.deepEqual(new Set(roleTypes(signing)), new Set([0, 1, 2, 9]));
  assert.deepEqual(new Set(roleTypes(required)), new Set([0, 1, 2, 9]));
});

test('numeric FunctionType installations keep strict RoleType filtering', async () => {
  const catalog = await bridgeFixture().loadDictionaryCatalog(structure, { rows: [] }, { forceRefresh: true, transient: true });
  const personalId = catalog.columnCatalogIds['function:numeric-personal'];
  assert.deepEqual(roleTypes(catalog.catalogs[personalId]), [1, 1]);
  assert.deepEqual(roleIds(catalog.catalogs[personalId]), ['person-1', 'person-2']);
});

test('current exact RoleID/RoleTypeID value survives a function-specific dictionary overlay', async () => {
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
