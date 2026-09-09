import fs from 'node:fs';
import vm from 'node:vm';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/write-check-delete-divergence.json', import.meta.url), 'utf8'));
const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.applyResultSummary === 'function', 'applyResultSummary export is required');

const result = {
  status: fixture.apply.status,
  success: false,
  partial: true,
  verificationIncomplete: true,
  requestedCount: fixture.apply.requestedCount,
  appliedCount: fixture.apply.appliedCount,
  acceptedCount: fixture.apply.acceptedCount,
  verifiedCount: fixture.apply.verifiedCount,
  failedCount: fixture.apply.failedCount,
  notStartedCount: fixture.apply.notStartedCount,
  sourceSkippedCount: 0,
  skippedFields: [],
  matrixSaveIncomplete: true,
  matrixSave: fixture.matrixSave,
  viewRefresh: fixture.viewRefresh,
  reconciliation: fixture.reconciliation,
};

const summary = E.applyResultSummary(result);
assert(summary && typeof summary.title === 'string', 'summary title is required');
assert(!/Запись подтверждена для 4 из 4/i.test(summary.title),
  `server-accepted writes must not be labelled as fully verified: ${summary.title}`);
assert(/4 из 4/.test(summary.title), `summary must retain accepted count: ${summary.title}`);
assert(/2/.test(summary.title), `summary must expose verified count: ${summary.title}`);
assert(/расхожд/i.test(summary.title), `summary must expose divergence state: ${summary.title}`);

console.log('Live UAT write-check semantics: accepted writes are distinct from verified readback: OK');
