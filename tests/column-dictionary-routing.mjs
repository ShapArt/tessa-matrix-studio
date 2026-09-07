import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));

const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;
const { OPERAND } = E.constants;

const structure = {
  templateId: 'template-column-dictionaries',
  conditions: [
    {
      criterionRowId: 'user',
      criterionName: 'Инициатор',
      operandTypeId: OPERAND.ReferenceGuid,
      autocompleteViewName: 'CompositeDirectory',
      autocompleteParamName: 'UserName',
      refSection: 'Users',
    },
    {
      criterionRowId: 'department',
      criterionName: 'Подразделение исполнителя',
      operandTypeId: OPERAND.ReferenceGuid,
      autocompleteViewName: 'CompositeDirectory',
      autocompleteParamName: 'DepartmentName',
      refSection: 'Departments',
    },
    {
      criterionRowId: 'boolean',
      criterionName: 'Признак',
      operandTypeId: OPERAND.Boolean,
    },
    {
      criterionRowId: 'text',
      criterionName: 'Комментарий',
      operandTypeId: OPERAND.String,
    },
    {
      criterionRowId: 'amount',
      criterionName: 'Сумма',
      operandTypeId: OPERAND.Decimal,
    },
  ],
  functions: [],
};

function bridgeFixture() {
  const bridge = Object.create(E.TessaBridge.prototype);
  bridge.localizeValue = value => value == null ? '' : String(value);
  bridge.findCompatibleViewAlias = condition => condition.autocompleteViewName || null;
  bridge.queryViewSample = async alias => {
    if (alias === 'MtxRoles') return { alias, columns: [], rows: [], rowCount: 0, returnedRows: 0, complete: true, truncated: false };
    assert.equal(alias, 'CompositeDirectory');
    return {
      alias,
      references: [
        { colPrefix: 'User', refSection: ['Users'], displayValueColumn: 'UserName' },
        { colPrefix: 'Department', refSection: ['Departments'], displayValueColumn: 'DepartmentName' },
      ],
      columns: ['UserID', 'UserName', 'DepartmentID', 'DepartmentName'],
      rows: [
        ['user-1', 'Дольская Т.С.', 'department-1', 'КУРЧАТОВСКОЕ ОТДЕЛЕНИЕ'],
        ['user-2', 'Цветаева М.И.', 'department-2', 'Лаборатория — Подразделение 1'],
      ],
      rowCount: 2,
      returnedRows: 2,
      complete: true,
      truncated: false,
    };
  };
  return bridge;
}

const ids = catalog => catalog.entries.map(entry => entry.id).sort();

test('reference columns using one view stay separated by RefSection projection', async () => {
  const catalog = await bridgeFixture().loadDictionaryCatalog(structure, { rows: [] }, { forceRefresh: true, transient: true });
  const userCatalogId = catalog.columnCatalogIds['criterion:user'];
  const departmentCatalogId = catalog.columnCatalogIds['criterion:department'];

  assert.ok(userCatalogId, 'Инициатор must receive a reference dictionary');
  assert.ok(departmentCatalogId, 'Подразделение исполнителя must receive a reference dictionary');
  assert.notEqual(userCatalogId, departmentCatalogId, 'different RefSection projections must never share one Excel validation list');
  assert.deepEqual(ids(catalog.catalogs[userCatalogId]), ['user-1', 'user-2']);
  assert.deepEqual(ids(catalog.catalogs[departmentCatalogId]), ['department-1', 'department-2']);
  assert.deepEqual(catalog.catalogs[userCatalogId].entries.map(entry => entry.display).sort(), ['Дольская Т.С.', 'Цветаева М.И.']);
  assert.deepEqual(catalog.catalogs[departmentCatalogId].entries.map(entry => entry.display).sort(), ['КУРЧАТОВСКОЕ ОТДЕЛЕНИЕ', 'Лаборатория — Подразделение 1']);
});

test('Boolean gets its own selector while scalar text/numeric columns get no fake dictionary', async () => {
  const catalog = await bridgeFixture().loadDictionaryCatalog(structure, { rows: [] }, { forceRefresh: true, transient: true });
  const booleanCatalogId = catalog.columnCatalogIds['criterion:boolean'];

  assert.ok(booleanCatalogId, 'Boolean criterion must receive Да/Нет validation');
  assert.deepEqual(new Set(ids(catalog.catalogs[booleanCatalogId])), new Set(['true', 'false']));
  assert.equal(catalog.columnCatalogIds['criterion:text'], undefined, 'String scalar must remain a free-value cell');
  assert.equal(catalog.columnCatalogIds['criterion:amount'], undefined, 'Decimal scalar must remain a typed numeric cell');
});
