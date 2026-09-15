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
for (const name of ['sessionContextKey', 'setSessionSnapshot', 'getSessionSnapshot', 'updateSessionRows', 'invalidateSessionCache', 'sessionCacheStats']) {
  assert(typeof E[name] === 'function', `${name} export is missing`);
}

E.invalidateSessionCache('unit-start');
const initial = {
  matrixId: 'MATRIX-A',
  templateId: 'TEMPLATE-A',
  createdAt: new Date().toISOString(),
  rows: [
    { rowCardId: 'CARD-1', versionId: 'VER-1', fingerprint: 'FP-1', flat: { a: ['1'] } },
    { rowCardId: 'CARD-2', versionId: 'VER-2', fingerprint: 'FP-2', flat: { a: ['2'] } },
  ],
};
E.setSessionSnapshot(initial, { templateId: 'TEMPLATE-A' });
const same = E.getSessionSnapshot('matrix-a', 'template-a');
assert(same?.rows?.length === 2, JSON.stringify(same));
assert(E.getSessionSnapshot('matrix-b', 'template-a') === null, 'cache must be scoped by matrix');
assert(E.getSessionSnapshot('matrix-a', 'template-b') === null, 'cache must be scoped by template');

E.updateSessionRows({
  matrixId: 'MATRIX-A',
  templateId: 'TEMPLATE-A',
  upsertRows: [
    { rowCardId: 'CARD-1', versionId: 'VER-1', fingerprint: 'FP-1B', flat: { a: ['changed'] } },
    { rowCardId: 'CARD-3', versionId: 'VER-3', fingerprint: 'FP-3', flat: { a: ['3'] } },
  ],
  deleteRowIds: ['CARD-2'],
});
const updated = E.getSessionSnapshot('matrix-a', 'template-a');
assert(updated.rows.length === 2, JSON.stringify(updated.rows));
assert(updated.rows.some(row => row.rowCardId === 'CARD-1' && row.fingerprint === 'FP-1B'), JSON.stringify(updated.rows));
assert(updated.rows.some(row => row.rowCardId === 'CARD-3'), JSON.stringify(updated.rows));
assert(!updated.rows.some(row => row.rowCardId === 'CARD-2'), JSON.stringify(updated.rows));

const stats = E.sessionCacheStats();
assert(stats.hits >= 2, JSON.stringify(stats));
assert(stats.misses >= 2, JSON.stringify(stats));
assert(stats.generation >= 1, JSON.stringify(stats));

E.invalidateSessionCache('unit-end');
assert(E.getSessionSnapshot('matrix-a', 'template-a') === null, 'invalidate must clear session snapshot');

console.log('TESSA Matrix Studio session matrix cache: OK');
