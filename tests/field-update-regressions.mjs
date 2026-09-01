import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.example.test' };
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source.replace('  bootstrap();', '  window.__fieldTestUi = { APP, resetFilePreview, renderPlanConsumedNotice }; bootstrap();'));
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;
const failures = [];
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
}

await check('compact numeric ranges retain both endpoints', () => {
  for (const input of ['4-15', '4 – 15', '4..15', '4 до 15']) {
    assert.deepEqual(E.parseRange(input, 'Int'), { kind: 'Int', value: 4, to: 15 });
  }
  assert.deepEqual(E.parseRange('-15--4', 'Int'), { kind: 'Int', value: -15, to: -4 });
  assert.deepEqual(E.parseRange('-4', 'Int'), { kind: 'Int', value: -4, to: null });
  assert.deepEqual(E.parseRange('1,5-4,25', 'Decimal'), { kind: 'Decimal', value: 1.5, to: 4.25 });
  assert.equal(E.parseRange('2026-09-01', 'Date').to, null);
});
await check('range parser rejects truncation, overflow and reversed bounds', () => {
  for (const input of ['4oops', '4.5', '4-15oops', '15-4', '2147483648', '9999999999999999999999']) {
    assert.throws(() => E.parseRange(input, 'Int'), undefined, input);
  }
});

const structure = {
  templateId: 'template',
  conditions: [
    { criterionRowId: 'kind', criterionName: 'Вид', operandTypeId: O.ReferenceGuid, autocompleteViewName: 'Kinds' },
    { criterionRowId: 'pages', criterionName: 'Количество листов (между)', operandTypeId: O.Int },
    { criterionRowId: 'appendix', criterionName: 'Приложения (между)', operandTypeId: O.Int },
    { criterionRowId: 'flag', criterionName: 'Признак', operandTypeId: O.Boolean },
  ],
  functions: [{ id: 'sign', name: 'Подписание' }],
};
const snapshot = { matrixId: 'matrix', templateId: 'template', rows: [1, 2].map(i => {
  const flat = { 'criterion:kind': ['ОРД'], 'criterion:pages': ['1 - 3'], 'criterion:appendix': ['2 - 4'], 'criterion:flag': ['Нет'], 'function:sign': ['Подписант'] };
  return { index: i-1, rowCardId: `card-${i}`, versionId: `version-${i}`, flat, fingerprint: E.fingerprintFlat(flat),
    values: { kind: [{ id: `kind-${i}`, display: 'ОРД' }], pages: [{ kind: 'Int', value: 1, to: 3, display: '1 - 3' }], appendix: [{ kind: 'Int', value: 2, to: 4, display: '2 - 4' }], flag: [{ kind: 'Boolean', value: false, display: 'Нет' }] },
    roles: { sign: [{ id: 'person', display: 'Подписант', roleTypeId: '1' }] } };
}) };
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
catalog.catalogs.kinds = { id: 'kinds', label: 'Вид', sourceView: 'Kinds', entries: [
  { id: 'kind-1', display: 'ОРД', selector: 'ОРД — Приказ' },
  { id: 'kind-2', display: 'ОРД', selector: 'ОРД — Регламент' },
] };
catalog.columnCatalogIds['criterion:kind'] = 'kinds';
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, { matrixId: 'matrix', TemplateID: 'template' }, catalog);
const baseline = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const edit = () => ({ ...baseline, rows: baseline.rows.map(r => ({ ...r, values: [...r.values], cellMeta: r.cellMeta.map(m => m && { ...m }) })) });
const ix = name => baseline.headers.indexOf(name);

await check('distinct reference IDs with the same display are not duplicates', () => {
  const book = edit();
  for (const r of book.rows) r.values[ix('Признак')] = 'Да';
  const plan = E.buildPlan(book, structure, snapshot);
  assert.equal(plan.counts.update, 2);
  assert.equal(plan.counts.skip, 0);
});

