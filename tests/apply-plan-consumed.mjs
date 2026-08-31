import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}) };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.invalidatePlanStateAfterApply === 'function', 'invalidatePlanStateAfterApply is missing');
assert(code.includes('invalidatePlanStateAfterApply(APP, result)'), 'Apply UI does not consume the old plan after a started mutation');

const state = {
  plan: { id: 'old-plan' },
  snapshot: { rows: [1] },
  bridge: { id: 'old-bridge' },
  review: { excludedRows: new Set(['x']), excludedChanges: new Map() },
  previewView: { page: 5, filter: 'add', query: 'old' },
};
const changed = E.invalidatePlanStateAfterApply(state, { startedCount: 1, appliedCount: 1, status: 'completed' });
assert(changed === true, 'a started mutation must consume the plan');
assert(state.plan === null, 'old plan must be cleared');
assert(state.snapshot === null, 'old snapshot must be cleared');
assert(state.bridge === null, 'old bridge must be cleared');
assert(state.review?.excludedRows?.size === 0, 'review state must reset');
assert(state.previewView?.page === 1 && state.previewView?.filter === 'all' && state.previewView?.query === '', 'Preview view state must reset');

const untouched = { plan: { id: 'still-safe' }, snapshot: { rows: [] }, bridge: {} };
const noWrite = E.invalidatePlanStateAfterApply(untouched, { startedCount: 0, appliedCount: 0, status: 'cancelled' });
assert(noWrite === false, 'pre-write cancellation should not consume the plan');
assert(untouched.plan?.id === 'still-safe', 'pre-write cancellation must keep the reviewed plan available');

console.log('TESSA Matrix Studio consumes stale Apply plan after any started mutation: OK');
