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
assert(code.includes('Оставить в Apply'), 'bulk package action label is missing');

const action = (type, row) => ({
  type,
  excelRow: { excelRow: row, flat: { ScenarioID: `${type.toUpperCase()}-${row}` } },
  changes: type === 'update' ? [{ key: 'Field', before: 'A', after: 'B' }] : [],
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
const addOnlyPlan = E.buildReviewedPlan(plan, addOnly);
const addTypes = addOnlyPlan.actions.filter(a => a.type !== 'noop').map(a => `${a.type}:${a.excelRow.excelRow}`);
assert(JSON.stringify(addTypes) === JSON.stringify(['add:20', 'add:21']), `add package mismatch: ${JSON.stringify(addTypes)}`);

const firstThree = E.keepReviewedPackage(plan, E.createPlanReviewState(), { filter: 'all', limit: 3 });
const firstThreePlan = E.buildReviewedPlan(plan, firstThree);
const firstTypes = firstThreePlan.actions.filter(a => a.type !== 'noop').map(a => `${a.type}:${a.excelRow.excelRow}`);
assert(JSON.stringify(firstTypes) === JSON.stringify(['update:10', 'update:11', 'add:20']), `all package mismatch: ${JSON.stringify(firstTypes)}`);

const zero = E.keepReviewedPackage(plan, E.createPlanReviewState(), { filter: 'add', limit: 0 });
assert(E.buildReviewedPlan(plan, zero).actions.every(a => a.type === 'noop'), 'limit 0 must exclude every executable action');

let threw = false;
try { E.keepReviewedPackage(plan, E.createPlanReviewState(), { filter: 'skip', limit: 1 }); }
catch { threw = true; }
assert(threw, 'skip filter must not be accepted as an executable package source');

console.log('TESSA Matrix Studio bulk reviewed-package selection: OK');