await check('invalid cell preserves its value while valid edits remain writable', () => {
  const book = edit();
  const row = book.rows[0];
  row.values[ix('Количество листов (между)')] = '4-15';
  row.values[ix('Приложения (между)')] = '42095';
  row.cellMeta[ix('Приложения (между)')] = { rawType: 'n', numberFormatKind: 'date' };
  row.values[ix('Признак')] = 'Да';
  const plan = E.buildPlan(book, structure, snapshot);
  assert.equal(plan.counts.update, 1);
  assert.equal(plan.counts.skip, 0);
  assert.equal(plan.skippedFields.length, 1);
  const action = plan.actions.find(a => a.type === 'update');
  assert.deepEqual(action.changes.map(c => c.key).sort(), ['criterion:flag', 'criterion:pages']);
  assert.deepEqual(action.excelRow.flat['criterion:appendix'], ['2 - 4']);
  assert.equal(action.excelRow.columns.has('appendix'), false, 'rebuild must not touch rejected field');
  assert.equal(book.rows[0].values[ix('Приложения (между)')], '42095', 'source evidence is retained');
  const reviewed = E.buildReviewedPlan(plan);
  assert.equal(reviewed.safety.blocked, false);
  assert.equal(reviewed.skippedFields.length, 1);
});

await check('new row with invalid cell remains atomic', () => {
  const book = edit();
  const row = { ...book.rows[0], excelRow: 100, values: [...book.rows[0].values], cellMeta: [...book.rows[0].cellMeta] };
  row.values[ix('Количество листов (между)')] = 'invalid';
  row.values[ix('__TESSA_ROW_CARD_ID')] = '';
  row.values[ix('__TESSA_VERSION_ID')] = '';
  row.values[ix('__TESSA_BASE_FINGERPRINT')] = '';
  book.rows.push(row);
  const plan = E.buildPlan(book, structure, snapshot);
  assert.equal(plan.counts.add, 0);
  assert.equal(plan.counts.skip, 1);
});

await check('Boolean ranges are rejected per field', () => {
  const book = edit();
  book.dictionaryCatalog = null;
  book.rows[0].values[ix('Признак')] = 'Да - Нет';
  book.rows[0].values[ix('Количество листов (между)')] = '4-15';
  const plan = E.buildPlan(book, structure, snapshot);
  assert.equal(plan.counts.update, 1);
  assert.deepEqual(plan.skippedFields.map(f => f.key), ['criterion:flag']);
  assert.equal(plan.actions[0].excelRow.columns.has('flag'), false);
});

await check('a whole multivalue cell is preserved when one reference is unknown', () => {
  const book = edit();
  book.rows[0].values[ix('Вид')] += '\nMissing reference';
  book.rows[0].values[ix('Количество листов (между)')] = '4-15';
  const plan = E.buildPlan(book, structure, snapshot);
  assert.equal(plan.counts.update, 1);
  assert.equal(plan.skippedFields.length, 1);
  assert.deepEqual(plan.actions[0].excelRow.ids['criterion:kind'], ['kind-1']);
  assert.equal(plan.actions[0].excelRow.columns.has('kind'), false);
});

await check('a rejected role formula does not discard valid criteria edits', () => {
  const book = edit();
  book.rows[0].cellMeta[ix('Подписание')].hasFormula = true;
  book.rows[0].values[ix('Количество листов (между)')] = '4-15';
  const plan = E.buildPlan(book, structure, snapshot);
  assert.equal(plan.counts.update, 1);
  assert.equal(plan.actions[0].excelRow.columns.has('sign'), false);
  assert.deepEqual(plan.actions[0].excelRow.ids['function:sign'], ['person|1']);
});

