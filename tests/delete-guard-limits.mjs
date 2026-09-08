import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const { deletionGuard } = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof deletionGuard === 'function', 'deletionGuard is missing');

const guard = (deletes, rows) => deletionGuard({ counts: { delete: deletes }, sourceRowCount: rows });

for (const [deletes, rows] of [[99,1000], [100,1000], [10,50], [9,50], [1000,1000]]) {
  const result = guard(deletes, rows);
  assert(result.blocked === false, `valid deletions must not be capped: ${JSON.stringify(result)}`);
  assert(result.deleteCount === deletes && result.ratio === deletes / rows, 'preview counts must remain accurate');
}
console.log('TESSA Matrix Studio DELETE count and ratio do not block reviewed operations: OK');
