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
assert(typeof E.finalizeApplyResult === 'function', 'finalizeApplyResult is missing');
assert(typeof E.applyResultMessage === 'function', 'applyResultMessage is missing');

const result = {
  rows: [
    { type: 'update', status: 'ok' },
    { type: 'add', status: 'ok' },
    { type: 'update', status: 'skipped' },
  ],
  skipped: [
    { phase: 'source', reason: 'invalid dictionary' },
    { phase: 'preflight', reason: 'stale row' },
    { phase: 'store-update', reason: 'version race' },
  ],
  sourceSkippedCount: 1,
  preflightSkippedCount: 1,
  requestedCount: 5,
  plannedCount: 4,
  startedCount: 3,
};

E.finalizeApplyResult(result, { cancelled: true });
assert(result.appliedCount === 2, `appliedCount expected 2, got ${result.appliedCount}`);
assert(result.storeSkippedCount === 1, `storeSkippedCount expected 1, got ${result.storeSkippedCount}`);
assert(result.failedCount === 1, `failedCount expected 1, got ${result.failedCount}`);
assert(result.notStartedCount === 1, `notStartedCount expected 1, got ${result.notStartedCount}`);
assert(result.skippedCount === 3, `skippedCount expected 3, got ${result.skippedCount}`);
assert(result.requestedCount === result.plannedCount + result.preflightSkippedCount,
  `requested/preflight accounting mismatch: ${JSON.stringify(result)}`);
assert(result.plannedCount === result.appliedCount + result.storeSkippedCount + result.notStartedCount,
  `prepared/store accounting mismatch: ${JSON.stringify(result)}`);
assert(result.status === 'cancelled' && result.cancelled === true && result.partial === true && result.success === false,
  `cancelled status mismatch: ${JSON.stringify(result)}`);

const message = E.applyResultMessage(result);
assert(/останов/i.test(message), `cancelled UX must say operation was stopped: ${message}`);
assert(/применено\s*:\s*2/i.test(message), `cancelled UX must show applied count: ${message}`);
assert(/не начато\s*:\s*1/i.test(message), `cancelled UX must show not-started count: ${message}`);
assert(/свеж/i.test(message), `cancelled UX must tell user to use a fresh export: ${message}`);
assert(!/ошибочные строки не применялись/i.test(message), `cancelled UX must not masquerade as ordinary partial failure: ${message}`);

// A non-cancelled batch with any store-time skip is still partial and must NOT
// expose success=true to machine consumers of the JSON report.
const partial = {
  rows: [
    { type: 'update', status: 'ok' },
    { type: 'update', status: 'skipped' },
  ],
  skipped: [{ phase: 'store-update', reason: 'version race' }],
  sourceSkippedCount: 0,
  preflightSkippedCount: 0,
  requestedCount: 2,
  plannedCount: 2,
  startedCount: 2,
};
E.finalizeApplyResult(partial, { cancelled: false });
assert(partial.status === 'partial' && partial.partial === true,
  `store-time skip must be partial: ${JSON.stringify(partial)}`);
assert(partial.success === false,
  `partial Apply must not claim success=true: ${JSON.stringify(partial)}`);

const completed = {
  rows: [
    { type: 'update', status: 'ok' },
    { type: 'add', status: 'ok' },
  ],
  skipped: [],
  sourceSkippedCount: 0,
  preflightSkippedCount: 0,
  requestedCount: 2,
  plannedCount: 2,
  startedCount: 2,
};
E.finalizeApplyResult(completed, { cancelled: false });
assert(completed.status === 'completed' && completed.partial === false && completed.success === true,
  `only a fully completed Apply may claim success=true: ${JSON.stringify(completed)}`);

console.log('TESSA Matrix Studio Apply result accounting/UX regression: OK');
