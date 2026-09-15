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
const column = { key: 'function:sign', kind: 'function', excelHeader: 'Подписание' };

const catalog = E.normalizeDictionaryCatalog({
  catalogs: {
    people: {
      id: 'people',
      label: 'Подписание · роли и пользователи TESSA',
      sourceView: 'MtxRoles',
      entries: [
        {
          id: 'p1', roleTypeId: 1,
          display: 'Иванов И.И. — Руководитель отдела',
          displayName: 'Иванов И.И. — Руководитель отдела',
          shortName: 'Иванов И.И.', fullName: 'Иванов Иван Иванович',
          position: 'Руководитель отдела', department: 'ИТ', nativeDisplay: 'Иванов И.И.',
          previousSelectors: ['Иванов И.И.'], source: 'MtxRoles', status: 'Доступно',
        },
        {
          id: 'p2', roleTypeId: 1,
          display: 'Иванов И.И. — Главный специалист',
          displayName: 'Иванов И.И. — Главный специалист',
          shortName: 'Иванов И.И.', fullName: 'Иванов Игорь Ильич',
          position: 'Главный специалист', department: 'ОЦО', nativeDisplay: 'Иванов И.И.',
          previousSelectors: ['Иванов И.И.'], source: 'MtxRoles', status: 'Доступно',
        },
        {
          id: 'p3', roleTypeId: 1,
          display: 'Петров П.П. — Эксперт',
          displayName: 'Петров П.П. — Эксперт',
          shortName: 'Петров П.П.', fullName: 'Петров Пётр Петрович',
          position: 'Эксперт', department: 'ОЦО', nativeDisplay: 'Петров П.П.',
          previousSelectors: ['Петров П.П.'], source: 'MtxRoles', status: 'Доступно',
        },
        {
          id: 'kireeva', roleTypeId: 1,
          display: 'Киреева Ю.А. — Руководитель управления',
          displayName: 'Киреева Ю.А. — Руководитель управления',
          shortName: 'Киреева Ю.А.', fullName: 'Киреева Юлия Александровна',
          position: 'Руководитель управления', department: 'ОЦО', nativeDisplay: 'Киреева Ю.А.',
          previousSelectors: ['Киреева Ю.А.'], source: 'MtxRoles', status: 'Доступно',
        },
      ],
    },
  },
  columnCatalogIds: { 'function:sign': 'people' },
  stats: { errors: [], warnings: [] },
});
const workbook = { dictionaryCatalog: catalog };

let resolved = E.resolveEmbeddedDictionaryValue(workbook, column, 'Иванов И.И. — Руководитель отдела', '');
assert.equal(resolved.resolved, true);
assert.equal(resolved.explicit, 'p1|1');

resolved = E.resolveEmbeddedDictionaryValue(workbook, column, 'Иванов Иван Иванович', '');
assert.equal(resolved.resolved, true, resolved.issue || 'full FIO did not resolve');
assert.equal(resolved.explicit, 'p1|1');
assert.equal(resolved.display, 'Иванов И.И. — Руководитель отдела');

resolved = E.resolveEmbeddedDictionaryValue(workbook, column, 'Петров П.П.', '');
assert.equal(resolved.resolved, true, resolved.issue || 'unique short FIO did not resolve');
assert.equal(resolved.explicit, 'p3|1');
assert.equal(resolved.display, 'Петров П.П. — Эксперт');

resolved = E.resolveEmbeddedDictionaryValue(workbook, column, 'Иванов И.И.', '');
assert.equal(resolved.resolved, false, 'same short FIO without position must fail closed');
assert.match(resolved.issue || '', /неоднознач/i);

// Hidden RoleID is authoritative for old roundtrip workbooks even when the old visible
// cell contains only the bare FIO and that FIO is now ambiguous in live MtxRoles.
resolved = E.resolveEmbeddedDictionaryValue(workbook, column, 'Иванов И.И.', 'p2|1');
assert.equal(resolved.resolved, true, resolved.issue || 'explicit RoleID did not preserve old workbook compatibility');
assert.equal(resolved.explicit, 'p2|1');
assert.equal(resolved.display, 'Иванов И.И. — Главный специалист');

// Regression from live UAT: a position is searchable metadata, not person identity.
// Even one unique employee carrying this position must never be silently selected from
// a position-only cell. Studio must expose a structured candidate for explicit choice.
resolved = E.resolveEmbeddedDictionaryValue(workbook, column, 'Руководитель управления', '');
assert.equal(resolved.resolved, false, 'position-only text must never auto-select Киреева or any other person');
assert.equal(resolved.resolution, 'employee-position-only');
assert.ok(Array.isArray(resolved.candidates) && resolved.candidates.some(item => item.id === 'kireeva'),
  `position ambiguity must expose structured current candidates: ${JSON.stringify(resolved)}`);
assert.match(resolved.issue || '', /выберите.*сотрудник|должност/i);

console.log('TESSA Matrix Studio employee tolerant resolver: OK');
