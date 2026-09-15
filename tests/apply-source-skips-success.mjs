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

// Recovery invariant: successful Store for the executable subset is not a green
// overall result while user edits were silently excluded by source validation.
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
assert(live.status === 'attention', `source-skipped user edits must require attention: ${JSON.stringify(live)}`);
assert(live.partial === true, `attention result must keep partial=true: ${JSON.stringify(live)}`);
assert(live.success === false, `green success is forbidden while source-skipped user edits remain: ${JSON.stringify(live)}`);

const message = E.applyResultMessage(live);
assert(/11\s*(из|\/).*11|применено\s*:?\s*11/i.test(message), `attention UX must still show 11/11 executable mutations applied: ${message}`);
assert(/12/.test(message) && /(не вош|пропущ|оставлен|вниман)/i.test(message), `attention UX must mention 12 excluded rows: ${message}`);
assert(/вниман|проверь|исправ|пропущ/i.test(message), `attention UX must tell the user the run is not fully green: ${message}`);

console.log('TESSA Matrix Studio source-skipped user edits require attention: OK');
