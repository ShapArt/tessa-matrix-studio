import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.example.test' };
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

for (const name of ['pickerRoleTypeOptions','pickerDefaultRoleFilter','searchPickerPage','pickerEntryPresentation','bulkSelectPickerItems','bulkSelectPickerMatches']) {
  assert.equal(typeof E[name], 'function', `${name} must be exported`);
}

const catalog = { id: 'roles', sourceView: 'MtxRoles', entries: [
  { id:'p1', roleTypeId:'1', display:'Иванов И.И.', selector:'Иванов И.И.', qualifier:'Иванов Иван Иванович', details:'Email: ivanov@example.test | TypeName: Сотрудник | RolePositionName: Старший инженер; Старший инженер | Departments: Отдел инфраструктуры | RoleFullName: Иванов Иван Иванович' },
  { id:'p2', roleTypeId:'1', display:'Петров П.П.', selector:'Петров П.П.', qualifier:'Петров Пётр Петрович', details:'TypeName: Сотрудник | RolePositionName: Аналитик | Departments: Аналитический отдел | RoleFullName: Петров Пётр Петрович' },
  { id:'p3', roleTypeId:'1', display:'Сидоров С.С.', selector:'Сидоров С.С.', qualifier:'Сидоров Сергей Сергеевич', details:'TypeName: Сотрудник | RolePositionName: Инженер | Departments: Отдел инфраструктуры | RoleFullName: Сидоров Сергей Сергеевич' },
  { id:'p4', roleTypeId:'1', display:'Орлов О.О.', selector:'Орлов О.О.', qualifier:'Орлов Олег Олегович', details:'TypeName: Сотрудник | RolePositionName: Инженер | Departments: Производство | RoleFullName: Орлов Олег Олегович' },
  { id:'p5', roleTypeId:'1', display:'Таразян Л.Г.', selector:'Таразян Л.Г.', qualifier:'Таразян Людмила Георгиевна', details:'TypeName: Сотрудник | RolePositionName: Бизнес-эксперт; Должность КА2; Сотрудник (тест) | Departments: Направление развития систем документооборота | RoleFullName: Таразян Людмила Георгиевна' },
  { id:'d1', roleTypeId:'2', display:'Отдел инфраструктуры', selector:'Отдел инфраструктуры', qualifier:'Подразделение', details:'TypeName: Подразделение | Info: ИТ' },
  { id:'s1', roleTypeId:'0', display:'Администраторы', selector:'Администраторы', qualifier:'Статическая', details:'TypeName: Статическая роль' },
  { id:'g1', roleTypeId:'9', display:'Группа согласующих', selector:'Группа согласующих', qualifier:'Группа', details:'TypeName: Группа' },
] };
const column = { key:'function:sign', kind:'function', label:'Подписание', catalog };

const options = E.pickerRoleTypeOptions(column);
assert.equal(options[0].value, 'all');
assert.ok(options.some(item => item.value === '1' && /Сотрудник/.test(item.label)));
assert.ok(options.some(item => item.value === '2' && /Подраздел/.test(item.label)));
assert.ok(options.some(item => item.value === '9' && /Групп/.test(item.label)));
assert.equal(E.pickerDefaultRoleFilter(column), '1', 'function picker should open on employees when Personal roles exist');

let page = E.searchPickerPage(catalog, { query:'инженер', roleType:'1', page:1, pageSize:2 });
assert.equal(page.total, 3, 'position/details must participate in search');
assert.equal(page.items.length, 2);
assert.equal(page.pageCount, 2);
assert.equal(page.page, 1);
const page2 = E.searchPickerPage(catalog, { query:'инженер', roleType:'1', page:2, pageSize:2 });
assert.equal(page2.items.length, 1);
assert.equal(page2.page, 2);
assert.ok(page.items.every(item => String(item.roleTypeId) === '1'));

// Production UX: the first line must be what a matrix editor actually needs to scan:
// native short FIO + position. Full FIO and department are secondary context. The exact
// selector copied to Excel remains unchanged and therefore keeps the ID-bound contract.
const presentation = E.pickerEntryPresentation(catalog.entries[0]);
assert.equal(presentation.title, 'Иванов И.И. — Старший инженер');
assert.match(presentation.subtitle, /Иванов Иван Иванович/);
assert.match(presentation.subtitle, /Отдел инфраструктуры/);
assert.match(presentation.subtitle, /Сотрудник/);
assert.doesNotMatch(presentation.subtitle, /example\.test/, 'email must not clutter the picker row');
assert.equal(presentation.value, 'Иванов И.И.', 'rich UI must not change the exact Excel selector');

const multiPosition = E.pickerEntryPresentation(catalog.entries[4]);
assert.equal(multiPosition.title, 'Таразян Л.Г. — Бизнес-эксперт (+2)',
  'multiple TESSA positions must stay readable instead of producing a long repeated title');
assert.match(multiPosition.subtitle, /Таразян Людмила Георгиевна/);
assert.doesNotMatch(multiPosition.title, /Должность КА2.*Сотрудник \(тест\)/,
  'secondary positions must not make the primary result row unreadable');

// Namesakes must be visually distinguishable by position while their exact identity
// remains separate. This is the real-life reason positions are required in the picker.
const namesakeA = E.pickerEntryPresentation({ id:'same-a', roleTypeId:'1', display:'Иванов И.И.', selector:'Иванов И.И. — вариант 1', details:'RoleFullName: Иванов Иван Иванович | RolePositionName: Аналитик | Departments: Отдел А' });
const namesakeB = E.pickerEntryPresentation({ id:'same-b', roleTypeId:'1', display:'Иванов И.И.', selector:'Иванов И.И. — вариант 2', details:'RoleFullName: Иванов Иван Иванович | RolePositionName: Руководитель | Departments: Отдел Б' });
assert.notEqual(namesakeA.title, namesakeB.title);
assert.equal(namesakeA.title, 'Иванов И.И. — Аналитик');
assert.equal(namesakeB.title, 'Иванов И.И. — Руководитель');
assert.notEqual(namesakeA.value, namesakeB.value, 'namesakes must keep distinct exact selectors');

let selected = new Map();
let bulk = E.bulkSelectPickerItems(selected, page.items);
selected = bulk.selected;
assert.equal(bulk.added, 2);
bulk = E.bulkSelectPickerItems(selected, page2.items);
selected = bulk.selected;
assert.equal(selected.size, 3, 'selection must survive changing pages');
assert.equal(E.pickerSelectionText([...selected.values()]).split('\n').length, 3);

const longCatalog = { entries: Array.from({ length: 1000 }, (_, i) => ({ id:`x${i}`, roleTypeId:'1', display:`Сотрудник ${i} ${'X'.repeat(90)}`, selector:`Сотрудник ${i} ${'X'.repeat(90)}` })) };
const mass = E.bulkSelectPickerMatches(new Map(), longCatalog, { query:'сотрудник', roleType:'1' });
assert.ok(mass.added > 100, 'bulk select should add many matches');
assert.ok(mass.added < 1000, 'bulk select must stop before Excel cell limit');
assert.equal(mass.capacityReached, true);
assert.doesNotThrow(() => E.pickerSelectionText([...mass.selected.values()]));
assert.ok(E.pickerSelectionText([...mass.selected.values()]).length <= 32767);

console.log('TESSA Matrix Studio production picker: short FIO + position, role filters, paging and bulk selection: OK');