await check('field recovery never bypasses damaged baseline or stale snapshot', () => {
  for (const stale of [false, true]) {
    const book = edit();
    book.rows[0].values[ix('Приложения (между)')] = 'invalid';
    book.rows[0].values[ix('Количество листов (между)')] = '4-15';
    const fresh = structuredClone(snapshot);
    if (stale) {
      fresh.rows[0].flat['criterion:pages'] = ['100 - 200'];
      fresh.rows[0].values.pages = [{ kind: 'Int', value: 100, to: 200, display: '100 - 200' }];
      fresh.rows[0].fingerprint = E.fingerprintFlat(fresh.rows[0].flat);
    } else book.rows[0].values[ix('__TESSA_BASE_FINGERPRINT')] = 'tampered';
    const plan = E.buildPlan(book, structure, fresh);
    assert.equal(plan.counts.update, 0);
    assert.equal(plan.counts.skip, 1);
    assert.equal(plan.skippedFields.length, 0);
  }
});

await check('missing Excel columns retain their contribution to duplicate detection', () => {
  const book = edit();
  const columns = [ix('Вид'), ix('Вид__ID')].sort((a,b)=>b-a);
  for (const r of book.rows) r.values[ix('Признак')] = 'Да';
  book.headers = [...book.headers]; book.schemaTokens = [...book.schemaTokens];
  for (const index of columns) {
    book.headers.splice(index, 1); book.schemaTokens.splice(index, 1);
    for (const r of book.rows) { r.values.splice(index, 1); r.cellMeta.splice(index, 1); }
  }
  const plan = E.buildPlan(book, structure, snapshot);
  assert.equal(plan.counts.update, 2);
  assert.equal(plan.counts.skip, 0);
});

await check('blank editable cells have a text number format', async () => {
  const empty = structuredClone(snapshot);
  empty.rows[0].values.pages = [];
  empty.rows[0].flat['criterion:pages'] = [];
  const output = await E.createRoundtripXlsxBytes(structure, empty, { matrixId: 'matrix', TemplateID: 'template' }, catalog);
  const book = await E.readXlsxArrayBuffer(output.buffer.slice(output.byteOffset, output.byteOffset+output.byteLength));
  assert.equal(book.rows[0].cellMeta[ix('Количество листов (между)')].numberFormatKind, 'text');
});

await check('native rebuild preserves rejected field and writes both numeric bounds', () => {
  const book = edit();
  book.rows[0].values[ix('Приложения (между)')] = 'invalid';
  book.rows[0].values[ix('Количество листов (между)')] = '4-15';
  book.rows[0].values[ix('Признак')] = 'Да';
  const action = E.buildPlan(book, structure, snapshot).actions.find(a=>a.type==='update');
  const { S, F } = E.constants;
  const bridge = Object.create(E.TessaBridge.prototype);
  let serial = 0;
  const row = data => ({ data, state: 0, set(key, value) { this.data[key]=value; } });
  Object.defineProperties(bridge, {
    FieldType: { value: { Guid: 'guid', Int: 'int', String: 'string', Boolean: 'bool' } },
    CardRowState: { value: { Inserted: 1 } },
    Guid: { value: { newGuid: () => `new-${++serial}` } },
  });
  bridge.section = (card, name) => card.sections[name];
  bridge.rowValue = (r, key) => r.data[key];
  bridge.isDeleted = r => r.deleted;
  bridge.removeOrDelete = (section, r) => { r.deleted = true; };
  bridge.addRow = section => { const r = row({}); section.rows.push(r); return r; };
  const original = row({ [F.OwnerRowID]: 'version-1', [F.CriterionRowID]: 'appendix', [F.IntValue]: 2, [F.IntToValue]: 4 });
  const otherVersion = row({ [F.OwnerRowID]: 'version-other', [F.CriterionRowID]: 'pages', [F.IntValue]: 77 });
  const card = { sections: { [S.Values]: { rows: [original, otherVersion] }, [S.Roles]: { rows: [] } } };
  const fresh = { ...snapshot, criterionIdCache: new Map(), roleIdCache: new Map(), roleIdByFunctionCache: new Map() };
  bridge.rebuildRowCard(card, 'version-1', action.excelRow, structure, fresh);
  assert.equal(original.deleted, undefined);
  assert.equal(otherVersion.deleted, undefined);
  assert.equal(card.sections[S.Values].rows.filter(r=>r.data[F.CriterionRowID]==='appendix').length, 1);
  const range = card.sections[S.Values].rows.find(r=>r.data[F.CriterionRowID]==='pages' && r.data[F.OwnerRowID]==='version-1');
  assert.equal(range.data[F.IntValue], 4);
  assert.equal(range.data[F.IntToValue], 15);
  assert.equal(card.sections[S.Values].rows.find(r=>r.data[F.CriterionRowID]==='flag').data[F.BoolValue], true);
  assert.equal(card.sections[S.Roles].rows[0].data[F.RoleID], 'person');
});

