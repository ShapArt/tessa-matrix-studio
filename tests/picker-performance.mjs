import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.example.test' };
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert.equal(typeof E.searchPickerPage, 'function', 'paged picker search must exist');

const count = 100000;
const catalog = { id:'perf-roles', sourceView:'MtxRoles', entries:Array.from({ length:count }, (_, i) => ({
  id:`person-${i}`,
  roleTypeId:i % 20 === 0 ? '2' : '1',
  display:`Пользователь ${i}`,
  selector:`Пользователь ${i}`,
  details:`TypeName: ${i % 20 === 0 ? 'Подразделение' : 'Сотрудник'} | RolePositionName: ${i === 99999 ? 'Уникальная должность needle-position' : 'Специалист'} | RoleFullName: Пользователь Полный ${i}`,
})) };

let started = performance.now();
const first = E.searchPickerPage(catalog, { query:'needle-position', roleType:'1', page:1, pageSize:60 });
const firstMs = performance.now() - started;
assert.equal(first.total, 1);
assert.equal(first.items[0].id, 'person-99999');
assert.ok(firstMs < 6000, `initial 100k picker index/search is too slow: ${firstMs.toFixed(1)}ms`);

started = performance.now();
for (let i = 0; i < 20; i += 1) {
  const page = E.searchPickerPage(catalog, { query:`пользователь ${90000 + i}`, roleType:'1', page:1, pageSize:60 });
  assert.ok(page.total >= 0);
}
const repeatMs = performance.now() - started;
assert.ok(repeatMs < 2500, `20 cached 100k searches are too slow: ${repeatMs.toFixed(1)}ms`);

const browse = E.searchPickerPage(catalog, { query:'', roleType:'2', page:3, pageSize:50 });
assert.equal(browse.items.length, 50);
assert.equal(browse.page, 3);
assert.ok(browse.total > 4000);

console.log(`TESSA Matrix Studio large picker performance: 100k initial=${firstMs.toFixed(1)}ms cached20=${repeatMs.toFixed(1)}ms`);
