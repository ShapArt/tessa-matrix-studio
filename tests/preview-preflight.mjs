import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.applyPreflightPreview === 'function', 'applyPreflightPreview is missing');
assert(code.includes("onProgress: previewProgress"), 'analyze must surface incremental Preview preflight progress');
assert(code.includes("preflightPlan(plan, { previewOnly: true, bridge, structure, onProgress: previewProgress })"), 'analyze must run Preview preflight against a freshly reloaded TESSA snapshot with progress reporting');
assert(!code.includes("fresh: snapshot"), 'Preview preflight must not reuse the potentially cached planner snapshot');
assert(code.includes("if (!previewOnly) assertNativeEditMode();"), 'Preview preflight must stay non-mutating and must not require native edit mode');

const goodUpdate = { type: 'update', excelRow: { excelRow: 18 }, changes: [{ key: 'org' }] };
const invalidDictionary = { type: 'update', excelRow: { excelRow: 22 }, changes: [{ key: 'org' }] };
const dependentDelete = { type: 'delete', currentRow: { index: 9, versionId: 'v-delete' } };
const noop = { type: 'noop', excelRow: { excelRow: 30 }, changes: [] };
const plan = {
  id: 'preview-preflight-plan',
  actions: [goodUpdate, invalidDictionary, dependentDelete, noop],
  skippedRows: [{ excelRow: 21, reason: 'Строка полностью очищена', phase: 'planner' }],
  counts: E.countActions([goodUpdate, invalidDictionary, dependentDelete, noop], [{ excelRow: 21 }]),
};
const runtimeSkips = [
  { excelRow: 22, reason: 'Значение справочника не найдено', phase: 'preflight-update', actionType: 'update' },
  { excelRow: null, reason: 'Связанное изменение Excel 23 не прошло предварительную проверку', phase: 'preflight-delete', actionType: 'delete' },
];
const preflight = {
  runtimeSkips,
  runtimeSkippedActions: new Set([invalidDictionary, dependentDelete]),
  preparedUpdates: new Map([[18, { action: goodUpdate }]]),
  preparedAdds: new Map(),
  readyDeletes: [],
  previewPolicy: { skipServerAddValidation: false, applyBlocked: false },
};

const reviewed = E.applyPreflightPreview(plan, preflight);
assert(reviewed !== plan, 'preview projection must return a new plan object');
assert(plan.actions.length === 4, 'preview projection mutated original actions');
assert(plan.skippedRows.length === 1, 'preview projection mutated original skipped rows');
assert(reviewed.actions.includes(goodUpdate), 'valid UPDATE disappeared from preview');
assert(reviewed.actions.includes(noop), 'NOOP rows must remain available for unchanged counters');
assert(!reviewed.actions.includes(invalidDictionary), 'runtime-invalid dictionary UPDATE remained executable');
assert(!reviewed.actions.includes(dependentDelete), 'dependent DELETE remained executable after its mutation failed preflight');
assert(reviewed.skippedRows.length === 3, `planner + runtime skips were not combined: ${reviewed.skippedRows.length}`);
assert(reviewed.counts.update === 1, `expected one executable UPDATE, got ${JSON.stringify(reviewed.counts)}`);
assert(reviewed.counts.delete === 0, `runtime-skipped DELETE remained in counters: ${JSON.stringify(reviewed.counts)}`);
assert(reviewed.counts.skip === 3, `skip counter must include planner + preflight skips: ${JSON.stringify(reviewed.counts)}`);
assert(reviewed.preflightPreview?.validated === true, 'preview validation marker is missing');
assert(reviewed.preflightPreview?.runtimeSkipCount === 2, 'runtime skip summary is missing');
assert(reviewed.preflightPreview?.serverAddValidationSkipped === false, 'normal Preview must report deep ADD validation');

console.log('TESSA Matrix Studio preview preflight projection regression: OK');
