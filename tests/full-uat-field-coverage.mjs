import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.example.test', href: 'https://tessa.example.test/matrix' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };

const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source, { filename: 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const U = globalThis.__TMS_FULL_UAT_V1__;
assert.ok(U, 'Full UAT runner missing');
assert.equal(typeof U.buildWritableFieldInventory, 'function', 'Task7 inventory helper missing');
assert.equal(typeof U.fieldCandidateValues, 'function', 'Task7 deterministic candidate helper missing');

const O = E.constants.OPERAND;
const structure = {
  conditions: [
    { criterionRowId: 'bool', criterionName: 'Флаг', operandTypeId: O.Boolean },
    { criterionRowId: 'int', criterionName: 'Количество', operandTypeId: O.Int },
    { criterionRowId: 'dec', criterionName: 'Сумма', operandTypeId: O.Decimal },
    { criterionRowId: 'date', criterionName: 'Дата', operandTypeId: O.Date },
    { criterionRowId: 'dt', criterionName: 'Дата-время', operandTypeId: O.DateTime },
    { criterionRowId: 'str', criterionName: 'Комментарий', operandTypeId: O.String },
    { criterionRowId: 'rg', criterionName: 'Организация', operandTypeId: O.ReferenceGuid, refSection: 'Organizations' },
    { criterionRowId: 'ri', criterionName: 'Тип', operandTypeId: O.ReferenceInt, refSection: 'Types' },
  ],
  functions: [{ id: 'sign', name: 'Подписание', typeName: 'Подписание' }],
};
const schemaTokens = [
  'criterion:bool', 'criterion:int', 'criterion:dec', 'criterion:date', 'criterion:dt', 'criterion:str',
  'criterion:rg', 'companion:criterion:rg', 'criterion:ri', 'companion:criterion:ri',
  'function:sign', 'companion:function:sign', 'system:rowCardId',
];
const book = { schemaTokens };
const catalog = {
  columnCatalogIds: {
    'criterion:rg': 'rg-cat',
    'criterion:ri': 'ri-cat',
    'function:sign': 'fn-cat',
  },
  catalogs: {
    'rg-cat': { entries: [{ id: 'org-a', display: 'Орг А', selector: 'Орг А' }, { id: 'org-b', display: 'Орг Б', selector: 'Орг Б' }] },
    'ri-cat': { entries: [{ id: 1, display: 'Тип 1', selector: 'Тип 1' }, { id: 2, display: 'Тип 2', selector: 'Тип 2' }] },
    'fn-cat': { entries: [
      { id: 'person-a', roleTypeId: 1, display: 'Иванов И.И. — Директор', selector: 'Иванов И.И. — Директор' },
      { id: 'person-b', roleTypeId: 1, display: 'Петров П.П. — Директор', selector: 'Петров П.П. — Директор' },
    ] },
  },
};

const inventory = U.buildWritableFieldInventory(book, structure, catalog);
assert.deepEqual(inventory.map(x => x.token), [
  'criterion:bool', 'criterion:int', 'criterion:dec', 'criterion:date', 'criterion:dt', 'criterion:str',
  'criterion:rg', 'criterion:ri', 'function:sign',
], 'inventory must cover every writable criterion/function and exclude companion/system columns');
assert.deepEqual(inventory.map(x => x.kind), [
  'Boolean', 'Int', 'Decimal', 'Date', 'DateTime', 'String', 'ReferenceGuid', 'ReferenceInt', 'Function',
]);
assert.ok(inventory.every(x => x.label && Number.isInteger(x.index) && x.index >= 0));

const byToken = Object.fromEntries(inventory.map(x => [x.token, x]));
assert.ok(U.fieldCandidateValues(byToken['criterion:bool'], 'Да').includes('Нет'));
assert.ok(U.fieldCandidateValues(byToken['criterion:int'], '10').some(v => String(v) !== '10'));
assert.ok(U.fieldCandidateValues(byToken['criterion:dec'], '10,5').some(v => String(v) !== '10,5'));
assert.ok(U.fieldCandidateValues(byToken['criterion:date'], '14.09.2026').length >= 1);
assert.ok(U.fieldCandidateValues(byToken['criterion:dt'], '14.09.2026 12:00').length >= 1);
assert.ok(U.fieldCandidateValues(byToken['criterion:str'], 'abc').some(v => String(v) !== 'abc'));
assert.deepEqual(U.fieldCandidateValues(byToken['criterion:rg'], 'Орг А').map(x => x.id), ['org-b']);
assert.deepEqual(U.fieldCandidateValues(byToken['criterion:ri'], 'Тип 1').map(x => x.id), [2]);
assert.deepEqual(U.fieldCandidateValues(byToken['function:sign'], 'Иванов И.И. — Директор').map(x => x.id), ['person-b']);

for (const item of inventory) {
  assert.ok(item.token && item.label && item.kind, JSON.stringify(item));
  assert.ok(['dictionary', 'boolean', 'integer', 'decimal', 'date', 'datetime', 'string'].includes(item.strategy), JSON.stringify(item));
}

// The live runner must exercise the inventory one field at a time, prove read-back and
// restoration, and treat any unproven restore as UNSAFE rather than a normal FAIL.
assert.match(source, /write-every-field/, 'Task7 live check id missing');
assert.match(source, /buildWritableFieldInventory\([^)]*currentCatalog[^)]*\)/, 'live UAT must build inventory from the current schema/catalog');
assert.match(source, /fieldMutationAudit/, 'Task7 evidence ledger missing');
for (const token of ['token', 'before', 'candidate', 'observedAfter', 'restoreResult', 'status']) {
  assert.ok(source.includes(token), `Task7 evidence must contain ${token}`);
}
assert.match(source, /restore[\s\S]{0,1200}cleanupUnsafe\s*=\s*true/i, 'unproven field restoration must make Full UAT UNSAFE');
assert.match(source, /PASS[\s\S]{0,1200}NOT_RUN|NOT_RUN[\s\S]{0,1200}PASS/, 'field UAT must record PASS/NOT_RUN evidence explicitly');

console.log('Recovery Task7 contract: every writable field inventory, deterministic candidates, read-back evidence and UNSAFE restore semantics OK');
