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

// Exact live-UAT shape: 11 requested mutations all stored successfully, while
// 12 Excel rows had already been excluded by planner/source validation.
const live = {
  rows: Array.from({ length: 11 }, (_, index) => ({
    type: index < 4 ? 'update' : 'add',
    excelRow: 16 + index,
    status: 'ok',
  })),
  skipped: Array.from({ length: 12 }, (_, index) => ({
    excelRow: 30 + index,
    source: 'excel-validation',
    phase: 'source',
    reason: `source skip ${index + 1}`,
  })),
  sourceSkippedCount: 12,
  preflightSkippedCount: 0,
  requestedCount: 11,
  plannedCount: 11,
  startedCount: 11,
  verificationIncomplete: false,
  refreshError: null,
};

E.finalizeApplyResult(live, { cancelled: false });
assert(live.appliedCount === 11, `appliedCount expected 11, got ${live.appliedCount}`);
assert(live.sourceSkippedCount === 12, `sourceSkippedCount expected 12, got ${live.sourceSkippedCount}`);
assert(live.storeSkippedCount === 0, `storeSkippedCount expected 0, got ${live.storeSkippedCount}`);
assert(live.notStartedCount === 0, `notStartedCount expected 0, got ${live.notStartedCount}`);
assert(live.status === 'completed', `source-only skips must not make Apply partial: ${JSON.stringify(live)}`);
assert(live.partial === false, `source-only skips must keep partial=false: ${JSON.stringify(live)}`);
assert(live.success === true, `11/11 requested successful mutations must be success=true: ${JSON.stringify(live)}`);

const message = E.applyResultMessage(live);
assert(/11\s*(из|\/).*11|применено\s*:?\s*11/i.test(message), `success UX must show 11/11 applied: ${message}`);
assert(/12/.test(message) && /(не вош|пропущ|оставлен)/i.test(message), `success UX must mention 12 source-excluded rows separately: ${message}`);
assert(!/частич/i.test(message), `source-only skips must not be described as partial failure: ${message}`);

console.log('TESSA Matrix Studio source-skipped rows do not poison successful Apply: OK');
