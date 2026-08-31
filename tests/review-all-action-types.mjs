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
  currentRow: { index: 8, rowCardId: 'card-delete', versionId: 'version-delete', fingerprint: 'fp-delete', flat: { role: ['Петров П.П.'] } },
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

assert(!code.includes("const rowExcluded = action.type === 'update' &&"), 'row exclusion UI must not be UPDATE-only');
assert(!code.includes("if (!sourceAction || sourceAction.type !== 'update') return;"), 'review click handler must not reject ADD/DELETE row exclusion');
assert(/action\.type === 'add'[\s\S]{0,700}data-review-row|data-review-row[\s\S]{0,700}action\.type === 'add'/.test(code),
  'ADD Preview must expose a whole-operation review control');

console.log('TESSA Matrix Studio selective review for ADD/DELETE: OK');
