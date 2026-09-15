from pathlib import Path

PATH = Path('tessa-matrix-studio.user.js')
source = PATH.read_text(encoding='utf-8')

if 'function createCleanupLedger(' in source:
    print('Task9 production patch already present; nothing to do.')
    raise SystemExit(0)


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one anchor, found {count}')
    source = source.replace(old, new, 1)


helpers = r'''

  // TASK9_SELF_RESTORING_UAT_V1
  // A destructive UAT write is not considered safe merely because its local test
  // finished. Every write leaves a durable cleanup obligation which is settled only
  // after a fresh server read proves the temporary state is gone/restored.
  function createCleanupLedger(baselineSignature = []) {
    const frozenBaseline = [...(baselineSignature || [])];
    const obligations = [];
    let sequence = 0;
    const safeCopy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const snapshot = () => {
      const rows = obligations.map(item => safeCopy(item));
      const verifiedStatuses = new Set(['verified', 'already-absent']);
      const failedStatuses = new Set(['failed', 'error']);
      return {
        baselineSignature: [...frozenBaseline],
        total: rows.length,
        pending: rows.filter(item => item.status === 'pending').length,
        verified: rows.filter(item => verifiedStatuses.has(item.status)).length,
        failed: rows.filter(item => failedStatuses.has(item.status)).length,
        obligations: rows,
      };
    };
    return {
      baselineSignature: [...frozenBaseline],
      register(input = {}) {
        sequence += 1;
        const item = {
          id: `cleanup-${String(sequence).padStart(4, '0')}`,
          status: 'pending',
          registeredAt: now(),
          ...safeCopy(input),
        };
        if (!item.status) item.status = 'pending';
        obligations.push(item);
        return safeCopy(item);
      },
      resolve(id, result = {}) {
        const item = obligations.find(candidate => candidate.id === id);
        if (!item) throw new Error(`Cleanup obligation ${id} не найдена.`);
        Object.assign(item, safeCopy(result));
        if (!item.status) item.status = 'verified';
        return safeCopy(item);
      },
      snapshot,
    };
  }

  function baselineRestoreProof(baselineSignature = [], afterSignature = [], ledgerSnapshot = {}) {
    const baseline = [...(baselineSignature || [])];
    const after = [...(afterSignature || [])];
    const baselineEquivalent = sameArray(baseline, after);
    const pendingObligations = Number(ledgerSnapshot?.pending || 0);
    const failedObligations = Number(ledgerSnapshot?.failed || 0);
    return {
      status: baselineEquivalent && pendingObligations === 0 && failedObligations === 0 ? 'VERIFIED' : 'UNSAFE',
      baselineEquivalent,
      pendingObligations,
      failedObligations,
      baselineSignature: baseline,
      afterSignature: after,
      checkedAt: now(),
    };
  }
'''
replace_once(
    "  function sameArray(a, b) {\n    return a.length === b.length && a.every((value, index) => value === b[index]);\n  }\n",
    "  function sameArray(a, b) {\n    return a.length === b.length && a.every((value, index) => value === b[index]);\n  }" + helpers + "\n",
    'Task9 pure helpers',
)

replace_once(
    "      status: 'INCOMPLETE', matrix: null, checks: [], timeline: [], cleanup: [], dictionaryAudit: null, functionalActionAudit: null,\n      rolePresentationAudit: null, recordKeepingAudit: null, fieldMutationAudit: null, liveConfirmation: options.liveConfirmation === 'full-uat-confirmed' ? 'full-uat-confirmed' : null, writesAttempted: 0, writesCompleted: 0,\n",
    "      status: 'INCOMPLETE', matrix: null, checks: [], timeline: [], cleanup: [], cleanupLedger: null, restoreProof: null, dictionaryAudit: null, functionalActionAudit: null,\n      rolePresentationAudit: null, recordKeepingAudit: null, fieldMutationAudit: null, liveConfirmation: options.liveConfirmation === 'full-uat-confirmed' ? 'full-uat-confirmed' : null, writesAttempted: 0, writesCompleted: 0,\n",
    'report cleanup fields',
)

replace_once(
    "    let baseline = null, structure = null, catalog = null, bridge = null, baselineSignature = null;\n    let cleanupUnsafe = false;\n",
    "    let baseline = null, structure = null, catalog = null, bridge = null, baselineSignature = null;\n    let cleanupLedgerController = null;\n    let cleanupUnsafe = false;\n",
    'ledger controller declaration',
)

