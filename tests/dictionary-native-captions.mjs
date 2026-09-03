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
  templateId: 'template',
  conditions: ['org', 'segment', 'doc', 'executor'].map(id => ({ criterionRowId: id, criterionName: id, operandTypeId: E.constants.OPERAND.ReferenceGuid, refSection: id })),
  functions: [{ id: 'sign', name: 'Подписание' }],
};
const fixture = () => {
  const values = {
    org: [{ id: 'org-1', display: 'ООО «Пример»' }],
    segment: [{ id: 'segment-1', display: 'Производство' }],
    doc: [{ id: 'doc-1', display: 'Акт' }, { id: 'doc-2', display: 'Акт' }],
    executor: [{ id: 'person', display: 'Иванов Иван Иванович' }],
  };
  const roles = { sign: [{ id: 'person', roleTypeId: 1, display: 'Иванов Иван Иванович' }, { id: 'person', roleTypeId: 2, display: 'Иванов Иван Иванович' }] };
  const flat = Object.fromEntries([...Object.entries(values).map(([id, items]) => [`criterion:${id}`, items.map(v => v.display)]), ['function:sign', roles.sign.map(v => v.display)]]);
  const snapshot = { matrixId: 'matrix', rows: [{ rowCardId: 'row', versionId: 'version', values, roles, flat, fingerprint: E.fingerprintFlat(flat) }] };
  const catalogs = {
    org: { entries: [{ id: 'org-1', display: 'ООО «Пример»', qualifier: 'Общество с ограниченной ответственностью «Пример»', selector: 'ООО «Пример» — Общество с ограниченной ответственностью «Пример»' }] },
    segment: { entries: [{ id: 'segment-1', display: 'Производство', details: 'SegmentCode: 007', selector: 'Производство — 007' }] },
    doc: { entries: [{ id: 'doc-1', display: 'Акт общий' }, { id: 'doc-2', display: 'Акт передачи' }] },
    executor: { entries: [{ id: 'person', display: 'Иванов И.И.' }] },
    sign: { entries: [{ id: 'person', roleTypeId: 1, display: 'Иванов И.И.' }, { id: 'person', roleTypeId: 2, display: 'Иванов И.И.' }] },
  };
  for (const [id, cat] of Object.entries(catalogs)) Object.assign(cat, { id, sourceView: id });
  const catalog = { catalogs, columnCatalogIds: Object.fromEntries([...structure.conditions.map(c => [`criterion:${c.criterionRowId}`, c.criterionRowId]), ['function:sign', 'sign']]) };
  return { snapshot, catalog };
};
const buffer = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const read = b => E.readXlsxArrayBuffer(buffer(b));
const column = id => ({ kind: id === 'sign' ? 'function' : 'criterion', key: `${id === 'sign' ? 'function' : 'criterion'}:${id}`, excelHeader: id });
const resolve = (catalog, id, text, explicit = '') => E.resolveEmbeddedDictionaryValue({ dictionaryCatalog: catalog }, column(id), text, explicit);

test('export matches native captions and keeps every ID, including identical captions', async () => {
  const { snapshot, catalog } = fixture();
  const grid = E.buildRoundtripGrid(structure, snapshot, {}, catalog);
  for (const col of grid.columns.filter(c => ['criterion', 'function'].includes(c.kind))) {
    assert.equal(grid.rows[0][grid.columns.indexOf(col)], snapshot.rows[0].flat[col.key].join('\n'));
  }
  const book = await read(await E.createRoundtripXlsxBytes(structure, snapshot, { TemplateID: 'template' }, catalog));
  const desired = E.workbookRowsToDesired(book, E.buildColumnMap(book, structure));
  assert.deepEqual(desired[0].issues, []);
  assert.deepEqual(desired[0].ids['criterion:doc'], ['doc-1', 'doc-2']);
  assert.deepEqual(desired[0].ids['function:sign'], ['person|1', 'person|2']);
  assert.deepEqual(E.buildPlan(book, structure, snapshot).counts, { noop: 1, update: 0, add: 0, delete: 0, skip: 0 });
});

test('ordinary picker captions have no suffix; namesakes remain selectable by exact identity', () => {
  const { snapshot, catalog } = fixture();
  const merged = E.mergeSnapshotIntoDictionaryCatalog(catalog, structure, snapshot);
  for (const id of ['org', 'segment', 'executor']) {
    const entry = merged.catalogs[id].entries[0];
    assert.equal(entry.selector, entry.display);
    assert.equal(entry.display, snapshot.rows[0].values[id][0].display);
    assert.equal(E.pickerSelectionText([entry]), entry.display);
  }
  for (const id of ['doc', 'sign']) {
    const entries = merged.catalogs[id].entries;
    assert.equal(new Set(entries.map(e => e.selector)).size, 2);
    assert.match(resolve(merged, id, entries[0].display).issue, /неоднозначно/);
    for (const e of entries) {
      const identity = id === 'sign' ? `${e.id}|${e.roleTypeId}` : e.id;
      assert.equal(resolve(merged, id, e.selector).explicit, identity);
      assert.equal(resolve(merged, id, e.display, identity).explicit, identity);
    }
  }
});

