from pathlib import Path

code = Path('tessa-matrix-studio.user.js').read_text(encoding='utf-8')


def section(start, end):
    a = code.find(start)
    b = code.find(end, a + len(start))
    if a < 0 or b < 0:
        raise SystemExit(f'Invariant section missing: {start} -> {end}')
    return code[a:b]


def forbid(source, tokens, label):
    for token in tokens:
        if token in source:
            raise SystemExit(f'{label}: forbidden token {token!r}')

probe = section('  function probeRuntimeEnvironment(', '  function captureExtensionRequire(')
reconcile = section('  function reconcileMutationReceipts(', '  async function runReconciliationRead(')
reconcile_read = section('  async function runReconciliationRead(', '  function deletionGuard(')
reconcile_handler = section("    panel.querySelector('#tms-reconcile').addEventListener", "    panel.querySelector('#tms-refresh-view').addEventListener")
reconcile_render = section('  function renderReconciliationResult(', '  function updateReconciliationControlState(')
refresh_view = section('  async function refreshNativeMatrixViewAfterApply(', '  function finalizeApplyResult(')

mutation_tokens = ['storeRowCard(', 'deleteMatrixRow(', 'CardStoreRequest(', '.store(']
for source, label in [
    (probe, 'probeRuntimeEnvironment'),
    (reconcile, 'reconcileMutationReceipts'),
    (reconcile_read, 'runReconciliationRead'),
    (reconcile_handler, 'reconciliation UI handler'),
]:
    forbid(source, mutation_tokens, label)

if 'indexSnapshotForReconciliation(snapshot)' not in reconcile:
    raise SystemExit('reconcileMutationReceipts no longer indexes snapshot once')
if '.find(' in reconcile:
    raise SystemExit('reconcileMutationReceipts contains per-receipt .find() scan')
if 'applyPlan(' in reconcile_handler:
    raise SystemExit('reconciliation UI handler invokes Apply')
if 'APP.plan =' in reconcile_handler or 'APP.plan =' in reconcile_render:
    raise SystemExit('reconciliation path restores or mutates consumed APP.plan')
if 'editor.refreshCard(' in code or 'editor?.refreshCard(' in code:
    raise SystemExit('full editor.refreshCard() reintroduced')
if 'refreshNativeMatrixViewAfterApply' not in code or '#tms-refresh-view' not in code:
    raise SystemExit('v1.9.39 native-view refresh/manual refresh behavior disappeared')
if 'APP.lastMutationReceipts' not in code:
    raise SystemExit('private receipt context disappeared')
if 'rememberReport(APP.lastMutationReceipts' in code or 'rememberReport({ receipts' in code:
    raise SystemExit('private receipts are being passed to downloadable report')
if 'expectedSemanticKey' not in code:
    raise SystemExit('semantic receipt key disappeared')
if "return `ref:${canonicalValue(id)}`" not in code:
    raise SystemExit('ID-first reference semantic token disappeared')
if 'semantic nearest-match' in reconcile.lower():
    raise SystemExit('unexpected nearest-match logic marker in reconciliation engine')

# v1.9.39 refresh is allowed to retry only refresh; reconciliation is a separate fresh-read path.
if 'refreshNativeMatrixView' not in refresh_view:
    raise SystemExit('native-view refresh helper no longer calls local view refresh')

print('TESSA Matrix Studio v1.9.40 manual invariant diff review: OK')
