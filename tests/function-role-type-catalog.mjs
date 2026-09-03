import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));

const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;

const structure = {
  templateId: 'template-role-types',
  conditions: [],
  functions: [
    { id: 'personal', name: 'Подписание', typeId: '1', typeName: 'Personal' },
    { id: 'department', name: 'Согласование подразделением', typeId: '2', typeName: 'Department' },
    { id: 'unknown', name: 'Неизвестная функция', typeId: 'custom-type', typeName: 'Custom' },
  ],
};

function bridgeFixture() {
  const bridge = Object.create(E.TessaBridge.prototype);
  bridge.localizeValue = value => value == null ? '' : String(value);
  bridge.queryViewSample = async alias => {
    assert.equal(alias, 'MtxRoles');
    return {
      alias,
      references: [{ colPrefix: 'Role', refSection: ['Roles'], displayValueColumn: 'RoleName' }],
      columns: ['RoleID', 'RoleName', 'RoleTypeID'],
      rows: [
        ['person-1', 'Иванов Иван Иванович', 1],
        ['department-current', 'Юридический департамент', 2],
        ['department-other', 'Финансовый департамент', 2],
      ],
      rowCount: 3,
      returnedRows: 3,
      complete: true,
      truncated: false,
    };
  };
  return bridge;
}

const roleTypes = catalog => catalog.entries.map(entry => Number(entry.roleTypeId)).sort((a, b) => a - b);
const roleIds = catalog => catalog.entries.map(entry => entry.id).sort();

test('function picker catalogs are partitioned by FunctionType/RoleTypeID', async () => {
  const catalog = await bridgeFixture().loadDictionaryCatalog(structure, { rows: [] }, { forceRefresh: true, transient: true });
  const personalId = catalog.columnCatalogIds['function:personal'];
  const departmentId = catalog.columnCatalogIds['function:department'];
  const unknownId = catalog.columnCatalogIds['function:unknown'];

  assert.notEqual(personalId, departmentId, 'Personal and Department functions must not share an unfiltered picker catalog');
  assert.deepEqual(roleTypes(catalog.catalogs[personalId]), [1]);
  assert.deepEqual(roleIds(catalog.catalogs[personalId]), ['person-1']);
  assert.deepEqual(roleTypes(catalog.catalogs[departmentId]), [2, 2]);
  assert.deepEqual(roleIds(catalog.catalogs[departmentId]), ['department-current', 'department-other']);

  // Unknown FunctionType values are not guessed: retain the conservative shared source.
  assert.deepEqual(roleTypes(catalog.catalogs[unknownId]), [1, 2, 2]);
});

test('legacy current value survives exact ID/RoleTypeID overlay without exposing every wrong-type role', async () => {
  const snapshot = {
    rows: [{
      rowCardId: 'row-1',
      versionId: 'version-1',
      values: {},
      roles: {
        personal: [{ id: 'department-current', display: 'Юридический департамент', roleTypeId: 2 }],
        department: [],
        unknown: [],
      },
      flat: {
        'function:personal': ['Юридический департамент'],
        'function:department': [],
        'function:unknown': [],
      },
    }],
  };
  const catalog = await bridgeFixture().loadDictionaryCatalog(structure, snapshot, { forceRefresh: true, transient: true });
  const personal = catalog.catalogs[catalog.columnCatalogIds['function:personal']];

  assert.deepEqual(roleIds(personal), ['department-current', 'person-1']);
  const legacy = personal.entries.find(entry => entry.id === 'department-current');
  assert.equal(Number(legacy.roleTypeId), 2);
  assert.ok(!personal.entries.some(entry => entry.id === 'department-other'), 'unrelated Department roles must not be offered in a Personal picker');
});
