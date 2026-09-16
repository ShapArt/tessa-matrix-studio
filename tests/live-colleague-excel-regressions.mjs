import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { applyLiveExcelPreviewUx } from '../hotfixes/v1.14.2-live-excel-preview-ux.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/live-ord-main-78792326-regression.json', import.meta.url), 'utf8'));
const baseline = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const source = applyLiveExcelPreviewUx(baseline);
assert.match(source, /LIVE_EXCEL_PREVIEW_UX_V1/);

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(source, { filename: 'tessa-matrix-studio-live-excel-preview-ux.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

assert.ok(E, 'test exports must exist');

for (const employee of fixture.pickerEmployees) {
  let copied = '';
  assert.doesNotThrow(() => {
    copied = E.pickerSelectionText([employee]);
  }, `${employee.shortName}: long/multi-position employee must remain copyable`);
  assert.ok(copied.trim(), `${employee.shortName}: copied value must not be empty`);
  assert.doesNotMatch(copied, /[;\r\n\t]/, `${employee.shortName}: one employee selector must stay one Excel value`);

  const catalog = E.normalizeDictionaryCatalog({
    catalogs: { people: { id: 'people', sourceView: 'MtxRoles', entries: [{ ...employee }] } },
    columnCatalogIds: { 'function:sign': 'people' },
    stats: { errors: [], warnings: [] },
  });
  const resolved = E.resolveEmbeddedDictionaryValue({ dictionaryCatalog: catalog }, { key: 'function:sign', kind: 'function', excelHeader: 'Согласование' }, copied, '');
  assert.equal(resolved.resolved, true, `${employee.shortName}: copied compact selector must resolve back to exact dictionary item`);
  assert.equal(String(resolved.explicit).split('|')[0], employee.id);
}

assert.equal(typeof E.previewAttentionSummary, 'function', 'Preview must expose one canonical attention-summary model');
const skippedRows = Array.from({ length: fixture.preview.skippedRows }, (_, i) => ({
  excelRow: i + 15,
  code: i < 12 ? 'invalid-value' : '',
  reason: i < 12 ? `Некорректное значение ${i + 1}` : `Строка ${i + 1} не будет применена`,
}));
const resolutionItems = Array.from({ length: fixture.preview.resolutionValues }, (_, i) => ({
  id: `live-resolution-${i}`,
  excelRow: 15 + (i % fixture.preview.skippedRows),
  column: 'Ознакомление',
  issue: fixture.preview.sample.issue,
  resolution: 'employee-position-only',
  candidates: [{ id: `candidate-${i}`, selector: `Сотрудник ${i}` }],
}));
const resolutionByRow = new Map();
for (const item of resolutionItems) {
  if (!resolutionByRow.has(item.excelRow)) resolutionByRow.set(item.excelRow, []);
  resolutionByRow.get(item.excelRow).push(item);
}
const desired = [...resolutionByRow.entries()].map(([excelRow, items]) => ({ excelRow, resolutionItems: items }));
const plan = {
  actions: [],
  counts: { update: 0, add: 0, delete: 0, noop: 100, skip: fixture.preview.skippedRows },
  skippedRows,
  desired,
  skippedFields: [],
  safety: { blocked: false, blockedReasons: [] },
};
const summary = E.previewAttentionSummary(plan, E.createPlanReviewState());
assert.equal(summary.notApplied, fixture.preview.skippedRows);
assert.equal(summary.errors, 12);
assert.equal(summary.resolutionValues, fixture.preview.resolutionValues);
assert.equal(summary.resolutionRows, fixture.preview.skippedRows);
assert.match(summary.notAppliedLabel, /не будет применено/i);
assert.match(summary.resolutionLabel, /747.*196|196.*747/);

assert.equal(typeof E.resolutionCenterWindow, 'function', 'Resolution Center must expose bounded rendering window');
const windowed = E.resolutionCenterWindow(resolutionItems, 0, fixture.expected.resolutionPageSize);
assert.equal(windowed.total, fixture.preview.resolutionValues);
assert.equal(windowed.items.length, fixture.expected.resolutionPageSize);
assert.equal(windowed.hidden, fixture.preview.resolutionValues - fixture.expected.resolutionPageSize);
assert.equal(windowed.page, 1);
assert.ok(windowed.pageCount > 1);
const lastPage = E.resolutionCenterWindow(resolutionItems, 999, fixture.expected.resolutionPageSize);
assert.equal(lastPage.page, lastPage.pageCount, 'out-of-range page must clamp safely');
assert.ok(lastPage.items.length > 0 && lastPage.items.length <= fixture.expected.resolutionPageSize);

assert.match(source, /Ошибки \$\{attention\.errors\}/, 'error filter must carry its count');
assert.match(source, /Не будет применено \$\{attention\.notApplied\}/, 'skip filter must explain that rows are not applied');
assert.doesNotMatch(source, /<details class=\\"tms-action\\" open><summary><b>/, 'large Resolution Center entries must be collapsed by default');
assert.match(source, /data-resolution-page/, 'large Resolution Center must have bounded pagination');
assert.match(source, /live-colleague-picker-multi-position/);
assert.match(source, /live-colleague-preview-attention/);

console.log('Live colleague regression: multi-position picker copy + visible Preview counts + bounded Resolution Center + Full UAT checks: OK');
