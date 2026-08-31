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
assert(typeof E.applyAvailability === 'function', 'applyAvailability is missing');

const makeActions = count => Array.from({ length: count }, (_, index) => ({
  type: 'add',
  excelRow: { excelRow: index + 151, flat: { [`k${index}`]: ['v'] } },
  currentRow: null,
  changes: [],
}));

// Live MAX UAT produced exactly this shape: 8505 executable operations plus 4 SKIP.
// The Preview must expose that as an expected policy block, not as a clickable Apply error.
const plan = {
  id: 'preview-batch-ux',
  actions: makeActions(8505),
  counts: { update: 0, add: 8505, delete: 0, noop: 0, skip: 4 },
  skippedRows: Array.from({ length: 4 }, (_, i) => ({ excelRow: 21 + i, reason: 'fixture skip' })),
  safety: { blocked: false, blockedReasons: [] },
};

const blocked = E.applyAvailability(plan, E.createPlanReviewState());
assert(blocked.count === 8505, `wrong executable count: ${JSON.stringify(blocked)}`);
assert(blocked.blocked === true && blocked.batchBlocked === true, `8505 must be blocked in Preview: ${JSON.stringify(blocked)}`);
assert(/8505/.test(blocked.label || '') && /2000/.test(blocked.label || ''), `blocked label must show current/max count: ${JSON.stringify(blocked)}`);
assert(/раздел|2000|пакет/i.test(blocked.reason || ''), `blocked reason must explain how to proceed: ${JSON.stringify(blocked)}`);
assert(blocked.canApply === false, `blocked Preview must not expose Apply as enabled: ${JSON.stringify(blocked)}`);

const allowed = E.applyAvailability({ ...plan, actions: makeActions(2000) }, E.createPlanReviewState());
assert(allowed.count === 2000 && allowed.blocked === false && allowed.canApply === true,
  `2000 actions must remain applyable: ${JSON.stringify(allowed)}`);

const empty = E.applyAvailability({ ...plan, actions: [] }, E.createPlanReviewState());
assert(empty.count === 0 && empty.canApply === false, `empty plan must not enable Apply: ${JSON.stringify(empty)}`);

console.log('TESSA Matrix Studio blocked-batch Preview UX: OK');