ledger_runtime = r'''
    const registerCleanupObligation = input => {
      if (!cleanupLedgerController) throw new Error('Cleanup ledger ещё не инициализирован baseline-сигнатурой.');
      const item = cleanupLedgerController.register(input);
      report.cleanupLedger = cleanupLedgerController.snapshot();
      timeline('cleanup-register', `${item.kind || 'unknown'} ${item.id}`, { scenarioId: item.scenarioId || null, rowCardId: item.rowCardId || null, token: item.token || null });
      return item;
    };
    const resolveCleanupObligation = (id, result = {}) => {
      if (!cleanupLedgerController || !id) return null;
      const item = cleanupLedgerController.resolve(id, result);
      report.cleanupLedger = cleanupLedgerController.snapshot();
      timeline('cleanup-resolve', `${item.id}: ${item.status}`, { scenarioId: item.scenarioId || null, rowCardId: item.rowCardId || null, token: item.token || null });
      return item;
    };
    const pendingCleanupForRow = rowCardId => cleanupLedgerController
      ? cleanupLedgerController.snapshot().obligations.filter(item => item.status === 'pending' && canon(item.rowCardId) === canon(rowCardId))
      : [];
    const resolveCleanupForAbsentRow = (rowCardId, status = 'already-absent', extra = {}) => {
      for (const obligation of pendingCleanupForRow(rowCardId)) {
        resolveCleanupObligation(obligation.id, { status, resolvedAt: now(), ...extra });
      }
    };
    const registerFieldMutationObligations = (plan, scenarioId, rowCardId) => {
      const executable = (plan?.actions || []).filter(action => action.type === 'update' && canon(action.currentRow?.rowCardId) === canon(rowCardId));
      const ids = [];
      for (const action of executable) {
        for (const change of action.changes || []) {
          const obligation = registerCleanupObligation({
            kind: 'field-mutation',
            scenarioId,
            rowCardId,
            token: String(change.key || ''),
            before: E.safePlain(change.before || [], { maxDepth: 4, maxKeys: 50, maxArray: 50 }),
            candidate: E.safePlain(change.after || [], { maxDepth: 4, maxKeys: 50, maxArray: 50 }),
            restoreStrategy: 'restore-or-delete-temporary-row',
            createdAt: now(),
          });
          ids.push(obligation.id);
        }
      }
      return ids;
    };
'''
replace_once(
    "    const runCheck = async (id, title, fn, required = true) => {\n",
    ledger_runtime + "    const runCheck = async (id, title, fn, required = true) => {\n",
    'runtime cleanup helpers',
)

# Settle row + field obligations only after a fresh read proves the temporary row is absent.
replace_once(
    "        if (!target) { report.cleanup.push({ scenarioId, rowCardId, status: 'already-absent', at: now() }); return true; }\n",
    "        if (!target) { report.cleanup.push({ scenarioId, rowCardId, status: 'already-absent', at: now() }); resolveCleanupForAbsentRow(rowCardId, 'already-absent', { resolvedBy: scenarioId }); return true; }\n",
    'cleanup already absent settlement',
)
replace_once(
    "        report.cleanup.push({ scenarioId, rowCardId, status: 'verified', at: now(), result: E.safePlain(result, { maxDepth: 5, maxKeys: 200, maxArray: 100 }) });\n        return true;\n",
    "        report.cleanup.push({ scenarioId, rowCardId, status: 'verified', at: now(), result: E.safePlain(result, { maxDepth: 5, maxKeys: 200, maxArray: 100 }) });\n        resolveCleanupForAbsentRow(rowCardId, 'verified', { resolvedBy: scenarioId });\n        return true;\n",
    'cleanup verified settlement',
)

