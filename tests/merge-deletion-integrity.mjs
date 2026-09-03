import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;
const structure = {
  templateId: 'template',
  conditions: [
    { criterionRowId: 'ref', criterionName: 'Организация', operandTypeId: E.constants.OPERAND.ReferenceGuid },
    { criterionRowId: 'text', criterionName: 'Условие', operandTypeId: E.constants.OPERAND.String },
  ],
  functions: [{ id: 'role', name: 'Исполнитель' }],
};
function row(id, ref = 'org-a', text = id) {
  const flat = { 'criterion:ref': ['Компания'], 'criterion:text': [text], 'function:role': ['Тестер'] };
  return { index: 0, rowCardId: id, versionId: `v-${id}`, flat, fingerprint: E.fingerprintFlat(flat),
    values: { ref: [{ id: ref, display: 'Компания' }], text: [{ kind: 'String', display: text }] },
    roles: { role: [{ id: 'person', display: 'Тестер', roleTypeId: 1 }] } };
}
const snapshot = { matrixId: 'matrix', rows: [row('a'), row('b'), row('c')] };
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, { TemplateID: 'template' }, null, { includeActions: true });
const original = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const clone = () => ({ ...original, rows: original.rows.map(r => ({ ...r, values: [...r.values] })) });
const col = key => original.schemaTokens.indexOf(key);
const prepare = (book, fresh, choices) => E.prepareThreeWayMerge(book, structure, fresh, choices);
const merge = (book, fresh) => E.mergeWorkbookIntoCurrentSnapshot(book, structure, fresh).snapshot;
const changedRole = (id, roleTypeId) => {
  const changed = row('a');
  changed.roles.role[0] = { id, roleTypeId, display: 'Тестер' };
  return changed;
};

for (const [field, value] of [['baseFingerprint', ''], ['versionId', 'v-b'], ['rowCardId', 'b']]) {
  test(`merge rejects damaged ${field} before replacing the baseline`, () => {
    const book = clone();
    book.rows[0].values[col(`system:${field}`)] = value;
    assert.throws(() => prepare(book, snapshot), /служеб|baseline|идентифик|fingerprint/i);
  });
}

test('keeping TESSA in an explicit deletion conflict preserves the entire server row', () => {
  const book = clone();
  book.rows[0].values[col('system:action')] = 'Удалить';
  book.rows[0].values[col('criterion:text')] = 'Локальная правка перед удалением';
  const fresh = { ...snapshot, rows: [row('a', 'org-b'), ...snapshot.rows.slice(1)] };
  const pending = prepare(book, fresh);
  assert.equal(pending.unresolved.length, 1);
  assert.equal(pending.unresolved[0].kind, 'local-delete');
  const chosen = prepare(book, fresh, { [pending.unresolved[0].id]: 'server' });
  const result = merge(chosen.workbook, fresh).rows[0];
  assert.equal(result.values.ref[0].id, 'org-b');
  assert.equal(result.values.text[0].display, 'a');
  assert.equal(result.action, '');
});

test('deletion conflict needs one row-level choice even after both sides edit a cell', () => {
  const book = clone();
  book.rows[0].values[col('system:action')] = 'Удалить';
  book.rows[0].values[col('criterion:text')] = 'Моё';
  const fresh = { ...snapshot, rows: [row('a', 'org-a', 'Их'), ...snapshot.rows.slice(1)] };
  const pending = prepare(book, fresh);
  assert.deepEqual(pending.unresolved.map(c => c.kind), ['local-delete']);
  const chosen = prepare(book, fresh, { [pending.unresolved[0].id]: 'mine' });
  assert.equal(merge(chosen.workbook, fresh).rows[0].action, 'УДАЛИТЬ');
});

test('physical deletion detects a changed reference with the same visible name', () => {
  const book = clone();
  book.rows.shift();
  const fresh = { ...snapshot, rows: [row('a', 'org-b'), ...snapshot.rows.slice(1)] };
  const pending = prepare(book, fresh);
  assert.equal(pending.unresolved.length, 1);
  const chosen = prepare(book, fresh, { [pending.unresolved[0].id]: 'server' });
  assert.equal(merge(chosen.workbook, fresh).rows[0].values.ref[0].id, 'org-b');
});

test('restoring a remotely deleted row is explicit ADD alongside another local deletion', () => {
  const book = clone();
  book.rows[0].values[col('criterion:text')] = 'Восстановить';
  book.rows.splice(1, 1);
  const fresh = { ...snapshot, rows: snapshot.rows.slice(1) };
  const pending = prepare(book, fresh);
  const chosen = prepare(book, fresh, { [pending.unresolved[0].id]: 'mine' });
  const result = merge(chosen.workbook, fresh);
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.some(r => r.action === 'ДОБАВИТЬ' && r.values.text[0].display === 'Восстановить'));
  assert.ok(!result.rows.some(r => r.rowCardId === 'b'));
});

test('Preview never deletes rows added by another user after export', () => {
  const fresh = { ...snapshot, rows: [...snapshot.rows, row('remote')] };
  assert.equal(E.buildPlan(original, structure, fresh).counts.delete, 0);
  const book = clone();
  book.rows.shift();
  const plan = E.buildPlan(book, structure, fresh);
  assert.deepEqual(plan.actions.filter(a => a.type === 'delete').map(a => a.currentRow.rowCardId), ['a']);
});

test('Preview cannot overwrite a concurrent reference change hidden behind the same name', () => {
  const book = clone();
  book.rows[0].values[col('criterion:text')] = 'Моя правка';
  const fresh = { ...snapshot, rows: [row('a', 'org-b'), ...snapshot.rows.slice(1)] };
  const plan = E.buildPlan(book, structure, fresh);
  assert.equal(plan.counts.update, 0);
  assert.equal(plan.counts.delete, 0);
  assert.equal(plan.counts.skip, 1);
  const prepared = prepare(book, fresh);
  assert.equal(prepared.unresolved.length, 0);
  const merged = merge(prepared.workbook, fresh).rows[0];
  assert.equal(merged.values.ref[0].id, 'org-b');
  assert.equal(merged.values.text[0].display, 'Моя правка');
});

for (const explicit of [false, true]) {
  test(`${explicit ? 'explicit' : 'physical'} delete cannot remove a changed baseline row`, () => {
    for (const updated of [row('a', 'org-b'), row('a', 'org-a', 'Чужая правка'), changedRole('other-person', 1), changedRole('person', 2)]) {
      const book = clone();
      if (explicit) book.rows[0].values[col('system:action')] = 'Удалить';
      else book.rows.shift();
      const plan = E.buildPlan(book, structure, { ...snapshot, rows: [updated, ...snapshot.rows.slice(1)] });
      assert.equal(plan.counts.delete, 0);
      assert.match(JSON.stringify([plan.skippedRows, plan.warnings, plan.issues]), /измени|конфликт/i);
      const pending = prepare(book, { ...snapshot, rows: [updated, ...snapshot.rows.slice(1)] });
      assert.equal(pending.unresolved.length, 1);
      assert.equal(pending.unresolved[0].kind, 'local-delete');
    }
  });
}
