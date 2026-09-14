import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source, { filename: 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;
const buf = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

const structure = {
  templateId: 'task6-template',
  conditions: [
    { criterionRowId: 'a', criterionName: 'Первое', operandTypeId: O.String },
    { criterionRowId: 'b', criterionName: 'Второе', operandTypeId: O.String },
  ],
  functions: [],
};
function row(id, a, b, versionId = `v-${id}`) {
  const flat = { 'criterion:a': [a], 'criterion:b': [b] };
  return {
    index: 0,
    rowCardId: id,
    versionId,
    flat,
    fingerprint: E.fingerprintFlat(flat),
    values: { a: [{ kind: 'String', display: a }], b: [{ kind: 'String', display: b }] },
    roles: {},
  };
}
const baseRow = row('r', 'А', 'Б');
const baseSnapshot = { matrixId: 'task6-matrix', rows: [baseRow] };
const baseBook = await E.readXlsxArrayBuffer(buf(await E.createRoundtripXlsxBytes(structure, baseSnapshot, { TemplateID: structure.templateId })));
const col = key => baseBook.schemaTokens.indexOf(key);
function cloneBook() {
  return {
    ...baseBook,
    rows: baseBook.rows.map(r => ({ ...r, values: [...r.values] })),
    roundtrip: {
      ...baseBook.roundtrip,
      baselineRows: baseBook.roundtrip.baselineRows.map(r => ({ ...r, base: r.base ? structuredClone(r.base) : r.base })),
    },
  };
}

// BASE / MINE / TESSA matrix semantics.
{
  const mine = cloneBook();
  mine.rows[0].values[col('criterion:a')] = 'Моё';
  const result = E.prepareThreeWayMerge(mine, structure, baseSnapshot);
  assert.equal(result.unresolved.length, 0, 'mine-only edit must not conflict');
  assert.equal(E.mergeWorkbookIntoCurrentSnapshot(result.workbook, structure, baseSnapshot).snapshot.rows[0].flat['criterion:a'][0], 'Моё');
}
{
  const fresh = { ...baseSnapshot, rows: [row('r', 'А', 'TESSA', 'v2-r')] };
  const result = E.prepareThreeWayMerge(cloneBook(), structure, fresh);
  assert.equal(result.unresolved.length, 0, 'server-only edit must not conflict');
  assert.equal(E.mergeWorkbookIntoCurrentSnapshot(result.workbook, structure, fresh).snapshot.rows[0].flat['criterion:b'][0], 'TESSA');
}
{
  const mine = cloneBook();
  mine.rows[0].values[col('criterion:a')] = 'Одинаково';
  const fresh = { ...baseSnapshot, rows: [row('r', 'Одинаково', 'Б', 'v2-r')] };
  const result = E.prepareThreeWayMerge(mine, structure, fresh);
  assert.equal(result.unresolved.length, 0, 'same edit on both sides must collapse without a conflict');
  assert.equal(E.mergeWorkbookIntoCurrentSnapshot(result.workbook, structure, fresh).snapshot.rows[0].flat['criterion:a'][0], 'Одинаково');
}
{
  const mine = cloneBook();
  mine.rows[0].values[col('criterion:a')] = 'Моё';
  const fresh = { ...baseSnapshot, rows: [row('r', 'Их', 'Б', 'v2-r')] };
  const originalBase = structuredClone(mine.roundtrip.baselineRows);
  const originalVersionCell = mine.rows[0].values[col('system:versionId')];
  const originalFingerprintCell = mine.rows[0].values[col('system:baseFingerprint')];
  const pending = E.prepareThreeWayMerge(mine, structure, fresh);
  assert.equal(pending.unresolved.length, 1, 'divergent edit must require a choice');
  assert.deepEqual(pending.workbook.roundtrip.baselineRows, originalBase, 'unresolved merge must not rebuild BASE metadata');
  assert.equal(pending.workbook.rows[0].values[col('system:versionId')], originalVersionCell, 'unresolved merge must not advance baseline VersionID');
  assert.equal(pending.workbook.rows[0].values[col('system:baseFingerprint')], originalFingerprintCell, 'unresolved merge must not advance baseline fingerprint');
  const resolved = E.prepareThreeWayMerge(mine, structure, fresh, { [pending.unresolved[0].id]: 'server' });
  assert.equal(resolved.unresolved.length, 0);
  assert.equal(resolved.workbook.roundtrip.baselineRows[0].versionId, 'v2-r', 'BASE advances only after all choices are resolved');
  assert.equal(resolved.workbook.rows[0].values[col('system:versionId')], 'v2-r');
}
{
  const deleted = cloneBook();
  deleted.rows = [];
  const fresh = { ...baseSnapshot, rows: [row('r', 'Изменено в TESSA', 'Б', 'v2-r')] };
  const result = E.prepareThreeWayMerge(deleted, structure, fresh);
  assert.equal(result.unresolved.length, 1, 'delete/update conflict must require a row-level choice');
  assert.equal(result.unresolved[0].kind, 'local-delete');
}

// Dictionary refresh after export: add, remove and rename, while the actual workbook
// carrying the user's local matrix value remains byte-preserved outside reference sheets.
{
  const refStructure = {
    templateId: 'dict-template',
    conditions: [
      { criterionRowId: 'ref', criterionName: 'Справочник', refSection: 'Refs', operandTypeId: O.ReferenceGuid },
      { criterionRowId: 'note', criterionName: 'Комментарий', operandTypeId: O.String },
    ],
    functions: [],
  };
  const localFlat = { 'criterion:ref': ['Прежнее'], 'criterion:note': ['Моя локальная правка'] };
  const localSnapshot = { matrixId: 'dict-matrix', rows: [{
    index: 0, rowCardId: 'dict-row', versionId: 'dict-v1', flat: localFlat, fingerprint: E.fingerprintFlat(localFlat),
    values: { ref: [{ id: 'one', display: 'Прежнее', kind: 'ReferenceGuid' }], note: [{ kind: 'String', display: 'Моя локальная правка' }] }, roles: {},
  }] };
  const oldCatalog = { catalogs: { old: { id: 'old', entries: [
    { id: 'one', display: 'Прежнее', selector: 'Прежнее' },
    { id: 'gone', display: 'Удаляемое', selector: 'Удаляемое' },
  ] } }, columnCatalogIds: { 'criterion:ref': 'old' } };
  const book = await E.readXlsxArrayBuffer(buf(await E.createRoundtripXlsxBytes(refStructure, localSnapshot, { TemplateID: refStructure.templateId }, oldCatalog)));
  const beforeRows = structuredClone(book.rows);
  const beforeBase = structuredClone(book.roundtrip.baselineRows);
  assert.equal(book.rows[0].values[book.schemaTokens.indexOf('criterion:note')], 'Моя локальная правка');
  const freshCatalog = { catalogs: { fresh: { id: 'fresh', entries: [
    { id: 'one', display: 'Переименованное' },
    { id: 'new', display: 'Добавленное' },
  ] } }, columnCatalogIds: { 'criterion:ref': 'fresh' } };
  const refreshed = await E.readXlsxArrayBuffer(buf(await E.refreshWorkbookDictionaries(book, refStructure, freshCatalog)));
  assert.deepEqual(refreshed.rows, beforeRows, 'dictionary refresh must preserve every local matrix cell');
  assert.deepEqual(refreshed.roundtrip.baselineRows, beforeBase, 'dictionary refresh must preserve BASE metadata');
  const catalogId = refreshed.dictionaryCatalog.columnCatalogIds['criterion:ref'];
  const entries = refreshed.dictionaryCatalog.catalogs[catalogId].entries;
  assert.deepEqual(entries.map(x => x.id).sort(), ['new', 'one'], 'removed lookup values must disappear and added values must appear');
  assert.equal(entries.find(x => x.id === 'one').display, 'Переименованное');
  assert.equal(entries.find(x => x.id === 'one').selector, 'Прежнее', 'stable ID rename must preserve the old selector for the existing workbook cell');
  assert.equal(E.resolveEmbeddedDictionaryValue(refreshed, { kind: 'criterion', key: 'criterion:ref', excelHeader: 'Справочник' }, 'Прежнее', 'one').explicit, 'one');
}

// Production merge UX must use the same Resolution Center surface as Preview ambiguity handling.
assert.match(source, /function\s+resolveMergeConflictsInResolutionCenter\s*\(/, 'Task6 requires a shared Resolution Center adapter for three-way merge conflicts');
assert.match(source, /prepared\.unresolved\.length[\s\S]{0,650}resolveMergeConflictsInResolutionCenter\(prepared\.unresolved\)/, 'refreshWorkbookSchema must route divergent BASE/MINE/TESSA conflicts through Resolution Center');

console.log('Recovery Task6 contracts: dictionary add/remove/rename, BASE-MINE-TESSA semantics, deferred baseline and shared Resolution Center OK');
