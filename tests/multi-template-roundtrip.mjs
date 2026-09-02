import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.document = { body: { innerText: 'Завершить редактирование и разблокировать' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__, O = E.constants.OPERAND;

// These schemas intentionally share captions but not IDs. A name or a column
// position must never bind a field from one template to a different template.
const cases = [
  [['Int', '1 - 3', '4-15'], ['Boolean', 'Нет', 'Да'], ['ReferenceGuid', 'Север', 'Юг']],
  [['Decimal', '1.5', '2,75'], ['String', 'Проект договора', 'Проверенный договор'], ['ReferenceInt', 'Север', 'Юг']],
  [['Date', '01.09.2026', '02.09.2026'], ['DateTime', '01.09.2026 10:00:00', '02.09.2026 12:30:00']],
];
for (const [i, fields] of cases.entries()) {
  const conditions = fields.map(([kind], n) => ({ criterionRowId: `t${i}-c${n}`, criterionName: `Поле ${n}`, operandTypeId: O[kind], ...(kind.startsWith('Reference') ? { autocompleteViewName: `Catalog${i}` } : {}) }));
  const functions = [{ id: `t${i}-f`, name: 'Подписание' }];
  const structure = { templateId: `template-${i}`, conditions, functions };
  const values = {}, flat = {}, roles = { [functions[0].id]: [{ id: `person-${i}`, display: 'Подписант', roleTypeId: '1' }] };
  fields.forEach(([kind, display], n) => {
    const id = conditions[n].criterionRowId;
    values[id] = [{ kind, display, ...(kind.startsWith('Reference') ? { id: kind === 'ReferenceInt' ? 1 : `ref-${i}-1` } : {}) }];
    flat[`criterion:${id}`] = [display];
  });
  flat[`function:${functions[0].id}`] = ['Подписант'];
  const snapshot = { matrixId: `matrix-${i}`, templateId: structure.templateId, rows: [{ index: 0, rowCardId: `card-${i}`, versionId: `version-${i}`, fingerprint: E.fingerprintFlat(flat), values, roles, flat }] };
  const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
  fields.forEach(([kind], n) => {
    if (!kind.startsWith('Reference')) return;
    const key = `criterion:${conditions[n].criterionRowId}`, catalogId = catalog.columnCatalogIds[key];
    const oldId = kind === 'ReferenceInt' ? 1 : `ref-${i}-1`;
    catalog.columnCatalogIds[key] = `catalog-${i}`;
    catalog.catalogs[`catalog-${i}`] = {id:`catalog-${i}`,label:'Регионы',sourceView:`Catalog${i}`,entries:[{id:oldId,display:'Север',selector:'Север'}]};
    catalog.catalogs[`catalog-${i}`].entries.push({ id: kind === 'ReferenceInt' ? 2 : `ref-${i}-2`, display: 'Юг', selector: 'Юг' });
  });
  const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, { matrixId: snapshot.matrixId, TemplateID: structure.templateId }, catalog);
  const book = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.equal(E.buildPlan(book, structure, snapshot).counts.noop, 1, `template ${i}: clean roundtrip`);
  const renamed = { ...structure, conditions: [...conditions].reverse().map(c => ({ ...c, criterionName: 'Новое название' })) };
  assert.equal(E.buildPlan(book, renamed, snapshot).counts.noop, 1, 'mapping must use schema IDs across order/name changes');
  fields.forEach(([, , next], n) => { book.rows[0].values[book.schemaTokens.indexOf(`criterion:${conditions[n].criterionRowId}`)] = next; });
  const plan = E.buildPlan(book, structure, snapshot);
  assert.equal(plan.counts.update, 1, `template ${i}: typed edits`);
  assert.equal(plan.counts.skip, 0, JSON.stringify(plan.skippedRows));
  assert.equal(plan.skippedFields.length, 0, JSON.stringify(plan.skippedFields));
  assert.equal(plan.actions[0].changes.length, fields.length);
  const foreign = E.evaluatePlanSafety(plan, { matrixInfo: () => ({ matrixId: 'different-matrix', TemplateID: 'different-template', StateName: 'Черновик' }) });
  assert.equal(foreign.blocked, true, 'a workbook cannot be applied to a foreign matrix/template');
}

// Fresh preflight catches a template change even when the same card remains open.
const plan = { matrixId: 'same-card', templateId: 'old-template', actions: [], safety: { blocked: false } };
const fresh = { matrixId: 'same-card', templateId: 'new-template', rows: [] };
const bridge = { matrixInfo: () => ({ StateName: 'Черновик' }) };
await assert.rejects(E.preflightPlan(plan, { previewOnly: true, bridge, structure: { templateId: 'new-template', conditions: [], functions: [] }, fresh }), /Шаблон матрицы изменился/);
console.log('TESSA multi-template roundtrip: 3 schemas, all 8 operand types, template preflight guard OK');
