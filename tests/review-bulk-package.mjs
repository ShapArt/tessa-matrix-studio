import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = {
  body: { innerText: 'Завершить редактирование и разблокировать' },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ click() {}, style: {}, set href(_) {}, set download(_) {} }),
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.keepReviewedPackage === 'function', 'keepReviewedPackage is missing');
assert(typeof E.createPlanReviewState === 'function', 'createPlanReviewState is missing');
assert(typeof E.buildReviewedPlan === 'function', 'buildReviewedPlan is missing');
assert(code.includes('data-review-package="keep"'), 'bulk keep control is missing from Preview UI');
assert(code.includes('data-review-package="reset"'), 'bulk reset control is missing from Preview UI');
assert(code.includes('Выбрать часть изменений'), 'bulk package action label is missing');

const action = (type, row) => ({
  type,
  excelRow: {
    excelRow: row,
    flat: { ScenarioID: [`${type.toUpperCase()}-${row}`] },
    ids: {},
    compare: {},
    columns: [],
  },
  changes: type === 'update' ? [{ key: 'Field', before: ['A'], after: ['B'] }] : [],
});

const plan = {
  actions: [
    action('update', 10), action('update', 11),
    action('add', 20), action('add', 21), action('add', 22), action('add', 23), action('add', 24),
    action('delete', 30),
  ],
  skippedRows: [],
};

const addOnly = E.keepReviewedPackage(plan, E.createPlanReviewState(), { filter: 'add', limit: 2 });
const keepAddKeys = [...addOnly.excludedRows];
assert(addOnly.excludedRows.has(E.planReviewActionKey(plan.actions[0])), 'non-ADD update must be excluded');
assert(!addOnly.excludedRows.has(E.planReviewActionKey(plan.actions[2])), 'first ADD must stay enabled');
assert(!addOnly.excludedRows.has(E.planReviewActionKey(plan.actions[3])), 'second ADD must stay enabled');
assert(addOnly.excludedRows.has(E.planReviewActionKey(plan.actions[4])), 'third ADD must be excluded');
assert(keepAddKeys.length === 6, `expected 6 excluded actions, got ${keepAddKeys.length}`);

const firstThree = E.keepReviewedPackage(plan, E.createPlanReviewState(), { filter: 'all', limit: 3 });
assert(!firstThree.excludedRows.has(E.planReviewActionKey(plan.actions[0])), 'first operation must stay enabled');
assert(!firstThree.excludedRows.has(E.planReviewActionKey(plan.actions[1])), 'second operation must stay enabled');
assert(!firstThree.excludedRows.has(E.planReviewActionKey(plan.actions[2])), 'third operation must stay enabled');
assert(firstThree.excludedRows.has(E.planReviewActionKey(plan.actions[3])), 'fourth operation must be excluded');

// Package selection is rendered inside the same toolbar as Preview search. The action set
// must therefore match what the user can currently see, not merely the type filter.
const searched = E.keepReviewedPackage(plan, E.createPlanReviewState(), { filter: 'add', query: 'ADD-23', limit: 1 });
assert(!searched.excludedRows.has(E.planReviewActionKey(plan.actions[5])), 'the searched ADD-23 row must stay enabled');
for (const [index, candidate] of plan.actions.entries()) {
  if (index === 5) continue;
  assert(searched.excludedRows.has(E.planReviewActionKey(candidate)), `non-matching action ${index} must be excluded by search-scoped package selection`);
}
assert(code.includes('query: APP.previewView.query'), 'Preview package UI must pass the active search query to package selection');

const zero = E.keepReviewedPackage(plan, E.createPlanReviewState(), { filter: 'add', limit: 0 });
assert(zero.excludedRows.size === plan.actions.length, `limit 0 must exclude all ${plan.actions.length} actions`);

const hugePlan = { actions: Array.from({ length: 2105 }, (_, i) => action('add', 1000 + i)), skippedRows: [] };
const capped = E.keepReviewedPackage(hugePlan, E.createPlanReviewState(), { filter: 'add', limit: 9999 });
assert(capped.excludedRows.size === 105, `bulk package must clamp to 2000 and exclude 105, got ${capped.excludedRows.size}`);

let threw = false;
try { E.keepReviewedPackage(plan, E.createPlanReviewState(), { filter: 'skip', limit: 1 }); }
catch { threw = true; }
assert(threw, 'skip filter must not be accepted as an executable package source');

console.log('TESSA Matrix Studio bulk reviewed-package selection: OK');
