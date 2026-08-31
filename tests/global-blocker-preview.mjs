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
assert(typeof E.suppressUnsafePlanPreview === 'function', 'suppressUnsafePlanPreview is missing');

// Exact shape of the live failure: the workbook belongs to another matrix, while
// row planning has already accumulated thousands of secondary identity errors.
const plan = {
  actions: Array.from({ length: 2000 }, (_, index) => ({ type: 'add', excelRow: { excelRow: index + 150 } })),
  skippedRows: Array.from({ length: 2130 }, (_, index) => ({
    excelRow: index + 1,
    reason: 'потеряны скрытые MatrixRowID/MatrixVersionID',
  })),
  counts: { update: 3, add: 1996, delete: 1, noop: 127, skip: 2130 },
  safety: {
    blocked: true,
    suppressUnsafePreview: true,
    blockedReasons: ['Excel относится к другой карточке матрицы. Скачайте свежий Excel из открытой матрицы.'],
  },
};

const result = E.suppressUnsafePlanPreview(plan);

assert(result.previewSuppressed === true, 'global blocker must suppress unsafe Preview');
assert(result.actions.length === 0, `actions must be hidden after global blocker: ${result.actions.length}`);
assert(result.skippedRows.length === 0, `row-level SKIP spam must be hidden after global blocker: ${result.skippedRows.length}`);
assert(result.counts.update === 0 && result.counts.add === 0 && result.counts.delete === 0 && result.counts.skip === 0,
  `visible counts must be zero after global blocker: ${JSON.stringify(result.counts)}`);
assert(result.candidateActions.length === 2000, 'candidate actions must remain available for diagnostics');
assert(result.candidateSkippedRows.length === 2130, 'candidate row issues must remain available for diagnostics');
assert(result.candidateCounts.skip === 2130, 'candidate counts must preserve original diagnostics');
assert(result.safety.blockedReasons.length === 1 && /другой карточке/.test(result.safety.blockedReasons[0]),
  'the single authoritative global blocker must be preserved');

console.log('TESSA Matrix Studio global blocker suppresses secondary row spam: OK');
