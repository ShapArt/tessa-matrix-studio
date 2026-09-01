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
  createElement: () => ({ click() {}, style: {}, set href(_) {}, set download(_) {} }),
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.sanitizeSupportReport === 'function', 'sanitizeSupportReport is missing');

const unsafe = {
  version: '1.9.40',
  matrixId: 'matrix-id',
  templateId: 'template-id',
  capabilities: {
    overall: 'limited',
    blockers: [{ code: 'native-view-refresh-unavailable', scope: 'refreshView', value: 'СЕКРЕТНЫЙ КОНТРАГЕНТ' }],
    warnings: [{ code: 'optional-warning', scope: 'reconcile', display: 'Иванов Иван' }],
  },
  apply: { status: 'completed', requestedCount: 1, appliedCount: 1, failedCount: 0, notStartedCount: 0, rows: ['СЕКРЕТНЫЙ'] },
  reconciliation: {
    status: 'divergent', checkedCount: 1, verifiedCount: 0, divergentCount: 1, missingCount: 0, unknownCount: 0,
    rows: [{ reasonCode: 'reconcile-semantic-divergence', value: 'СЕКРЕТНЫЙ КОНТРАГЕНТ' }],
  },
  receipts: [{ expectedSemanticKey: 'PRIVATE-HASH' }],
  workbook: { rows: ['СЕКРЕТНЫЙ'] },
  snapshot: { rows: ['Иванов Иван'] },
  error: { message: 'Иванов Иван' },
  logs: ['Ромашка'],
};

const safe = E.sanitizeSupportReport(unsafe, { includeIds: false });
const text = JSON.stringify(safe);
for (const forbidden of ['СЕКРЕТНЫЙ', 'Иванов', 'Ромашка', 'PRIVATE-HASH', 'receipts', 'workbook', 'snapshot', 'error']) {
  assert(!text.includes(forbidden), `privacy leak ${forbidden}: ${text}`);
}
assert(!text.includes('matrix-id') && !text.includes('template-id'), `IDs leaked by default: ${text}`);
assert(safe.studioVersion === '1.9.40', JSON.stringify(safe));
assert(safe.capabilities?.overall === 'limited', JSON.stringify(safe));
assert(safe.capabilities?.blockers?.[0]?.code === 'native-view-refresh-unavailable', JSON.stringify(safe));
assert(safe.apply?.appliedCount === 1 && safe.apply?.requestedCount === 1, JSON.stringify(safe));
assert(safe.reconciliation?.reasonCodes?.includes('reconcile-semantic-divergence'), JSON.stringify(safe));

const withIds = E.sanitizeSupportReport(unsafe, { includeIds: true });
assert(withIds.matrixId === 'matrix-id' && withIds.templateId === 'template-id', JSON.stringify(withIds));
assert(!JSON.stringify(withIds).includes('PRIVATE-HASH'), JSON.stringify(withIds));

console.log('TESSA Matrix Studio privacy-safe support report whitelist: OK');
