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
  body: { innerText: '' },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ click() {}, style: {}, appendChild() {}, set textContent(_) {} }),
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.previewPreflightPolicy === 'function', 'previewPreflightPolicy is missing');
assert(typeof E.estimateRemainingMs === 'function', 'estimateRemainingMs is missing');
assert(typeof E.formatEtaMs === 'function', 'formatEtaMs is missing');
assert(typeof E.workProgressDetail === 'function', 'workProgressDetail is missing');

const makeActions = count => Array.from({ length: count }, (_, i) => ({
  type: 'add',
  excelRow: { excelRow: 151 + i },
}));

const atLimit = E.previewPreflightPolicy(makeActions(2000));
assert(atLimit.skipServerAddValidation === false,
  `2000 operations are still Apply-capable and must keep deep Preview preflight: ${JSON.stringify(atLimit)}`);
assert(atLimit.applyBlocked === false, `2000 operations must not be marked blocked: ${JSON.stringify(atLimit)}`);

const overLimit = E.previewPreflightPolicy(makeActions(2001));
assert(overLimit.skipServerAddValidation === true,
  `>2000 Preview must skip thousands of pointless ADD CardNew/duplicate server calls: ${JSON.stringify(overLimit)}`);
assert(overLimit.applyBlocked === true, `>2000 operations must be marked Apply-blocked: ${JSON.stringify(overLimit)}`);
assert(/локаль/i.test(overLimit.reason || '') && /apply/i.test(overLimit.reason || ''),
  `fast-path reason must explain local Preview and Apply block: ${JSON.stringify(overLimit)}`);

const eta = E.estimateRemainingMs({ completed: 25, total: 100, elapsedMs: 5000 });
assert(eta === 15000, `ETA math expected 15000 ms, got ${eta}`);
assert(E.estimateRemainingMs({ completed: 0, total: 100, elapsedMs: 5000 }) === null,
  'ETA must be unknown before any work completes');
assert(E.estimateRemainingMs({ completed: 100, total: 100, elapsedMs: 5000 }) === 0,
  'ETA must be zero when work is complete');

assert(E.formatEtaMs(4200) === 'меньше 5 сек', `short ETA format mismatch: ${E.formatEtaMs(4200)}`);
assert(/1 мин 5 сек/.test(E.formatEtaMs(65000)), `minute ETA format mismatch: ${E.formatEtaMs(65000)}`);
assert(/1 ч 2 мин/.test(E.formatEtaMs(3720000)), `hour ETA format mismatch: ${E.formatEtaMs(3720000)}`);

const early = E.workProgressDetail({ completed: 1, total: 2000, elapsedMs: 100 });
assert(/1 из 2.?000/.test(early) && /оцениваю/i.test(early), `early progress must say ETA is being estimated: ${early}`);
const stable = E.workProgressDetail({ completed: 500, total: 2000, elapsedMs: 10000 });
assert(/500 из 2.?000/.test(stable) && /~30 сек осталось/.test(stable), `stable progress must contain ETA: ${stable}`);

// Behavioral contract: once the plan is over the Apply ceiling, Preview may do
// local identity/reference/role validation, but it must not call CardNew or duplicate
// validation thousands of times for a package that cannot be applied as a whole.
let assertCanCreateCalls = 0;
let cardNewCalls = 0;
let duplicateCalls = 0;
const fn = { id: 'fn-required' };
const structure = { templateId: 'tpl', conditions: [], functions: [fn] };
const fresh = {
  matrixId: 'matrix-1',
  rows: [],
  criterionIdCache: new Map(),
  roleIdByFunctionCache: new Map(),
  roleIdCache: new Map(),
};
const bridge = {
  matrixInfo: () => ({ StateName: 'Черновик' }),
  localizeValue: value => value,
  assertCanCreateRows: () => { assertCanCreateCalls += 1; throw new Error('must not probe CardNew capability on blocked Preview'); },
  resolveRole: () => ({ id: 'role-1', roleTypeId: 1 }),
  createRowCard: async () => { cardNewCalls += 1; throw new Error('CardNew must not run on >2000 Preview'); },
  validateDuplicate: async () => { duplicateCalls += 1; throw new Error('duplicate validation must not run on >2000 Preview'); },
};
const fastActions = Array.from({ length: 2001 }, (_, i) => {
  const columns = new Map([[fn.id, { key: 'fn' }]]);
  return {
    type: 'add',
    excelRow: {
      excelRow: 151 + i,
      columns,
      flat: { fn: ['Исполнитель QA'] },
      ids: { fn: ['role-1|1'] },
    },
  };
});
const fastPlan = {
  matrixId: 'matrix-1',
  safety: { blocked: false, blockedReasons: [] },
  actions: fastActions,
  skippedRows: [],
  counts: E.countActions(fastActions, []),
};
const fastPreflight = await E.preflightPlan(fastPlan, {
  previewOnly: true,
  bridge,
  structure,
  fresh,
  onProgress: () => {},
});
assert(fastPreflight.previewPolicy?.skipServerAddValidation === true,
  `behavioral preflight did not select fast policy: ${JSON.stringify(fastPreflight.previewPolicy)}`);
assert(fastPreflight.preparedAdds.size === 2001,
  `local Preview must retain all valid ADDs, got ${fastPreflight.preparedAdds.size}`);
assert(fastPreflight.runtimeSkips.length === 0,
  `valid local ADDs unexpectedly skipped: ${JSON.stringify(fastPreflight.runtimeSkips.slice(0, 3))}`);
assert(assertCanCreateCalls === 0 && cardNewCalls === 0 && duplicateCalls === 0,
  `blocked large Preview made server ADD calls: capability=${assertCanCreateCalls}, CardNew=${cardNewCalls}, duplicate=${duplicateCalls}`);

assert(code.includes('skipServerAddValidation'), 'preflightPlan must consume the fast-preview policy');
assert(code.includes('PreflightAddConcurrency'), 'deep ADD preflight must have a bounded concurrency setting');
assert(code.includes('yieldToMain'), 'large local Preview must yield so progress can repaint');

console.log('TESSA Matrix Studio large Preview performance/ETA contract: OK');
