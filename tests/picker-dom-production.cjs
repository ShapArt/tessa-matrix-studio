const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://tessa.example.test',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const w = dom.window;
w.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
w.TextEncoder = TextEncoder;
w.TextDecoder = TextDecoder;
let source = fs.readFileSync(path.join(__dirname, '../tessa-matrix-studio.user.js'), 'utf8')
  .replace('window.__TESSA_MATRIX_SYNC_EXPORTS__ = {', 'window.__pickerDomTest={APP,mountUi,openValuePicker,renderPickerResults}; window.__TESSA_MATRIX_SYNC_EXPORTS__ = {');
w.eval(source);

(async () => {
  const U = w.__pickerDomTest;
  U.mountUi();
  U.APP.runtimeMonitor.stop();

  const people = Array.from({ length: 65 }, (_, i) => ({
    id: `person-${i + 1}`,
    roleTypeId: 1,
    display: `Иванов И.${i + 1}.`,
    selector: `Иванов И.${i + 1}.`,
    qualifier: `Иванов Иван ${i + 1}`,
    details: `TypeName: Сотрудник | RoleFullName: Иванов Иван ${i + 1} | RolePositionName: ${i === 64 ? 'Главный инженер needle-position' : 'Инженер'} | Departments: Отдел инфраструктуры`,
  }));
  const roleCatalog = {
    sourceView: 'MtxRoles',
    entries: [
      ...people,
      { id: 'department-1', roleTypeId: 2, display: 'Отдел инфраструктуры', selector: 'Отдел инфраструктуры', details: 'TypeName: Подразделение | Info: ИТ' },
      { id: 'group-1', roleTypeId: 9, display: 'Группа согласующих', selector: 'Группа согласующих', details: 'TypeName: Группа' },
    ],
  };
  const orgCatalog = {
    sourceView: 'GchPartners',
    entries: [
      { id: 'org-1', display: 'ООО Альфа', selector: 'ООО Альфа' },
      { id: 'org-2', display: 'ООО Бета', selector: 'ООО Бета' },
    ],
  };

  U.APP.structure = {
    conditions: [{ criterionRowId: 'org', criterionName: 'Организация', operandTypeId: '89D5C112-CF02-4B22-97CB-7E6AB7FADC4E' }],
    functions: [{ id: 'sign', name: 'Подписание' }],
  };
  U.APP.snapshot = { rows: [] };
  U.APP.dictionaryCatalog = {
    catalogs: { roles: roleCatalog, orgs: orgCatalog },
    columnCatalogIds: { 'criterion:org': 'orgs', 'function:sign': 'roles' },
  };

  await U.openValuePicker();
  const host = w.document.querySelector('#tms-value-picker');
  const fields = host.querySelector('#tms-picker-column');
  // criterion comes first; switch to function picker.
  fields.value = '1';
  fields.dispatchEvent(new w.Event('change', { bubbles: true }));

  const roleWrap = host.querySelector('#tms-picker-role-type-wrap');
  const roleType = host.querySelector('#tms-picker-role-type');
  assert.ok(roleWrap, 'role type filter wrapper must exist');
  assert.equal(roleWrap.hidden, false, 'role filter must be visible for function columns');
  assert.equal(roleType.value, '1', 'function picker must default to employees when present');
  assert.match(roleType.textContent, /Сотрудник/);
  assert.match(roleType.textContent, /Подразделение/);
  assert.match(roleType.textContent, /Группа/);

  assert.ok(host.querySelector('#tms-picker-select-page'), 'select-page control missing');
  assert.ok(host.querySelector('#tms-picker-select-all'), 'select-all-results control missing');
  assert.ok(host.querySelector('#tms-picker-prev'), 'previous-page control missing');
  assert.ok(host.querySelector('#tms-picker-next'), 'next-page control missing');
  assert.match(host.querySelector('#tms-picker-page-status').textContent, /1\s*\/\s*2/);
  assert.equal(host.querySelectorAll('#tms-picker-results .tms-picker-option').length, 60, 'DOM must render only one bounded page');

  const firstRow = host.querySelector('#tms-picker-results .tms-picker-option');
  assert.match(firstRow.querySelector('.tms-picker-option-title').textContent, /Иванов И\.1\.\s+—\s+Инженер/);
  assert.match(firstRow.querySelector('.tms-picker-option-meta').textContent, /Иванов Иван 1/);
  assert.match(firstRow.querySelector('.tms-picker-option-meta').textContent, /Отдел инфраструктуры/);
  assert.match(firstRow.querySelector('.tms-picker-option-meta').textContent, /Сотрудник/);

  host.querySelector('#tms-picker-select-page').click();
  assert.equal(host.querySelector('#tms-picker-output').value.split('\n').length, 60, 'page bulk-selection must select the rendered page');
  host.querySelector('#tms-picker-next').click();
  assert.match(host.querySelector('#tms-picker-page-status').textContent, /2\s*\/\s*2/);
  assert.equal(host.querySelectorAll('#tms-picker-results .tms-picker-option').length, 5);
  assert.match(host.querySelector('#tms-picker-count').textContent, /выбрано:\s*60/i, 'selection must survive paging');
  host.querySelector('#tms-picker-select-page').click();
  assert.equal(host.querySelector('#tms-picker-output').value.split('\n').length, 65);

  const query = host.querySelector('#tms-picker-query');
  query.value = 'needle-position';
  query.dispatchEvent(new w.Event('input', { bubbles: true }));
  U.renderPickerResults();
  assert.equal(host.querySelectorAll('#tms-picker-results .tms-picker-option').length, 1);
  assert.match(host.querySelector('#tms-picker-results').textContent, /Главный инженер needle-position/);

  query.value = '';
  query.dispatchEvent(new w.Event('input', { bubbles: true }));
  U.renderPickerResults();
  roleType.value = '2';
  roleType.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(host.querySelectorAll('#tms-picker-results .tms-picker-option').length, 1);
  assert.match(host.querySelector('#tms-picker-results').textContent, /Отдел инфраструктуры/);

  // Return to employees and prove all matching values can be selected without walking pages.
  roleType.value = '1';
  roleType.dispatchEvent(new w.Event('change', { bubbles: true }));
  host.querySelector('#tms-picker-clear').click();
  query.value = 'инженер';
  query.dispatchEvent(new w.Event('input', { bubbles: true }));
  U.renderPickerResults();
  host.querySelector('#tms-picker-select-all').click();
  assert.equal(host.querySelector('#tms-picker-output').value.split('\n').length, 65);
  assert.match(host.querySelector('#tms-picker-message').textContent, /65/);

  // Non-function dictionaries must not show a meaningless role-type filter.
  fields.value = '0';
  fields.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(roleWrap.hidden, true);
  assert.equal(host.querySelectorAll('#tms-picker-results .tms-picker-option').length, 2);

  console.log('DOM production picker: short FIO + position, full FIO metadata, paging and bulk selection OK');
  dom.window.close();
})().catch(error => {
  console.error(error);
  dom.window.close();
  process.exitCode = 1;
});
