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

assert(code.includes('skipServerAddValidation'), 'preflightPlan must consume the fast-preview policy');
assert(code.includes('PreflightAddConcurrency'), 'deep ADD preflight must have a bounded concurrency setting');
assert(code.includes('yieldToMain'), 'large local Preview must yield so progress can repaint');

console.log('TESSA Matrix Studio large Preview performance/ETA contract: OK');