test('snapshot overlays are immutable, idempotent and retain row-specific native aliases', () => {
  const { snapshot, catalog } = fixture();
  const base = E.normalizeDictionaryCatalog(catalog), before = JSON.stringify(base);
  const other = structuredClone(snapshot.rows[0]);
  other.values.executor[0].display = 'И. И. Иванов';
  snapshot.rows.push(other);
  const merged = E.mergeSnapshotIntoDictionaryCatalog(base, structure, snapshot);
  assert.equal(JSON.stringify(base), before);
  assert.equal(merged.catalogs.executor.entries[0].display, 'Иванов Иван Иванович');
  assert.equal(resolve(merged, 'executor', 'И. И. Иванов', 'person').explicit, 'person');
  assert.equal(E.mergeSnapshotIntoDictionaryCatalog(merged, structure, snapshot), merged);
  const renamed = structuredClone(snapshot);
  renamed.rows.forEach(r => { r.values.executor[0].display = 'Петров Пётр Петрович'; });
  const updated = E.mergeSnapshotIntoDictionaryCatalog(merged, structure, renamed);
  assert.equal(updated.catalogs.executor.entries[0].display, 'Петров Пётр Петрович');
});

test('legacy qualified values survive dictionary refresh without rewriting edited cells', async () => {
  const { snapshot, catalog } = fixture();
  const legacy = structuredClone(snapshot);
  legacy.rows[0].values.org[0].display = catalog.catalogs.org.entries[0].selector;
  const book = await read(await E.createRoundtripXlsxBytes(structure, legacy, { TemplateID: 'template' }, catalog));
  const fresh = E.mergeSnapshotIntoDictionaryCatalog(fixture().catalog, structure, snapshot);
  const refreshed = await read(await E.refreshWorkbookDictionaries(book, structure, fresh));
  assert.deepEqual(refreshed.rows, book.rows);
  assert.deepEqual(refreshed.roundtrip.baselineRows, book.roundtrip.baselineRows);
  const parsed = E.workbookRowsToDesired(refreshed, E.buildColumnMap(refreshed, structure));
  assert.deepEqual(parsed[0].issues, []);
  assert.equal(parsed[0].ids['criterion:org'][0], 'org-1');
  assert.equal(refreshed.dictionaryCatalog.catalogs.org.entries[0].selector, 'ООО «Пример»');
});

test('all native row captions survive serialization and refresh when one ID has many aliases', async () => {
  const { snapshot, catalog } = fixture();
  const template = snapshot.rows[0];
  snapshot.rows = Array.from({ length: 25 }, (_, index) => {
    const row = structuredClone(template), display = `Имя исполнителя ${index + 1}`;
    row.rowCardId = `row-${index}`;
    row.versionId = `version-${index}`;
    row.values.executor[0].display = display;
    row.flat['criterion:executor'] = [display];
    row.fingerprint = E.fingerprintFlat(row.flat);
    return row;
  });
  const book = await read(await E.createRoundtripXlsxBytes(structure, snapshot, { TemplateID: 'template' }, catalog));
  const fresh = E.mergeSnapshotIntoDictionaryCatalog(fixture().catalog, structure, snapshot);
  const refreshed = await read(await E.refreshWorkbookDictionaries(book, structure, fresh));
  for (const workbook of [book, refreshed]) {
    const desired = E.workbookRowsToDesired(workbook, E.buildColumnMap(workbook, structure));
    assert.deepEqual(desired.flatMap(row => row.issues), []);
    assert.ok(desired.every(row => row.ids['criterion:executor'][0] === 'person'));
    assert.equal(E.buildPlan(workbook, structure, snapshot).counts.noop, 25);
  }
});

test('a newly added namesake cannot turn a bare caption into an unambiguous selector', () => {
  const old = E.finalizeDictionaryEntries([{ id: 'old', display: 'Одинаково' }]);
  const catalog = { catalogs: { org: { entries: E.finalizeDictionaryEntries([...old, { id: 'new', display: 'Одинаково' }]) } }, columnCatalogIds: { 'criterion:org': 'org' } };
  assert.match(resolve(catalog, 'org', 'Одинаково').issue, /неоднозначно/);
  assert.equal(resolve(catalog, 'org', 'Одинаково', 'old').explicit, 'old');
});

test('fresh view load uses matrix captions without changing metadata identity projection', async () => {
  const { snapshot } = fixture();
  const bridge = Object.create(E.TessaBridge.prototype);
  bridge.findCompatibleViewAlias = c => c.refSection;
  bridge.localizeValue = value => value == null ? '' : String(value);
  bridge.queryViewSample = async alias => ({ alias, columns: ['EntryID', 'EntryName', 'RoleTypeID'], references: [{ refSection: [alias], colPrefix: 'Entry', displayValueColumn: 'EntryName' }], rows: alias === 'org' ? [['org-1', 'Полное имя из представления', null]] : [] });
  const loaded = await bridge.loadDictionaryCatalog(structure, snapshot, { forceRefresh: true, transient: true });
  const org = loaded.catalogs[loaded.columnCatalogIds['criterion:org']];
  assert.equal(org.projection.idColumn, 'EntryID');
  assert.equal(org.entries[0].display, 'ООО «Пример»');
  assert.equal(org.entries[0].id, 'org-1');
  assert.equal(org.entries[0].selector, 'ООО «Пример»');
});
