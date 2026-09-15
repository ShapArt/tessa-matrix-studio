import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert.equal(typeof E.buildRoundtripGrid, 'function', 'buildRoundtripGrid export missing');

const structure = {
  templateId: 'employee-position-template',
  conditions: [],
  functions: [{ id: 'sign', name: 'Подписание', typeId: '10a72b1111f54944a386aa8982e53091', typeName: 'Исполнитель' }],
};

const bridge = Object.create(E.TessaBridge.prototype);
bridge.localizeValue = value => value == null ? '' : String(value);
bridge.queryViewSample = async alias => {
  assert.equal(alias, 'MtxRoles');
  return {
    alias,
    references: [{ colPrefix: 'Role', refSection: ['MtxRole'], displayValueColumn: 'RoleName' }],
    columns: ['RoleID', 'RoleName', 'RoleTypeID', 'FullName', 'PositionName', 'DepartmentName'],
    rows: [
      ['person-1', 'Иванов И.И.', 1, 'Иванов Иван Иванович', 'Руководитель отдела', 'ИТ'],
      ['person-2', 'Петров П.П.', 1, 'Петров Пётр Петрович', 'Главный специалист', 'ОЦО'],
      ['group-1', 'Группа согласующих', 9, '', '', ''],
    ],
    rowCount: 3,
    returnedRows: 3,
    complete: true,
    truncated: false,
  };
};

const snapshot = {
  matrixId: 'employee-matrix',
  templateId: structure.templateId,
  rows: [{
    rowCardId: 'row-1', versionId: 'version-1', values: {},
    roles: { sign: [{ id: 'person-1', display: 'Иванов И.И.', roleTypeId: 1 }] },
    flat: { 'function:sign': ['Иванов И.И.'] },
    fingerprint: 'fp-1',
  }],
};

const catalog = await bridge.loadDictionaryCatalog(structure, snapshot, { forceRefresh: true, transient: true });
const catalogId = catalog.columnCatalogIds['function:sign'];
const roleCatalog = catalog.catalogs[catalogId];
const person = roleCatalog.entries.find(entry => entry.id === 'person-1' && Number(entry.roleTypeId) === 1);
assert.ok(person, 'personal MtxRoles entry missing');
assert.equal(person.shortName, 'Иванов И.И.');
assert.equal(person.fullName, 'Иванов Иван Иванович');
assert.equal(person.position, 'Руководитель отдела');
assert.equal(person.department, 'ИТ');
assert.equal(person.displayName, 'Иванов И.И. — Руководитель отдела');
assert.equal(person.display, 'Иванов И.И. — Руководитель отдела');
assert.equal(person.selector, 'Иванов И.И. — Руководитель отдела', 'picker must show FIO + position');
assert.ok((person.previousSelectors || []).includes('Иванов И.И.'), 'bare FIO must survive as old-workbook alias');

const grid = E.buildRoundtripGrid(structure, snapshot, { matrixId: snapshot.matrixId, TemplateID: structure.templateId, TemplateName: 'Test', StateName: 'Черновик' }, catalog);
const visibleIndex = grid.columns.findIndex(column => column.key === 'function:sign' && column.kind === 'function');
const idIndex = grid.columns.findIndex(column => column.key === 'function:sign:id');
assert.ok(visibleIndex >= 0 && idIndex >= 0, 'function columns missing');
assert.equal(grid.rows[0][visibleIndex], 'Иванов И.И. — Руководитель отдела', 'existing matrix row must export enriched employee label');
assert.equal(grid.rows[0][idIndex], 'person-1|1', 'hidden RoleID/RoleTypeID must stay authoritative');

const group = roleCatalog.entries.find(entry => entry.id === 'group-1');
assert.equal(group?.display, 'Группа согласующих', 'non-personal roles must not be decorated as employees');

console.log('TESSA Matrix Studio employee position Excel projection: OK');
