import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const sourceUrl = new URL('../tessa-matrix-studio.user.js', import.meta.url);
const code = fs.readFileSync(sourceUrl, 'utf8');
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ click() {}, style: {}, set href(_) {}, set download(_) {} }) };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert.equal(typeof E.runPerformanceUat, 'function', 'runPerformanceUat export missing');
assert.equal(typeof E.performanceUatScenarioNames, 'function', 'performanceUatScenarioNames export missing');
assert.equal(typeof E.buildPerformanceUatSummary, 'function', 'buildPerformanceUatSummary export missing');

// Seed a pair of real timing hooks so the summary proves it carries live touched-only data
// separately from synthetic planner timings.
await E.performanceStage('preflight.targeted', async () => 1, { operation: 'test' });
await E.performanceStage('reconcile.targeted', async () => 1, { operation: 'test' });

const expectedNames = [
  '0 changes', '1 ADD', '10 ADD', '100 ADD', '1 UPDATE', '10 UPDATE',
  '1 DELETE', 'mixed 10', '3000 KEEP + 1 ADD', '3000 KEEP + 1 UPDATE',
];
assert.deepEqual(E.performanceUatScenarioNames(), expectedNames);

const started = performance.now();
const result = await E.runPerformanceUat({ baseRows: 3000 });
const elapsed = performance.now() - started;
assert.equal(result.status, 'passed', JSON.stringify(result.failures || []));
assert.deepEqual(result.scenarios.map(item => item.name), expectedNames);
assert.equal(result.baseRows, 3000);
assert.equal(result.scenarios.length, 10);
assert.ok(Number.isFinite(result.totalMs) && result.totalMs >= 0);
assert.ok(elapsed < 20000, `performance UAT took ${elapsed.toFixed(1)}ms`);

const byName = new Map(result.scenarios.map(item => [item.name, item]));
assert.equal(byName.get('0 changes').totalRows, 3000);
assert.equal(byName.get('0 changes').fullyValidatedRows, 0);
assert.equal(byName.get('0 changes').preflightRows, 0);
assert.equal(byName.get('1 ADD').counts.add, 1);
assert.equal(byName.get('10 ADD').counts.add, 10);
assert.equal(byName.get('100 ADD').counts.add, 100);
assert.equal(byName.get('1 UPDATE').counts.update, 1);
assert.equal(byName.get('10 UPDATE').counts.update, 10);
assert.equal(byName.get('1 DELETE').counts.delete, 1);
assert.equal(byName.get('mixed 10').preflightRows, 10);
assert.equal(byName.get('3000 KEEP + 1 ADD').counts.noop, 3000);
assert.equal(byName.get('3000 KEEP + 1 ADD').fullyValidatedRows, 1);
assert.equal(byName.get('3000 KEEP + 1 ADD').baselineFastPathHits, 3000);
assert.equal(byName.get('3000 KEEP + 1 UPDATE').counts.noop, 2999);
assert.equal(byName.get('3000 KEEP + 1 UPDATE').fullyValidatedRows, 1);
assert.ok(result.cache && Number.isFinite(result.cache.hits) && Number.isFinite(result.cache.misses), JSON.stringify(result.cache));
assert.ok(result.liveTimings?.['preflight.targeted']?.count >= 1, JSON.stringify(result.liveTimings));
assert.ok(result.liveTimings?.['reconcile.targeted']?.count >= 1, JSON.stringify(result.liveTimings));

const summary = E.buildPerformanceUatSummary(result);
assert.equal(summary.status, 'passed');
assert.equal(summary.scenarios, 10);
assert.equal(summary.baseRows, 3000);
assert.ok(Array.isArray(summary.rows) && summary.rows.length === 10);
assert.ok(summary.rows.every(row => Number.isFinite(row.plannerMs)));
assert.ok(!/\bStore\b|\bDeleteRow\b|\.store\s*\(/.test(String(E.runPerformanceUat)), 'synthetic performance UAT must not write to TESSA');

// Diagnostics must carry the measured result as a standalone artifact, not just logs.
assert.match(code, /performance-uat\.json/);
assert.match(code, /performanceUat/);
assert.match(code, /Performance UAT/);

console.log(`TESSA Matrix Studio performance UAT: OK (${elapsed.toFixed(1)}ms)`);
