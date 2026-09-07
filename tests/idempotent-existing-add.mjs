import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.example.test' };

vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'), {
  filename: 'tessa-matrix-studio.user.js',
});

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const structure = {
  templateId: 't',
  conditions: [{ criterionRowId: 'c', criterionName: 'Число', operandTypeId: E.constants.OPERAND.Int }],
  functions: [{ id: 'f', name: 'Исполнитель' }],
};
const makeRow = (n, suffix = String(n)) => {
  const flat = { 'criterion:c': [String(n)], 'function:f': ['Тестер'] };
  return {
    index: Number(suffix) || 0,
    rowCardId: `r${suffix}`,
    versionId: `v${suffix}`,
    values: { c: [{ kind: 'Int', value: n, display: String(n) }] },
    roles: { f: [{ id: 'person', display: 'Тестер', roleTypeId: 1 }] },
    flat,
    fingerprint: E.fingerprintFlat(flat),
  };
};
const bufferOf = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const exportBook = async snapshot => E.readXlsxArrayBuffer(bufferOf(await E.createRoundtripXlsxBytes(
  structure,
  snapshot,
  { TemplateID: 't' },
  null,
  { includeActions: true },
)));
const explicitAdd = (book, excelRow, n) => {
  const row = { excelRow, values: Array(book.headers.length).fill('') };
  row.values[0] = String(n);
  row.values[2] = 'Тестер';
  row.values[3] = 'person|1';
  row.values[book.schemaTokens.indexOf('system:action')] = 'Добавить';
  return row;
};

// Re-running an ADD that is already present exactly once in current TESSA is idempotent.
// It must become a read-only NOOP, not a scary SKIP and never another ADD.
{
  const snapshot = { matrixId: 'm', rows: [makeRow(1, '1')] };
  const book = await exportBook(snapshot);
  const repeated = { ...book, rows: [...book.rows, explicitAdd(book, 99, 1)] };
  const plan = E.buildPlan(repeated, structure, snapshot);
  assert.equal(plan.counts.add, 0, 'already-existing exact ADD must not remain executable');
  assert.equal(plan.counts.skip, 0, JSON.stringify(plan.skippedRows));
  assert.equal(plan.counts.noop, 2, 'baseline row + repeated exact ADD must both be read-only NOOPs');
  const idempotent = plan.actions.find(action => Number(action.excelRow?.excelRow) === 99);
  assert.equal(idempotent?.type, 'noop');
  assert.equal(idempotent?.match?.matchedBy, 'existing-identical-add');
  assert.equal(idempotent?.currentRow?.rowCardId, 'r1');
}

// Two new identical ADD rows are still ambiguous and must stay fail-closed/localized as SKIP.
{
  const snapshot = { matrixId: 'm', rows: [] };
  const book = await exportBook(snapshot);
  const twoAdds = { ...book, rows: [explicitAdd(book, 90, 7), explicitAdd(book, 91, 7)] };
  const plan = E.buildPlan(twoAdds, structure, snapshot);
  assert.equal(plan.counts.add, 0);
  assert.equal(plan.counts.skip, 2, JSON.stringify(plan.skippedRows));
}

// UPDATE that would collide with another current TESSA row is not idempotency; it stays skipped.
{
  const snapshot = { matrixId: 'm', rows: [makeRow(1, '1'), makeRow(2, '2')] };
  const book = await exportBook(snapshot);
  const editedRows = book.rows.map(row => ({ ...row, values: [...row.values] }));
  editedRows[0].values[0] = '2';
  const plan = E.buildPlan({ ...book, rows: editedRows }, structure, snapshot);
  assert.equal(plan.counts.update, 0);
  assert.equal(plan.counts.skip, 1, JSON.stringify(plan.skippedRows));
}

// If current TESSA itself contains multiple identical rows, an ADD match is ambiguous and must not
// be silently attached to an arbitrary identity.
{
  const snapshot = { matrixId: 'm', rows: [makeRow(4, '1'), makeRow(4, '2')] };
  const book = await exportBook(snapshot);
  const repeated = { ...book, rows: [...book.rows, explicitAdd(book, 92, 4)] };
  const plan = E.buildPlan(repeated, structure, snapshot);
  assert.equal(plan.counts.add, 0);
  assert.equal(plan.counts.skip, 1, JSON.stringify(plan.skippedRows));
  assert.equal(plan.actions.some(action => Number(action.excelRow?.excelRow) === 92 && action.match?.matchedBy === 'existing-identical-add'), false);
}

console.log('Idempotent existing ADD vs true duplicate conflicts: OK');
