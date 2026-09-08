import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source);
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;

// The ordinary Apply button must verify what was actually persisted. A successful
// Store response alone is not enough to tell the user that ADD/DELETE really stuck.
assert.match(source, /#tms-apply'\)\.addEventListener\('click', \(\) => applySelected\(true\)\)/,
  'normal Apply still skips post-write reconciliation');

const structure = {
  templateId: 'crud-template',
  conditions: [{ criterionRowId: 'c', criterionName: 'Число', operandTypeId: E.constants.OPERAND.Int }],
  functions: [{ id: 'f', name: 'Исполнитель' }],
};

function sourceRow(n) {
  const flat = { 'criterion:c': [String(n)], 'function:f': ['Тестер'] };
  return {
    index: n - 1,
    rowCardId: `r${n}`,
    versionId: `v${n}`,
    values: { c: [{ kind: 'Int', value: n, display: String(n) }] },
    roles: { f: [{ id: 'person', display: 'Тестер', roleTypeId: 1 }] },
    flat,
    fingerprint: E.fingerprintFlat(flat),
  };
}

const snapshot = { matrixId: 'm', rows: [1, 2, 3, 4].map(sourceRow) };
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, { TemplateID: structure.templateId }, null, { includeActions: true });
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const book = await E.readXlsxArrayBuffer(buffer);
const index = token => book.schemaTokens.indexOf(token);

const cleared = { ...book.rows[1], values: [...book.rows[1].values] };
for (let i = 0; i < cleared.values.length; i++) cleared.values[i] = '';
cleared.values[index('system:rowCardId')] = 'r2';
cleared.values[index('system:versionId')] = 'v2';
cleared.values[index('system:baseFingerprint')] = snapshot.rows[1].fingerprint;
cleared.values[index('system:action')] = '';

const rowA = book.rows[0];
const rowD = book.rows[3];
const blank1 = { excelRow: 50, values: Array(book.headers.length).fill('') };
const blank2 = { excelRow: 51, values: Array(book.headers.length).fill('') };
const blank3 = { excelRow: 52, values: Array(book.headers.length).fill('') };
const added = { excelRow: 60, values: Array(book.headers.length).fill('') };
added.values[index('criterion:c')] = '5';
added.values[index('function:f')] = 'Тестер';
added.values[index('function:f:id')] = 'person|1';

const changed = { ...book, rows: [rowA, cleared, blank1, blank2, blank3, rowD, added] };
const plan = E.buildPlan(changed, structure, snapshot);

assert.deepEqual(plan.counts, { noop: 2, update: 0, add: 1, delete: 2, skip: 0 },
  `live CRUD intent was not preserved: ${JSON.stringify({ counts: plan.counts, warnings: plan.warnings, issues: plan.issues, skippedRows: plan.skippedRows })}`);
assert.deepEqual(plan.actions.filter(a => a.type === 'delete').map(a => a.currentRow.rowCardId).sort(), ['r2', 'r3']);
assert.equal(plan.actions.find(a => a.type === 'add')?.excelRow?.excelRow, 60);
assert.ok(!plan.warnings.some(message => /автоматическое удаление.*отключено/i.test(message)),
  `legal ADD + DELETE triggered the identity-loss guard: ${JSON.stringify(plan.warnings)}`);

const changedServerRow = sourceRow(2);
changedServerRow.flat = { ...changedServerRow.flat, 'criterion:c': ['200'] };
changedServerRow.values = { c: [{ kind: 'Int', value: 200, display: '200' }] };
changedServerRow.fingerprint = E.fingerprintFlat(changedServerRow.flat);
const concurrent = { ...snapshot, rows: [snapshot.rows[0], changedServerRow, snapshot.rows[2], snapshot.rows[3]] };
const guarded = E.buildPlan(changed, structure, concurrent);
assert.ok(!guarded.actions.some(a => a.type === 'delete' && a.currentRow.rowCardId === 'r2'),
  'cleared-row DELETE bypassed concurrent-change protection');
assert.match(JSON.stringify([guarded.skippedRows, guarded.warnings, guarded.issues]), /измени|конфликт/i,
  'concurrent cleared-row DELETE was not surfaced as a conflict');

console.log('Cleared-row DELETE + physical DELETE + blank gaps + new no-ID ADD + verified Apply: OK');
