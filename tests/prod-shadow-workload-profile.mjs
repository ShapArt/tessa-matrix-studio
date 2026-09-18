import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert.equal(typeof E.productionShadowProfile, 'function', 'productionShadowProfile export missing');

// Aggregate shape observed in the 2026-09-18 production workbook dry-run.
// Business values are intentionally not stored in the public regression fixture.
const fieldSpec = [
  ['Организация ГЧ ✅', { notFound: 628, positionOnly: 0, ambiguous: 42 }],
  ['Обязательные', { notFound: 534, positionOnly: 16, ambiguous: 0 }],
  ['Подписание', { notFound: 318, positionOnly: 150, ambiguous: 0 }],
  ['Доп. область документа ✅', { notFound: 342, positionOnly: 0, ambiguous: 3 }],
  ['Область документа ✅', { notFound: 261, positionOnly: 0, ambiguous: 0 }],
  ['Для сведения', { notFound: 51, positionOnly: 5, ambiguous: 0 }],
  ['Ознакомление', { notFound: 21, positionOnly: 1, ambiguous: 0 }],
  ['Доп. эксперт', { notFound: 9, positionOnly: 0, ambiguous: 0 }],
  ['Доп. согласование', { notFound: 3, positionOnly: 0, ambiguous: 0 }],
  ['Функция ✅', { notFound: 1, positionOnly: 0, ambiguous: 0 }],
];

const issueMessages = [];
for (const [field, spec] of fieldSpec) {
  for (let i = 0; i < spec.notFound; i += 1) {
    issueMessages.push(`Значение "QA-${field}-${i}" не найдено в справочнике "${field}".`);
  }
  for (let i = 0; i < spec.positionOnly; i += 1) {
    issueMessages.push(`"QA должность ${i}" похоже на должность, а не на ФИО сотрудника. Выберите сотрудника явно из актуального справочника "${field}".`);
  }
  for (let i = 0; i < spec.ambiguous; i += 1) {
    issueMessages.push(`По запросу "QA неоднозначное ${i}" в столбце "${field}" найдено 2 вариантов: QA A; QA B.`);
  }
}
issueMessages.push('после изменений не останется исполнителей.');
assert.equal(issueMessages.length, 2386, 'fixture must preserve observed issue-occurrence cardinality');

// Preserve the real row-level shape too: 478 skipped source rows, ~5 issues per row,
// and at least one dense row. This catches accidental report truncation/flattening.
const perRow = Array.from({ length: 478 }, () => []);
for (let i = 0; i < 21; i += 1) perRow[0].push(issueMessages.shift());
let row = 1;
while (issueMessages.length) {
  if (perRow[row].length < 5) perRow[row].push(issueMessages.shift());
  row += 1;
  if (row >= perRow.length) row = 1;
}
const skippedRows = perRow.map((messages, index) => ({
  excelRow: 15 + index,
  reason: messages.map(message => `Excel ${15 + index}: ${message}`).join(' '),
  source: 'excel-validation',
  actionType: 'add',
}));

const plan = {
  counts: { noop: 2, update: 0, add: 8, delete: 101, skip: 478 },
  workbook: { rows: Array.from({ length: 488 }, (_, index) => ({ excelRow: 15 + index })) },
  snapshot: { rows: Array.from({ length: 103 }, (_, index) => ({ index })) },
  structure: {
    conditions: Array.from({ length: 14 }, (_, index) => ({ criterionRowId: `c-${index}` })),
    functions: Array.from({ length: 9 }, (_, index) => ({ id: `f-${index}` })),
  },
  columnMap: {
    retiredColumns: [{ id: 'old-1' }, { id: 'old-2' }],
    missingCurrentColumns: [{ id: 'new-1' }, { id: 'new-2' }, { id: 'new-3' }, { id: 'new-4' }],
  },
  safety: {
    blocked: true,
    mappedHeaders: 23,
    totalHeaders: 23,
    mappedFunctions: 9,
    workbookContext: { kind: 'same-template-foreign-matrix' },
    crossMatrixReplacement: true,
  },
  desired: [{ resolutions: Array.from({ length: 239 }, (_, index) => `QA resolution ${index}`) }],
  skippedRows,
};

const profile = E.productionShadowProfile(plan);
assert.equal(profile.sourceRows, 488);
assert.equal(profile.targetRows, 103);
assert.deepEqual(profile.planned, { noop: 2, update: 0, add: 8, delete: 101, skip: 478 });
assert.deepEqual(profile.structure, {
  criteria: 14,
  functions: 9,
  mappedHeaders: 23,
  totalHeaders: 23,
  mappedFunctions: 9,
  retiredColumns: 2,
  targetOnlyColumns: 4,
});
assert.equal(profile.context.kind, 'same-template-foreign-matrix');
assert.equal(profile.context.crossMatrixReplacement, true);
assert.equal(profile.context.blocked, true);
assert.equal(profile.resolution.autoUniqueFragment, 239);
assert.equal(profile.resolution.skippedRows, 478);
assert.equal(profile.resolution.issueOccurrences, 2386);
assert.equal(profile.resolution.categories.notFound, 2168);
assert.equal(profile.resolution.categories.positionOnly, 172);
assert.equal(profile.resolution.categories.ambiguous, 45);
assert.equal(profile.resolution.categories.noPerformers, 1);
assert.equal(profile.resolution.categories.other, 0);
assert.equal(profile.resolution.fields['Организация ГЧ ✅'].total, 670);
assert.equal(profile.resolution.fields['Обязательные'].total, 550);
assert.equal(profile.resolution.fields['Подписание'].total, 468);
assert.equal(profile.resolution.fields['Доп. область документа ✅'].total, 345);
assert.equal(profile.resolution.fields['Область документа ✅'].total, 261);
assert.equal(profile.resolution.maxIssuesPerRow, 21);
assert(profile.resolution.averageIssuesPerSkippedRow > 4.9 && profile.resolution.averageIssuesPerSkippedRow < 5.1,
  `unexpected issue density: ${profile.resolution.averageIssuesPerSkippedRow}`);

// Support/Preview exports must carry the anonymized shape so future prod artifacts can
// feed UAT planning without manually re-counting thousands of error strings.
const report = E.buildPreviewReport(plan, E.createPlanReviewState());
assert.deepEqual(report.productionShadow, profile);
const support = E.buildPreviewSupportReport(plan, E.createPlanReviewState());
assert.deepEqual(support.productionShadow, profile);

console.log('TESSA Matrix Studio production-shadow workload profile: OK');
