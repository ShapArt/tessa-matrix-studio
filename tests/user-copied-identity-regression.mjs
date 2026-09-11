import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
vm.runInThisContext(fs.readFileSync(process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;
const structure = {
  templateId: 't-user-copy',
  conditions: [{ criterionRowId: 'c', criterionName: 'Номер', operandTypeId: O.Int }],
  functions: [{ id: 'f', name: 'Исполнитель' }],
};
function makeRow(n) {
  const flat = { 'criterion:c': [String(n)], 'function:f': ['Тестер'] };
  return {
    index: n - 1,
    rowCardId: `r${n}`,
    versionId: `v${n}`,
    flat,
    fingerprint: E.fingerprintFlat(flat),
    values: { c: [{ kind: 'Int', value: n, display: String(n) }] },
    roles: { f: [{ id: 'person', roleTypeId: 1, display: 'Тестер' }] },
  };
}
const snapshot = { matrixId: 'm-user-copy', templateId: structure.templateId, rows: Array.from({ length: 5 }, (_, i) => makeRow(i + 1)) };
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, { TemplateID: structure.templateId });
const book = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const criterionCol = book.schemaTokens.indexOf('criterion:c');
assert.ok(criterionCol >= 0);

// Mirrors the 2026-09-11 live UAT: two originals are removed, while one surviving
// Excel row is copied several times. All copies retain the same hidden source identity
// and all are edited, so none still equals the original TESSA fingerprint.
const edited = { ...book, rows: book.rows.map(row => ({ ...row, values: [...row.values] })) };
edited.rows = edited.rows.filter((_, index) => index !== 0 && index !== 1); // two DELETEs
const source = edited.rows[0]; // original r3 survives
const variants = [300, 301, 302, 303].map((value, index) => {
  const row = { ...source, excelRow: source.excelRow + index * 2, values: [...source.values] };
  row.values[criterionCol] = String(value);
  return row;
});
edited.rows = [...variants, ...edited.rows.slice(1)];

const plan = E.buildPlan(edited, structure, snapshot);
const counts = plan.counts;
assert.equal(counts.skip, 0, `copied rows must not be discarded: ${JSON.stringify(plan.skippedRows)}`);
assert.equal(counts.update, 1, `one deterministic copy must own the existing identity: ${JSON.stringify(counts)}`);
assert.equal(counts.add, 3, `remaining edited copies must be new rows: ${JSON.stringify(counts)}`);
assert.equal(counts.delete, 2, `missing baseline rows must remain DELETEs: ${JSON.stringify(counts)}`);
assert.ok(!plan.warnings.some(message => /удаление.*отключено/i.test(message)), JSON.stringify(plan.warnings));
assert.deepEqual(
  plan.actions.filter(action => action.type === 'delete').map(action => action.currentRow.rowCardId).sort(),
  ['r1', 'r2'],
);

console.log('User copied-identity lifecycle regression: OK');