# Register the temporary row obligation BEFORE the ADD.  Until read-back gives us the
# server CardID it deliberately remains pending; an ambiguous write can therefore never
# be silently called safe.
old_temp = """      const candidate = findUniqueAddCandidate(book, structure, current.snapshot, bridge, currentCatalog, rng, { gap: 3 });
      let plan = applySafety(candidate.plan, bridge); const beforeIds = new Set(current.snapshot.rows.map(row => canon(row.rowCardId)));
      const result = await applySingle(plan, `${scenarioId}: ADD`); const after = await freshSnapshot();
      const created = after.snapshot.rows.filter(row => !beforeIds.has(canon(row.rowCardId)));
      if (created.length !== 1) throw new Error(`После ADD ожидалась 1 новая строка, найдено ${created.length}.`);
      return { created: created[0], after: after.snapshot, bridge: after.bridge, catalog: currentCatalog, candidate, result };
"""
new_temp = """      const candidate = findUniqueAddCandidate(book, structure, current.snapshot, bridge, currentCatalog, rng, { gap: 3 });
      let plan = applySafety(candidate.plan, bridge); const beforeIds = new Set(current.snapshot.rows.map(row => canon(row.rowCardId)));
      const rowObligation = registerCleanupObligation({
        kind: 'temporary-row',
        scenarioId,
        rowCardId: null,
        beforeRowIds: [...beforeIds],
        excelRow: candidate.row?.excelRow || null,
        restoreStrategy: 'delete-temporary-row',
        createdAt: now(),
      });
      let result;
      try {
        result = await applySingle(plan, `${scenarioId}: ADD`);
      } catch (error) {
        try {
          const verification = await freshSnapshot();
          const extras = verification.snapshot.rows.filter(row => !beforeIds.has(canon(row.rowCardId)));
          if (extras.length === 0) resolveCleanupObligation(rowObligation.id, { status: 'already-absent', resolvedAt: now(), resolvedBy: 'add-failed-fresh-read' });
          else if (extras.length === 1) resolveCleanupObligation(rowObligation.id, { status: 'pending', rowCardId: extras[0].rowCardId, discoveredAfterApplyError: true });
        } catch (_) { /* leave pending: global proof must become UNSAFE rather than guess */ }
        throw error;
      }
      const after = await freshSnapshot();
      const created = after.snapshot.rows.filter(row => !beforeIds.has(canon(row.rowCardId)));
      if (created.length !== 1) {
        resolveCleanupObligation(rowObligation.id, { status: 'pending', discoveredRowIds: created.map(row => row.rowCardId) });
        throw new Error(`После ADD ожидалась 1 новая строка, найдено ${created.length}.`);
      }
      resolveCleanupObligation(rowObligation.id, { status: 'pending', rowCardId: created[0].rowCardId, identifiedAt: now() });
      return { created: created[0], after: after.snapshot, bridge: after.bridge, catalog: currentCatalog, candidate, result, cleanupObligationId: rowObligation.id };
"""
replace_once(old_temp, new_temp, 'temporary row obligation')

# Track all explicit field writes. These scenarios mutate only the UAT temporary row;
# if local field restore fails, deleting that row still restores the real baseline.
replace_once(
    "          if (!updatePlan) throw new Error('Не удалось подобрать безопасное UPDATE временной строки.'); await applySingle(updatePlan, 'write-update-delete: UPDATE');",
    "          if (!updatePlan) throw new Error('Не удалось подобрать безопасное UPDATE временной строки.'); registerFieldMutationObligations(updatePlan, 'write-update-delete', rowCardId); await applySingle(updatePlan, 'write-update-delete: UPDATE');",
    'update-delete field obligation',
)

replace_once(
    "            let mutationApplied = false;\n            let original = null;\n",
    "            let mutationApplied = false;\n            let mutationObligationIds = [];\n            let original = null;\n",
    'every-field obligation ids',
)
replace_once(
    "              evidence.candidate = candidateEvidenceValue(selected.candidate);\n              await applySingle(selected.plan, `write-every-field ${liveItem.token}: UPDATE`);\n",
    "              evidence.candidate = candidateEvidenceValue(selected.candidate);\n              mutationObligationIds = registerFieldMutationObligations(selected.plan, `write-every-field:${liveItem.token}`, rowCardId);\n              await applySingle(selected.plan, `write-every-field ${liveItem.token}: UPDATE`);\n",
    'every-field register mutation',
)
replace_once(
    "                  evidence.restoreResult = 'verified';\n",
    "                  evidence.restoreResult = 'verified';\n                  for (const obligationId of mutationObligationIds) resolveCleanupObligation(obligationId, { status: 'verified', resolvedAt: now(), resolvedBy: 'field-readback-restore' });\n",
    'every-field resolve mutation',
)
replace_once(
    "          if (!clearPlan) return { status: 'NOT_RUN', detail: 'Не найдено доказанно необязательное заполненное поле временной строки.' }; await applySingle(clearPlan, 'write-clear-delete: CLEAR');",
    "          if (!clearPlan) return { status: 'NOT_RUN', detail: 'Не найдено доказанно необязательное заполненное поле временной строки.' }; registerFieldMutationObligations(clearPlan, 'write-clear-delete', rowCardId); await applySingle(clearPlan, 'write-clear-delete: CLEAR');",
    'clear-delete field obligation',
)

