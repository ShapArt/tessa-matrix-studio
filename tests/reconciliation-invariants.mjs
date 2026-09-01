import fs from 'node:fs';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function section(start, end) {
  const a = code.indexOf(start);
  const b = code.indexOf(end, a + start.length);
  assert(a >= 0 && b >= 0, `invariant section missing: ${start} -> ${end}`);
  return code.slice(a, b);
}

function assertReadOnly(source, label) {
  for (const token of ['storeRowCard(', 'deleteMatrixRow(', 'CardStoreRequest(', '.store(']) {
    assert(!source.includes(token), `${label} contains mutation token ${token}`);
  }
}

const probe = section('  function probeRuntimeEnvironment(', '  function captureExtensionRequire(');
const reconcile = section('  function reconcileMutationReceipts(', '  async function runReconciliationRead(');
const reconcileRead = section('  async function runReconciliationRead(', '  function deletionGuard(');
const reconcileHandler = section("    panel.querySelector('#tms-reconcile').addEventListener", "    panel.querySelector('#tms-refresh-view').addEventListener");
const reconcileRender = section('  function renderReconciliationResult(', '  function updateReconciliationControlState(');
const refreshView = section('  async function refreshNativeMatrixViewAfterApply(', '  function finalizeApplyResult(');

assertReadOnly(probe, 'probeRuntimeEnvironment');
assertReadOnly(reconcile, 'reconcileMutationReceipts');
assertReadOnly(reconcileRead, 'runReconciliationRead');
assertReadOnly(reconcileHandler, 'reconciliation UI handler');

assert(reconcile.includes('indexSnapshotForReconciliation(snapshot)'), 'reconciliation must build snapshot indexes once');
assert(!reconcile.includes('.find('), 'reconciliation must not scan the full snapshot per receipt');
assert(!reconcileHandler.includes('applyPlan('), 'reconciliation UI must not invoke Apply');
assert(!reconcileHandler.includes('APP.plan ='), 'reconciliation UI must not restore consumed plan');
assert(!reconcileRender.includes('APP.plan ='), 'reconciliation renderer must not restore consumed plan');

assert(!code.includes('editor.refreshCard(') && !code.includes('editor?.refreshCard('), 'full-card refresh was reintroduced');
assert(refreshView.includes('refreshNativeMatrixView'), 'native-view-only refresh behavior disappeared');
assert(code.includes('id="tms-refresh-view"'), 'manual native-view refresh control disappeared');

assert(code.includes('APP.lastMutationReceipts'), 'private mutation receipt context disappeared');
assert(!code.includes('rememberReport(APP.lastMutationReceipts'), 'private receipts leaked into downloadable report');
assert(!code.includes('rememberReport({ receipts'), 'private receipts leaked into downloadable report object');
assert(code.includes('expectedSemanticKey'), 'semantic receipt key disappeared');
assert(code.includes('return `ref:${canonicalValue(id)}`'), 'reference semantic token is no longer ID-first');

console.log('TESSA Matrix Studio reconciliation safety invariants: OK');
