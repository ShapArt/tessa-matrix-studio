import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.example.test' };
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
const source = fs.readFileSync(process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source.replace('window.__TESSA_MATRIX_SYNC_EXPORTS__ = {',
  'window.__diagnosticTest = { existingAddMatches, existingAddMatchesHtml, describeDuplicateDeleteConflict, DuplicateValidationError }; window.__TESSA_MATRIX_SYNC_EXPORTS__ = {'));
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__, D = window.__diagnosticTest;
const structure = { templateId: 't', conditions: [{ criterionRowId: 'c', criterionName: 'Число', operandTypeId: E.constants.OPERAND.Int }], functions: [{ id: 'f', name: 'Исполнитель' }] };
const row = n => {
  const flat = { 'criterion:c': [String(n)], 'function:f': ['Тестер'] };
  return { index: n - 1, rowCardId: `r${n}`, versionId: `v${n}`, flat, fingerprint: E.fingerprintFlat(flat), values: { c: [{ kind: 'Int', value: n, display: String(n) }] }, roles: { f: [{ id: 'person', roleTypeId: 1, display: 'Тестер' }] } };
};
const snapshot = { matrixId: 'm', templateId: 't', rows: [1, 2, 3].map(row) };
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, { TemplateID: 't' });
const book = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const clone = () => ({ ...book, rows: book.rows.map(r => ({ ...r, values: [...r.values] })) });
const copied = clone();
copied.rows.push(...[117, 134].map(excelRow => {
  const copy = { ...copied.rows[0], excelRow, values: [...copied.rows[0].values] };
  copy.values[0] = '2';
  return copy;
}));
const plan = E.buildPlan(copied, structure, snapshot);
assert.equal(plan.counts.add, 0);
assert.equal(plan.counts.skip, 0);
const matches = D.existingAddMatches(plan);
assert.deepEqual(matches.map(x => [x.excelRow, x.tessaRow, x.sourceRow]), [[117, 2, 1], [134, 2, 1]]);
assert.deepEqual(matches[0].changes[0], { label: 'Число', before: ['1'], after: ['2'] });
const html = D.existingAddMatchesHtml(plan);
assert.match(html, /Excel 117 → TESSA 2/);
assert.match(html, /Распознаны правки/);
assert.doesNotMatch(plan.warnings.join('\n'), /будут пропущены/, 'NOOP copies must not claim a SKIP');

// Independently edited copies and an ordinary edit must remain executable.
const unique = clone();
unique.rows[2].values[0] = '30';
unique.rows.push(...[10, 11].map((value, index) => ({ ...unique.rows[0], excelRow: 90 + index, values: unique.rows[0].values.map((v, i) => i === 0 ? String(value) : v) })));
const uniquePlan = E.buildPlan(unique, structure, snapshot);
assert.equal(uniquePlan.counts.add, 2);
assert.equal(uniquePlan.counts.update, 1);
assert.equal(D.existingAddMatches(uniquePlan).length, 0);

// An invalid edited value can be recovered to baseline. It must remain visible
// in All/Skip/Errors even when the resulting mutation is NOOP, and stay searchable.
const invalidPlan = { ...plan, skippedValues: [
  { excelRow: 19, label: 'Функция', value: '<img src=x>', reason: 'Значение не найдено' },
  { excelRow: 19, label: 'Функция', value: 'second', reason: 'Значение не найдено' },
], skippedRows: [] };
assert.equal(E.selectPreviewItems(invalidPlan, null, { filter: 'error' }).total, 1);
assert.equal(E.selectPreviewItems(invalidPlan, null, { filter: 'skip' }).total, 1);
assert.equal(E.selectPreviewItems(invalidPlan, null, { filter: 'all', query: 'second' }).total, 1);
assert.equal(E.selectPreviewItems(invalidPlan, null, { filter: 'update' }).total, 0);
if (E.previewAttentionSummary) {
  const attention = E.previewAttentionSummary(invalidPlan, E.createPlanReviewState());
  assert.equal(attention.notApplied, 1);
  assert.equal(attention.errors, 1);
}
const overlap = { ...invalidPlan, skippedRows: [{ excelRow: 19, code: 'duplicate-found', reason: 'duplicate' }] };
assert.equal(E.selectPreviewItems(overlap, null, { filter: 'error' }).total, 1, 'count each affected row once');
const uncoded = { ...invalidPlan, skippedRows: [{ excelRow: 19, reason: 'No roles remain' }] };
const beforeSelection = JSON.stringify(uncoded);
assert.equal(E.selectPreviewItems(uncoded, null, { filter: 'error', query: 'second' }).total, 1, 'a whole-row skip must not hide its invalid cell value');
assert.equal(JSON.stringify(uncoded), beforeSelection, 'diagnostic selection must not mutate the plan');