# The global recovery pass retries every known temporary row from the ledger. It never
# deletes an untracked server row. Unidentified/pending obligations therefore fail safe.
recovery = r'''
    async function recoverCleanupObligations() {
      if (!cleanupLedgerController || !baselineSignature || !structure || !report.matrix?.matrixId) return;
      const pendingRows = cleanupLedgerController.snapshot().obligations
        .filter(item => item.status === 'pending' && item.kind === 'temporary-row' && String(item.rowCardId || '').trim())
        .reverse();
      for (const obligation of pendingRows) {
        const cleaned = await cleanupCreatedRow(obligation.rowCardId, `${obligation.scenarioId || 'uat'}: global-finally`);
        if (!cleaned) timeline('cleanup-retry-failed', obligation.id, { rowCardId: obligation.rowCardId });
      }
      const state = await freshSnapshot();
      for (const obligation of cleanupLedgerController.snapshot().obligations.filter(item => item.status === 'pending' && item.kind === 'field-mutation')) {
        const exists = state.snapshot.rows.some(row => canon(row.rowCardId) === canon(obligation.rowCardId));
        if (!exists) resolveCleanupObligation(obligation.id, { status: 'already-absent', resolvedAt: now(), resolvedBy: 'global-finally-row-absence' });
      }
      report.cleanupLedger = cleanupLedgerController.snapshot();
    }
'''
replace_once(
    "    async function createTemporaryRow(scenarioId) {\n",
    recovery + "    async function createTemporaryRow(scenarioId) {\n",
    'global recovery helper',
)

# Initialize the ledger from the pre-write server snapshot immediately after the baseline
# signature exists, before any destructive scenario can execute.
replace_once(
    "      structure = await bridge.requestStructure(bridge.templateId()); baseline = await bridge.loadSnapshot(structure); baselineSignature = snapshotSignature(baseline);\n      catalog = await bridge.loadDictionaryCatalog(structure, baseline, { forceRefresh: true, transient: true });\n",
    "      structure = await bridge.requestStructure(bridge.templateId()); baseline = await bridge.loadSnapshot(structure); baselineSignature = snapshotSignature(baseline);\n      cleanupLedgerController = createCleanupLedger(baselineSignature); report.cleanupLedger = cleanupLedgerController.snapshot();\n      catalog = await bridge.loadDictionaryCatalog(structure, baseline, { forceRefresh: true, transient: true });\n",
    'ledger initialization',
)

# Recovery belongs in the outer finally so it runs on PASS, ordinary FAIL, and fatal
# exceptions alike. A fresh post-cleanup snapshot is the only authority for VERIFIED.
finally_recovery = r'''
      try {
        await recoverCleanupObligations();
        if (cleanupLedgerController && baselineSignature && structure && report.matrix?.matrixId) {
          const restoredState = await freshSnapshot();
          report.cleanupLedger = cleanupLedgerController.snapshot();
          report.restoreProof = baselineRestoreProof(baselineSignature, snapshotSignature(restoredState.snapshot), report.cleanupLedger);
          addCheck('final-restore-proof', 'Task9: восстановление baseline', report.restoreProof.status === 'VERIFIED' ? 'PASS' : 'FAIL', report.restoreProof.status === 'VERIFIED'
            ? `Baseline подтверждён fresh read; cleanup ${report.cleanupLedger.verified}/${report.cleanupLedger.total}.`
            : `UNSAFE: baselineEquivalent=${report.restoreProof.baselineEquivalent}, pending=${report.restoreProof.pendingObligations}, failed=${report.restoreProof.failedObligations}.`,
            { required: true, data: report.restoreProof });
          if (report.restoreProof.status === 'UNSAFE') { cleanupUnsafe = true; report.status = 'UNSAFE'; }
        }
      } catch (recoveryError) {
        cleanupUnsafe = true;
        report.status = 'UNSAFE';
        report.cleanupLedger = cleanupLedgerController ? cleanupLedgerController.snapshot() : report.cleanupLedger;
        report.restoreProof = {
          status: 'UNSAFE', baselineEquivalent: false,
          pendingObligations: Number(report.cleanupLedger?.pending || 0),
          failedObligations: Number(report.cleanupLedger?.failed || 0),
          error: String(recoveryError?.message || recoveryError), checkedAt: now(),
        };
        addCheck('final-restore-proof', 'Task9: восстановление baseline', 'FAIL', `UNSAFE: ${report.restoreProof.error}`, { required: true, data: report.restoreProof });
      }

'''
replace_once(
    "    } finally {\n\n      try {\n        const packageProbe = await E.makeZip",
    "    } finally {\n" + finally_recovery + "      try {\n        const packageProbe = await E.makeZip",
    'finally recovery integration',
)

