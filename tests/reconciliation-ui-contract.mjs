import fs from 'node:fs';
import vm from 'node:vm';

let code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

// Test-only access to the real APP object. Production must not expose session receipts.
code = code.replace('  const APP = {', '  const APP = globalThis.__TMS_RECONCILE_UI_TEST_APP__ = {');

const reconciliationHost = { textContent: '', dataset: {}, hidden: false };
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = {
  body: { innerText: '' },
  querySelector: selector => selector === '#tms-reconciliation-result' ? reconciliationHost : null,
  querySelectorAll: () => [],
  createElement: () => ({ click() {}, style: {}, set href(_) {}, set download(_) {} }),
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const APP = globalThis.__TMS_RECONCILE_UI_TEST_APP__;

assert(code.includes('id="tms-reconcile"'), 'reconciliation button is missing');
assert(code.includes('Проверить результат'), 'reconciliation button label is missing');
assert(code.includes('id="tms-reconciliation-result"'), 'reconciliation result host is missing');
assert(typeof E.reconciliationSummary === 'function', 'reconciliationSummary is missing');
assert(typeof E.renderReconciliationResult === 'function', 'renderReconciliationResult is missing');
assert(APP && Object.prototype.hasOwnProperty.call(APP, 'lastReconciliation'), 'APP.lastReconciliation is missing');

const verified = E.reconciliationSummary({ status: 'verified', checkedCount: 11, verifiedCount: 11, divergentCount: 0, missingCount: 0, unknownCount: 0 });
assert(/11/.test(verified) && /подтверж/i.test(verified), verified);
const divergent = E.reconciliationSummary({ status: 'divergent', checkedCount: 11, verifiedCount: 10, divergentCount: 1, missingCount: 0, unknownCount: 0 });
assert(/10/.test(divergent) && /1/.test(divergent) && /расхожд/i.test(divergent), divergent);
const incomplete = E.reconciliationSummary({ status: 'incomplete', checkedCount: 11, verifiedCount: 9, divergentCount: 0, missingCount: 0, unknownCount: 2 });
assert(/9/.test(incomplete) && /2/.test(incomplete) && /неполн/i.test(incomplete), incomplete);

// Reconciliation renders a fact about the already-consumed Apply. It must never
// resurrect the stale Preview/plan or create a second Apply path.
APP.plan = null;
APP.lastReconciliation = { status: 'divergent', checkedCount: 1, verifiedCount: 0, divergentCount: 1, missingCount: 0, unknownCount: 0, rows: [] };
E.renderReconciliationResult(APP.lastReconciliation);
assert(APP.plan === null, 'renderReconciliationResult restored a consumed APP.plan');
assert(/расхожд/i.test(reconciliationHost.textContent), `unexpected rendered summary: ${reconciliationHost.textContent}`);

const source = String(E.renderReconciliationResult);
assert(!/APP\.plan\s*=/.test(source), `reconciliation renderer must not assign APP.plan: ${source}`);
assert(!/applyPlan\s*\(/.test(source), `reconciliation renderer must not invoke Apply: ${source}`);

console.log('TESSA Matrix Studio explicit reconciliation UI contract: OK');