// The server can still reject a temporary duplicate before a planned deletion.
// Preserve the safety result and explain the actual dependency, never fake success.
const dependent = clone();
dependent.rows[0].values[0] = '2'; dependent.rows.splice(1, 1);
const depPlan = E.buildPlan(dependent, structure, snapshot);
const update = depPlan.actions.find(a => a.type === 'update');
const skip = { code: 'duplicate-found', reason: 'generic', writeAttempted: false };
D.describeDuplicateDeleteConflict(skip, update, depPlan, structure);
assert.match(skip.reason, /Изменение распознано/);
assert.match(skip.reason, /TESSA 2/);
assert.match(skip.reason, /1 → 2/);
assert.equal(skip.writeAttempted, false);
const otherError = { code: 'duplicate-response-invalid', reason: 'original' };
D.describeDuplicateDeleteConflict(otherError, update, depPlan, structure);
assert.equal(otherError.reason, 'original');
const originalCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => ({
  matrixInfo: () => ({ matrixId: 'm', TemplateID: 't', StateName: 'Черновик' }),
  templateId: () => 't', requestStructure: async () => structure, loadSnapshot: async () => snapshot,
  resolveReferenceOnline: async () => null,
  resolveCriterion: (c, display, id) => ({ id, display }), resolveRole: (f, display, id) => ({ id, display }),
  getCard: async () => ({}), rebuildRowCard: () => {},
  validateDuplicate: async () => { throw new D.DuplicateValidationError('duplicate', 'duplicate-found'); },
});
try {
  const preflight = await E.preflightPlan(depPlan, { previewOnly: true });
  assert.equal(preflight.preparedUpdates.size, 0);
  assert.equal(preflight.readyDeletes.length, 0);
  assert.equal(preflight.runtimeSkips.length, 2);
  assert.match(preflight.runtimeSkips[0].reason, /Изменение распознано/);
  assert.match(preflight.runtimeSkips[0].reason, /TESSA 2/);
} finally { E.TessaBridge.create = originalCreate; }

// Bound the DOM work even for many repeated imports; labels are untrusted Excel text.
const unsafePlan = { ...plan, actions: plan.actions.map(a => a.excelRow ? ({ ...a, excelRow: { ...a.excelRow, columns: new Map([...a.excelRow.columns].map(([id, column]) => [id, { ...column, excelHeader: '<img src=x onerror=alert(1)>' }])) } }) : a) };
const escapedHtml = D.existingAddMatchesHtml(unsafePlan);
assert.match(escapedHtml, /&lt;img/);
assert.doesNotMatch(escapedHtml, /<img/);
const repeated = { ...plan, actions: Array.from({ length: 1000 }, () => plan.actions.find(a => a.idempotentExistingAdd)) };
assert.equal((D.existingAddMatchesHtml(repeated).match(/class="tms-skip-line"/g) || []).length, 20);
const report = E.buildPreviewReport(invalidPlan);
assert.equal(report.skippedValues.length, 2);
assert.equal(report.existingAddMatches.length, 2);
assert.equal(E.applyAvailability(invalidPlan).count, 0, 'diagnostics must never become writes');
console.log('Copied row recognition, rejected-value visibility and duplicate/delete diagnostics: OK');
