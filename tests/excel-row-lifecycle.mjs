import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
vm.runInThisContext(fs.readFileSync(process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;
const structure = { templateId: 't', conditions: [
  { criterionRowId: 'c', criterionName: 'Число', operandTypeId: E.constants.OPERAND.Int },
], functions: [{ id: 'f', name: 'Исполнитель' }] };
const makeRow = n => {
  const flat = { 'criterion:c': [String(n)], 'function:f': ['Тестер'] };
  return { index: n - 1, rowCardId: `r${n}`, versionId: `v${n}`, flat,
    fingerprint: E.fingerprintFlat(flat), values: { c: [{ kind: 'Int', value: n, display: String(n) }] },
    roles: { f: [{ id: 'person', roleTypeId: 1, display: 'Тестер' }] } };
};
const snapshot = { matrixId: 'm', templateId: 't', rows: Array.from({ length: 24 }, (_, i) => makeRow(i + 1)) };
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, { TemplateID: 't' });
const book = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const clone = () => ({ ...book, rows: book.rows.map(r => ({ ...r, values: [...r.values] })) });
const col = token => book.schemaTokens.indexOf(token);
const blank = n => ({ excelRow: n, values: Array(book.headers.length).fill('') });
const deletes = plan => plan.actions.filter(a => a.type === 'delete').map(a => a.currentRow.rowCardId).sort();

// Anonymized reproduction of the submitted workbook: two missing originals,
// three updates, an exact copy, and a changed copy below a gap. Row count is 24.
{
  const w = clone();
  w.rows = w.rows.filter((_, i) => i !== 0 && i !== 3);
  for (const i of [4, 8, 12]) w.rows[i].values[0] = String(100 + i);
  const exact = { excelRow: 38, values: [...book.rows[17].values] };
  const added = { excelRow: 41, values: [...exact.values] };
  added.values[0] = '900';
  w.rows.push(exact, blank(39), blank(40), added);
  const plan = E.buildPlan(w, structure, snapshot);
  assert.deepEqual(plan.counts, { noop: 20, update: 3, add: 1, delete: 2, skip: 0 });
  assert.deepEqual(deletes(plan), ['r1', 'r4']);
  assert.equal(plan.actions.find(a => a.type === 'add').excelRow.excelRow, 41);
  assert.ok(!plan.warnings.some(w => /удаление отключено/.test(w)));
}

// Clearing visible cells keeps companion IDs in Excel. It is a DELETE, and
// fresh data below several blank rows is an ADD without an action marker.
for (const clearHidden of [false, true]) {
  const w = clone();
  const cleared = w.rows[1];
  for (const token of ['criterion:c', 'function:f']) cleared.values[col(token)] = '';
  if (clearHidden) cleared.values.fill('');
  w.rows.splice(3, 1);
  const added = blank(80); added.values[0] = '500'; added.values[2] = 'Тестер'; added.values[3] = 'person|1';
  w.rows.push(blank(78), blank(79), added);
  const plan = E.buildPlan(w, structure, snapshot);
  assert.deepEqual(deletes(plan), ['r2', 'r4']);
  assert.equal(plan.counts.add, 1);
  assert.equal(plan.counts.skip, 0, JSON.stringify(plan.skippedRows));
  const merged = E.mergeWorkbookIntoCurrentSnapshot(w, structure, snapshot);
  const mergedBytes = await E.createRoundtripXlsxBytes(structure, merged.snapshot, { TemplateID: 't' }, null, { baselineRows: snapshot.rows });
  const restored = await E.readXlsxArrayBuffer(mergedBytes.buffer.slice(mergedBytes.byteOffset, mergedBytes.byteOffset + mergedBytes.byteLength));
  const restoredPlan = E.buildPlan(restored, structure, snapshot);
  assert.deepEqual(deletes(restoredPlan), ['r2', 'r4']);
  assert.equal(restoredPlan.counts.add, 1);
}

// A new copied row after the exported area plus a deletion has the same row
// count as the export. It must not be guessed to be a positional replacement.
{
  const w = clone(); w.rows.splice(2, 1);
  const added = { excelRow: 80, values: [...w.rows[0].values] }; added.values[0] = '600'; w.rows.push(added);
  const plan = E.buildPlan(w, structure, snapshot);
  assert.equal(plan.counts.add, 1); assert.equal(plan.counts.update, 0);
  assert.deepEqual(deletes(plan), ['r3']);
}

// Clearing must retain concurrency protection, and must not infer a deletion
// from an incomplete set of columns.
{
  const w = clone(); w.rows[0].values[0] = ''; w.rows[0].values[2] = '';
  const fresh = { ...snapshot, rows: [{ ...makeRow(999), rowCardId: 'r1', versionId: 'v1' }, ...snapshot.rows.slice(1)] };
  assert.equal(E.buildPlan(w, structure, fresh).counts.delete, 0);
  assert.equal(E.prepareThreeWayMerge(w, structure, fresh).unresolved[0].kind, 'local-delete');
  const noFunction = { ...w, schemaTokens: w.schemaTokens.map(t => t === 'function:f' ? '' : t) };
  assert.equal(E.buildPlan(noFunction, structure, snapshot).counts.delete, 0);
}

// The baseline scopes deletions: later additions by another session survive.
{
  const w = clone(); w.rows.shift();
  const fresh = { ...snapshot, rows: [...snapshot.rows, makeRow(1000)] };
  assert.deepEqual(deletes(E.buildPlan(w, structure, fresh)), ['r1']);
  const empty = E.buildPlan({ ...book, rows: [] }, structure, snapshot);
  assert.equal(empty.counts.delete, 24); assert.equal(empty.counts.skip, 0);
}
console.log('Excel row lifecycle: clear, physical delete, mixed ADD, gaps, copy, schema refresh and concurrency: OK');
