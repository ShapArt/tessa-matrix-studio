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

let result = guard(99, 1000);
assert(result.blocked === false, `99/1000 must remain allowed, got ${JSON.stringify(result)}`);

result = guard(100, 1000);
assert(result.blocked === true, `100/1000 must be hard-blocked, got ${JSON.stringify(result)}`);
assert(result.rule === 'absolute', `100/1000 must report absolute rule, got ${JSON.stringify(result)}`);
assert(/100|пакет|удален/i.test(result.reason || ''), `absolute block needs readable reason: ${JSON.stringify(result)}`);

result = guard(10, 50);
assert(result.blocked === true, `10/50 must stay blocked by ratio rule, got ${JSON.stringify(result)}`);
assert(result.rule === 'ratio', `10/50 must report ratio rule, got ${JSON.stringify(result)}`);

result = guard(9, 50);
assert(result.blocked === false, `9/50 must remain allowed, got ${JSON.stringify(result)}`);
assert(result.rule === null || result.rule === undefined, `allowed result must not report destructive rule: ${JSON.stringify(result)}`);

console.log('TESSA Matrix Studio destructive DELETE guard limits: OK');
