import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.suppressPlanForUnsafeContext === 'function', 'suppressPlanForUnsafeContext is missing');

const plan = {
  actions: [
    { type: 'update', excelRow: { excelRow: 18 } },
    { type: 'add', excelRow: { excelRow: 151 } },
  ],
  counts: { update: 1, add: 1, delete: 0, noop: 127, skip: 2130 },
  skippedRows: Array.from({ length: 2130 }, (_, i) => ({ excelRow: i + 15, reason: 'identity noise' })),
};

const result = E.suppressPlanForUnsafeContext(plan);
assert(result === plan, 'helper must mutate/return the same plan object');
assert(result.previewSuppressed === true, 'global blocker must mark previewSuppressed');
assert(result.actions.length === 0, 'global blocker must remove executable actions');
assert(result.skippedRows.length === 0, 'global blocker must hide irrelevant row-level SKIP spam');
assert(result.counts.update === 0 && result.counts.add === 0 && result.counts.delete === 0 && result.counts.skip === 0,
  `visible counts must be zero after global suppression: ${JSON.stringify(result.counts)}`);
assert(result.candidateActions.length === 2, 'candidate actions must remain available for diagnostics');
assert(result.candidateSkippedRows.length === 2130, 'candidate row issues must remain available for diagnostics');
assert(result.candidateCounts.skip === 2130, 'candidate counts must preserve original diagnostics');

console.log('TESSA Matrix Studio global-context suppression UX: OK');