await check('invalid-only rows and replacements are never partially applied', () => {
  const book = edit();
  book.rows[0].values[ix('Количество листов (между)')] = 'invalid';
  let plan = E.buildPlan(book, structure, snapshot);
  assert.equal(plan.counts.update, 0);
  assert.equal(plan.counts.skip, 1);
  const replace = edit();
  replace.rows[1].values = [...replace.rows[0].values];
  replace.rows[1].values[ix('Количество листов (между)')] = '4-15';
  replace.rows[1].values[ix('Приложения (между)')] = 'invalid';
  plan = E.buildPlan(replace, structure, snapshot);
  assert.equal(plan.counts.update, 0);
  assert.equal(plan.counts.add, 0);
  assert.equal(plan.counts.delete, 0);
  assert.equal(plan.skippedFields.length, 0);
  assert.equal(plan.counts.skip, 1);
});

await check('true duplicates remain blocked even when current display differs', () => {
  const book = edit();
  book.rows[1].values[ix('Вид')] = book.rows[0].values[ix('Вид')];
  book.rows[1].values[ix('Вид__ID')] = book.rows[0].values[ix('Вид__ID')];
  const renamed = structuredClone(snapshot);
  renamed.rows[0].values.kind[0].display = 'Другая подпись того же ID';
  renamed.rows[0].flat['criterion:kind'] = ['Другая подпись того же ID'];
  const plan = E.buildPlan(book, structure, renamed);
  assert.equal(plan.counts.update, 0);
  assert.equal(plan.counts.skip, 1);
});

await check('new file clears old Apply; skipped fields stay visible after Apply', () => {
  const elements = new Map(['#tms-summary', '#tms-plan', '#tms-apply'].map(id=>[id,{innerHTML:'old',disabled:false}]));
  const query = document.querySelector;
  document.querySelector = selector=>elements.get(selector)||null;
  try {
    const Q = window.__fieldTestUi;
    Q.APP.plan = { id:'old-plan' }; Q.APP.workbook = { fileName:'old.xlsx' };
    Q.resetFilePreview();
    assert.equal(Q.APP.plan, null); assert.equal(Q.APP.workbook, null);
    assert.equal(elements.get('#tms-apply').disabled, true);
    assert.equal(elements.get('#tms-plan').innerHTML, '');
    const result = {status:'completed',success:true,appliedCount:1,requestedCount:1,skippedFields:[{excelRow:19,label:'Приложения',reason:'<img src=x onerror=bad>'}],viewRefresh:{ok:true}};
    Q.renderPlanConsumedNotice(result);
    assert.match(elements.get('#tms-summary').innerHTML,/Не применено отдельных полей: 1/);
    assert.match(elements.get('#tms-summary').innerHTML,/&lt;img/);
    assert.doesNotMatch(elements.get('#tms-summary').innerHTML,/<img/);
    assert.match(E.applyResultMessage(result),/Не применено отдельных полей: 1/);
  } finally { document.querySelector = query; }
});

if (failures.length) throw new Error(`${failures.length} regressions: ${failures.join('; ')}`);
