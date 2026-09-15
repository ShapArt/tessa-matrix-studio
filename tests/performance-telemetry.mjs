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
assert(typeof E.performanceStage === 'function', 'performanceStage export is missing');
assert(typeof E.performanceSnapshot === 'function', 'performanceSnapshot export is missing');
assert(typeof E.resetPerformanceTelemetry === 'function', 'resetPerformanceTelemetry export is missing');

E.resetPerformanceTelemetry();
const result = await E.performanceStage('unit-stage', async () => {
  await new Promise(resolve => setTimeout(resolve, 8));
  return 42;
}, { rows: 3, operation: 'unit' });
assert(result === 42, 'performanceStage must return wrapped result');

const snapshot = E.performanceSnapshot();
assert(snapshot && snapshot.stages && snapshot.stages['unit-stage'], JSON.stringify(snapshot));
const stage = snapshot.stages['unit-stage'];
assert(stage.count === 1, JSON.stringify(stage));
assert(stage.totalMs >= 0 && stage.lastMs >= 0, JSON.stringify(stage));
assert(stage.lastMeta?.rows === 3 && stage.lastMeta?.operation === 'unit', JSON.stringify(stage));
assert(Array.isArray(snapshot.events) && snapshot.events.length >= 1, JSON.stringify(snapshot));
assert(JSON.stringify(snapshot).length < 100000, 'performance snapshot must stay compact/serializable');

console.log('TESSA Matrix Studio performance telemetry: OK');
