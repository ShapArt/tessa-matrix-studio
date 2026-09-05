import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = {
  body: { innerText: '' },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ click() {}, style: {} }),
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

assert.equal(typeof E.previewRoleTypeLabel, 'function', 'previewRoleTypeLabel must be exported');
assert.equal(E.previewRoleTypeLabel(0), 'Статическая');
assert.equal(E.previewRoleTypeLabel(1), 'Сотрудник');
assert.equal(E.previewRoleTypeLabel(2), 'Подразделение');
assert.equal(E.previewRoleTypeLabel(3), 'Динамическая');
assert.equal(E.previewRoleTypeLabel(4), 'Контекстная');
assert.equal(E.previewRoleTypeLabel(5), 'Метароль');
assert.equal(E.previewRoleTypeLabel(6), 'Задача');
assert.equal(E.previewRoleTypeLabel(7), 'SmartRole');
assert.equal(E.previewRoleTypeLabel(9), 'RoleTypeID: 9', 'unknown/custom role types must not be guessed');
assert.equal(E.previewRoleTypeLabel('custom'), 'RoleTypeID: custom');

const plan = {
  id: 'preview-support-ux',
  matrixId: 'matrix-secret-id',
  templateId: 'template-secret-id',
  columnMap: { columns: new Map([
    ['sign', { id: 'sign', key: 'function:sign', kind: 'function', name: 'Подписание', excelHeader: 'Подписание' }],
    ['org', { id: 'org', key: 'criterion:org', kind: 'criterion', name: 'Организация', excelHeader: 'Организация' }],
  ]) },
  actions: [
    {
      type: 'update',
      excelRow: {
        excelRow: 16,
        flat: { 'function:sign': ['Иванов Иван'], 'criterion:org': ['СЕКРЕТНАЯ ОРГАНИЗАЦИЯ'] },
        ids: { 'function:sign': ['person-secret|1'], 'criterion:org': ['org-secret'] },
      },
      currentRow: { index: 0, flat: { 'function:sign': ['Петров Пётр'], 'criterion:org': ['ДРУГАЯ СЕКРЕТНАЯ ОРГАНИЗАЦИЯ'] } },
      changes: [{ key: 'function:sign', label: 'Подписание', before: ['Петров Пётр'], after: ['Иванов Иван'] }],
    },
    { type: 'add', excelRow: { excelRow: 17, flat: { 'function:sign': ['Группа'], 'criterion:org': ['СЕКРЕТ'] }, ids: { 'function:sign': ['group-secret|9'] } }, changes: [] },
    { type: 'delete', excelRow: null, currentRow: { index: 2, flat: { 'function:sign': ['Удаляемый'], 'criterion:org': ['СЕКРЕТ'] } }, changes: [] },
  ],
  skippedRows: [
    { excelRow: 21, source: 'input-validation', code: 'invalid-value', reason: 'СЕКРЕТНОЕ значение не найдено' },
    { excelRow: 22, source: 'manual-skip', reason: 'Пользователь пропустил строку' },
    { excelRow: 23, source: 'preflight-add', code: 'duplicate-interval-extractor', reason: 'LeftOperandExtractor is null СЕКРЕТ' },
  ],
  skippedFields: [{ excelRow: 24, key: 'function:sign', source: 'input-validation', code: 'ambiguous-value', reason: 'Иванов' }],
  counts: { update: 1, add: 1, delete: 1, noop: 0, skip: 3 },
  safety: { blocked: false, blockedReasons: [] },
  warnings: [],
};
const review = E.createPlanReviewState();

const errors = E.selectPreviewItems(plan, review, { filter: 'error', pageSize: 50 });
assert.equal(errors.total, 2, `ERROR filter must contain coded failures only: ${JSON.stringify(errors.items)}`);
assert.deepEqual(errors.items.map(item => item.skip.excelRow), [21, 23]);
assert.equal(E.selectPreviewItems(plan, review, { filter: 'skip', pageSize: 50 }).total, 3, 'SKIP remains the full rejected-row set');
assert.equal(E.selectPreviewItems(plan, review, { filter: 'all', query: 'подписание' }).total >= 1, true, 'search must find field labels');
assert.equal(E.selectPreviewItems(plan, review, { filter: 'all', query: '23' }).total, 1, 'search must find Excel row numbers');

assert.equal(typeof E.buildPreviewSupportReport, 'function', 'buildPreviewSupportReport must be exported');
const support = E.buildPreviewSupportReport(plan, review, { includeIds: false });
const supportText = JSON.stringify(support);
assert.equal(support.format, 'TESSA_MATRIX_SUPPORT_REPORT_V1');
assert.equal(support.studioVersion, '1.10.3');
assert.deepEqual(support.counts, { update: 1, add: 1, delete: 1, noop: 0, skip: 3, skippedFields: 1 });
assert.deepEqual(support.reasonCodes.sort(), ['ambiguous-value', 'duplicate-interval-extractor', 'invalid-value']);
assert.deepEqual(support.roleTypeIds.sort(), ['1', '9']);
assert.equal(support.apply.canApply, true);
for (const forbidden of ['Иванов', 'Петров', 'СЕКРЕТ', 'person-secret', 'group-secret', 'org-secret', 'matrix-secret-id', 'template-secret-id', 'LeftOperandExtractor']) {
  assert.ok(!supportText.includes(forbidden), `privacy-safe support report leaked ${forbidden}: ${supportText}`);
}
const supportWithIds = E.buildPreviewSupportReport(plan, review, { includeIds: true });
assert.equal(supportWithIds.matrixId, 'matrix-secret-id');
assert.equal(supportWithIds.templateId, 'template-secret-id');
assert.ok(!JSON.stringify(supportWithIds).includes('person-secret'), 'includeIds may expose matrix/template IDs, never business row/role IDs');

assert.ok(code.includes("data-preview-filter=\"error\""), 'Preview toolbar must expose an Error filter');
assert.ok(code.includes('id="tms-download-support-report"'), 'Preview must expose a support-report download button');
assert.ok(code.includes('tms-role-type'), 'Preview role values must render a visible role-type badge');

console.log('TESSA Matrix Studio v1.11 Preview filters, role types and privacy-safe support report: OK');
