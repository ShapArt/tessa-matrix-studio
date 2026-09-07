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
const add = {
  type: 'add',
  excelRow: { excelRow: 151, flat: { role: ['Иванов И.И.'] }, ids: {}, compare: {}, columns: new Map() },
  currentRow: null,
  changes: [],
  match: { matchedBy: 'new-row-no-id', lowConfidence: false },
};
const del = {
  type: 'delete',
  excelRow: null,
  currentRow: { index: 8, rowCardId: 'card-delete', versionId: 'version-delete', fingerprint: 'fp-delete', flat: { role: ['Петров П.П.'] }, roles: {} },
  changes: [],
  expectedFingerprint: 'fp-delete',
  match: { matchedBy: 'missing-row-auto-delete', lowConfidence: false },
};
const plan = {
  id: 'review-all-action-types',
  actions: [add, del],
  skippedRows: [],
  snapshot: { rows: [del.currentRow] },
  counts: E.countActions([add, del], []),
  safety: { blocked: false, blockedReasons: [] },
};

const review = E.createPlanReviewState();
E.setPlanReviewRow(review, add, true);
let reviewed = E.buildReviewedPlan(plan, review);
assert(reviewed.actions[0].type === 'noop', `excluded ADD must become NOOP, got ${reviewed.actions[0].type}`);
assert(reviewed.actions[0].originalType === 'add' && reviewed.actions[0].reviewExcluded === true,
  `excluded ADD must keep review metadata: ${JSON.stringify(reviewed.actions[0])}`);
assert(reviewed.counts.add === 0 && reviewed.counts.delete === 1 && reviewed.counts.noop === 1,
  `ADD exclusion counters are wrong: ${JSON.stringify(reviewed.counts)}`);

E.setPlanReviewRow(review, add, false);
reviewed = E.buildReviewedPlan(plan, review);
assert(reviewed.actions[0].type === 'add', 'restoring ADD must restore the original operation');

E.setPlanReviewRow(review, del, true);
reviewed = E.buildReviewedPlan(plan, review);
assert(reviewed.actions[1].type === 'noop', `excluded DELETE must become NOOP, got ${reviewed.actions[1].type}`);
assert(reviewed.actions[1].originalType === 'delete' && reviewed.actions[1].reviewExcluded === true,
  `excluded DELETE must keep review metadata: ${JSON.stringify(reviewed.actions[1])}`);
assert(reviewed.counts.delete === 0 && reviewed.counts.add === 1 && reviewed.counts.noop === 1,
  `DELETE exclusion counters are wrong: ${JSON.stringify(reviewed.counts)}`);

E.setPlanReviewRow(review, del, false);
reviewed = E.buildReviewedPlan(plan, review);
assert(reviewed.actions[1].type === 'delete', 'restoring DELETE must restore the original operation');

// A previous conflicting edit can be skipped first and thereby restore an unchanged TESSA row.
// If a later ADD is now exactly satisfied by that one current row, the reviewed plan is idempotent:
// attach the exact identity and show a read-only NOOP instead of creating a second SKIP.
// Real new-new duplicates and ambiguous current-state matches are covered separately by
// idempotent-existing-add.mjs and still remain fail-closed.
const originalRow = { index: 0, rowCardId: 'card-original', versionId: 'version-original', flat: { value: ['A'] } };
const goodCurrent = { index: 1, rowCardId: 'card-good', versionId: 'version-good', flat: { value: ['B'] } };
const goodUpdate = {
  type: 'update',
  excelRow: { excelRow: 16, flat: { value: ['C'] }, ids: {}, compare: {}, columns: new Map() },
  currentRow: goodCurrent,
  changes: [{ key: 'value', label: 'Value', before: ['B'], after: ['C'] }],
  match: { matchedBy: 'identity', lowConfidence: false },
};
const cascadingDuplicateAdd = {
  type: 'add',
  excelRow: { excelRow: 38, flat: { value: ['A'] }, ids: {}, compare: {}, columns: new Map() },
  currentRow: null,
  changes: [],
  match: { matchedBy: 'explicit-add', lowConfidence: false },
};
const cascadePlan = {
  id: 'review-cascading-duplicate',
  actions: [goodUpdate, cascadingDuplicateAdd],
  skippedRows: [
    E.makeSkippedRow(15, 'first duplicate group', 'duplicate-validation', 'update'),
    E.makeSkippedRow(37, 'first duplicate group', 'duplicate-validation', 'update'),
  ],
  snapshot: { rows: [originalRow, goodCurrent] },
  structure: { conditions: [], functions: [] },
  counts: E.countActions([goodUpdate, cascadingDuplicateAdd], []),
  safety: { blocked: false, blockedReasons: [] },
};
const cascadeReviewed = E.buildReviewedPlan(cascadePlan, E.createPlanReviewState());
assert(cascadeReviewed.safety?.blocked === false,
  `idempotent cascading ADD must not globally block Apply: ${JSON.stringify(cascadeReviewed.safety)}`);
const cascadeUpdate = cascadeReviewed.actions.find(action => action.type === 'update');
const cascadeNoop = cascadeReviewed.actions.find(action => action.type === 'noop' && action.excelRow?.excelRow === 38);
assert(cascadeReviewed.actions.length === 2 && cascadeUpdate?.excelRow?.excelRow === 16,
  `unrelated good UPDATE must remain executable beside the idempotent NOOP: ${JSON.stringify(cascadeReviewed.actions)}`);
assert(cascadeNoop?.match?.matchedBy === 'existing-identical-add' && cascadeNoop.currentRow?.rowCardId === 'card-original',
  `cascading exact ADD must attach the one matching current identity: ${JSON.stringify(cascadeNoop)}`);
assert(!cascadeReviewed.skippedRows.some(item => item.excelRow === 38),
  `idempotent existing ADD must not create another SKIP: ${JSON.stringify(cascadeReviewed.skippedRows)}`);
assert(cascadeReviewed.counts.update === 1 && cascadeReviewed.counts.add === 0 && cascadeReviewed.counts.noop === 1 && cascadeReviewed.counts.skip === 2,
  `idempotent cascading counters are wrong: ${JSON.stringify(cascadeReviewed.counts)}`);
const cascadeAvailability = E.applyAvailability(cascadePlan, E.createPlanReviewState());
assert(cascadeAvailability.canApply === true && cascadeAvailability.count === 1,
  `unrelated good operation must stay applicable: ${JSON.stringify(cascadeAvailability)}`);

assert(!code.includes("const rowExcluded = action.type === 'update' &&"), 'row exclusion UI must not be UPDATE-only');
assert(!code.includes("if (!sourceAction || sourceAction.type !== 'update') return;"), 'review click handler must not reject ADD/DELETE row exclusion');
assert(code.includes("const supportsWholeActionReview = action.type === 'update' || action.type === 'add' || action.type === 'delete';"),
  'Preview must explicitly support whole-operation review for UPDATE/ADD/DELETE');
assert(code.includes("} else if (action.type === 'add') body.innerHTML = `${rowReviewControl}"),
  'ADD Preview must render the whole-operation review control');
assert(code.includes("else body.innerHTML = `${rowReviewControl}${flatToHtml(action.currentRow.flat, plan.columnMap, action.currentRow)}`;"),
  'DELETE Preview must render the whole-operation review control while passing row metadata for typed role badges');

console.log('TESSA Matrix Studio selective review for ADD/DELETE and idempotent cascading ADD: OK');