# After the Task8 functional audit, Task9 safety always wins over a cosmetic PASS/FAIL.
replace_once(
    "      report.functionalActionAudit = actionCoverageFromChecks(report.checks, E.STUDIO_ACTION_REGISTRY || []);\n      if (report.functionalActionAudit.missing.length && report.status === 'PASSED') report.status = 'FAILED';\n",
    "      report.functionalActionAudit = actionCoverageFromChecks(report.checks, E.STUDIO_ACTION_REGISTRY || []);\n      if (cleanupUnsafe || report.restoreProof?.status === 'UNSAFE') report.status = 'UNSAFE';\n      else if (report.functionalActionAudit.missing.length && report.status === 'PASSED') report.status = 'FAILED';\n",
    'Task9 status precedence',
)

replace_once(
    "report.summary = { pass: report.checks.filter(x => x.status === 'PASS').length, fail: report.checks.filter(x => x.status === 'FAIL').length, warn: report.checks.filter(x => x.status === 'WARN').length, notRun: report.checks.filter(x => x.status === 'NOT_RUN').length, writesAttempted: report.writesAttempted, writesCompleted: report.writesCompleted, cleanupVerified: report.cleanup.filter(x => x.status === 'verified' || x.status === 'already-absent').length, cleanupFailed: report.cleanup.filter(x => x.status === 'FAILED').length };",
    "report.summary = { pass: report.checks.filter(x => x.status === 'PASS').length, fail: report.checks.filter(x => x.status === 'FAIL').length, warn: report.checks.filter(x => x.status === 'WARN').length, notRun: report.checks.filter(x => x.status === 'NOT_RUN').length, writesAttempted: report.writesAttempted, writesCompleted: report.writesCompleted, cleanupVerified: report.cleanup.filter(x => x.status === 'verified' || x.status === 'already-absent').length, cleanupFailed: report.cleanup.filter(x => x.status === 'FAILED').length, cleanupLedgerPending: Number(report.cleanupLedger?.pending || 0), cleanupLedgerFailed: Number(report.cleanupLedger?.failed || 0), restoreStatus: report.restoreProof?.status || 'NOT_RUN' };",
    'summary cleanup ledger',
)

# The downloaded evidence package contains both the obligation ledger and the final proof.
replace_once(
    "      packageEntries.push(['summary.json', utf8(summary)], ['uat-report.json', utf8(report)], ['timeline.json', utf8(report.timeline)], ['dictionary-audit.json', utf8({ dictionaryAudit: report.dictionaryAudit, rolePresentationAudit: report.rolePresentationAudit, recordKeepingAudit: report.recordKeepingAudit })], ['README.txt', utf8(readme)]);\n",
    "      packageEntries.push(['cleanup-ledger.json', utf8(report.cleanupLedger || {})], ['restore-proof.json', utf8(report.restoreProof || {})], ['summary.json', utf8(summary)], ['uat-report.json', utf8(report)], ['timeline.json', utf8(report.timeline)], ['dictionary-audit.json', utf8({ dictionaryAudit: report.dictionaryAudit, rolePresentationAudit: report.rolePresentationAudit, recordKeepingAudit: report.recordKeepingAudit })], ['README.txt', utf8(readme)]);\n",
    'ZIP cleanup evidence',
)

replace_once(
    "  window[INSTALL_KEY] = { version: VERSION, seededRandom, hashSeed, snapshotSignature, cloneWorkbook, buildWritableFieldInventory, fieldCandidateValues, actionCoverageFromChecks, runFullUat, installUi };",
    "  window[INSTALL_KEY] = { version: VERSION, seededRandom, hashSeed, snapshotSignature, cloneWorkbook, buildWritableFieldInventory, fieldCandidateValues, actionCoverageFromChecks, createCleanupLedger, baselineRestoreProof, runFullUat, installUi };",
    'Task9 helper exports',
)

PATH.write_text(source, encoding='utf-8')
print('Applied Task9 destructive self-restore ledger + finally recovery + baseline proof patch.')
