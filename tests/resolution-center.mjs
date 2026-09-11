import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'), { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert.equal(typeof E.collectPlanResolutionItems, 'function', 'Resolution Center collector must be exported');
assert.equal(typeof E.applyResolutionChoiceToWorkbook, 'function', 'Resolution Center workbook writer must be exported');
assert.equal(typeof E.finalizeApplyResult, 'function');

const resolution = {
  id: 'excel-28-function-required-0',
  excelRow: 28,
  columnKey: 'function:required',
  column: 'Обязательные',
  columnIndex: 3,
  idIndex: 4,
  valueIndex: 0,
  visible: 'Руководитель управления',
  resolution: 'employee-position-only',
  issue: 'Выберите сотрудника явно.',
  candidates: [
    { id: 'kireeva', roleTypeId: 1, selector: 'Киреева Ю.А. — Руководитель управления', display: 'Киреева Ю.А. — Руководитель управления' },
    { id: 'greku', roleTypeId: 1, selector: 'Греку А.Н. — Руководитель направления', display: 'Греку А.Н. — Руководитель направления' },
  ],
};

const plan = {
  skippedRows: [{
    excelRow: 28,
    source: 'excel-validation',
    actionType: 'update',
    reason: 'Excel 28: Выберите сотрудника явно.',
    resolutionItems: [resolution],
  }],
};
const items = E.collectPlanResolutionItems(plan);
assert.equal(items.length, 1);
assert.equal(items[0].excelRow, 28);
assert.equal(items[0].candidates.length, 2);
assert.equal(items[0].candidates[0].id, 'kireeva');

const workbook = { rows: [{ excelRow: 28, values: ['', '', '', 'Руководитель управления', ''] }] };
const outcome = E.applyResolutionChoiceToWorkbook(workbook, resolution, resolution.candidates[0]);
assert.equal(outcome.changed, true);
assert.equal(workbook.rows[0].values[3], 'Киреева Ю.А. — Руководитель управления');
assert.equal(workbook.rows[0].values[4], 'kireeva|1');
assert.equal(outcome.explicit, 'kireeva|1');

assert.throws(
  () => E.applyResolutionChoiceToWorkbook(workbook, resolution, { id: 'unknown', roleTypeId: 1 }),
  /вариант|кандидат/i,
  'a choice outside the server-provided candidate set must be rejected',
);

const result = {
  rows: [{ type: 'update', excelRow: 31, status: 'ok' }],
  skipped: [{ excelRow: 28, source: 'excel-validation', phase: 'source', reason: 'requires resolution' }],
  sourceSkippedCount: 1,
  preflightSkippedCount: 0,
  requestedCount: 1,
  plannedCount: 1,
  startedCount: 1,
  verificationIncomplete: false,
  refreshError: null,
};
E.finalizeApplyResult(result, { cancelled: false });
assert.equal(result.appliedCount, 1);
assert.equal(result.sourceSkippedCount, 1);
assert.equal(result.status, 'attention', 'unresolved/source-skipped user edits must require attention');
assert.equal(result.partial, true);
assert.equal(result.success, false, 'green success is forbidden while a user edit is unresolved/skipped');

const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
assert.match(source, /tms-resolution-center/, 'Resolution Center UI host must exist');
assert.match(source, /data-resolution-choice/, 'Resolution Center must render explicit candidate choices');
assert.match(source, /Исправить и перепроверить|Выбрать и перепроверить/, 'Resolution Center must offer an in-session correction action');

console.log('TESSA Matrix Studio Resolution Center data, write and attention contracts: OK');
