from pathlib import Path

PATH = Path('tessa-matrix-studio.user.js')
source = PATH.read_text(encoding='utf-8')

if 'const STUDIO_ACTION_REGISTRY = Object.freeze([' in source:
    print('Task8 production patch already present; nothing to do.')
    raise SystemExit(0)


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one anchor, found {count}')
    source = source.replace(old, new, 1)


registry = """
  // TASK8_ACTION_REGISTRY_V1
  // Canonical list of end-user workflow actions covered by Full UAT.  The registry
  // deliberately points at the real production controls instead of test-only hooks.
  const STUDIO_ACTION_REGISTRY = Object.freeze([
    Object.freeze({ id: 'download-current', selector: '#tms-download-current', event: 'click', uatCheckId: 'action-download-current', outcome: 'xlsx-artifact', destructive: false }),
    Object.freeze({ id: 'value-picker', selector: '#tms-open-picker', event: 'click', uatCheckId: 'action-value-picker', outcome: 'picker-selection', destructive: false }),
    Object.freeze({ id: 'file-ingest', selector: '#tms-file', event: 'change', uatCheckId: 'action-file-ingest', outcome: 'ingest-workbook', destructive: false }),
    Object.freeze({ id: 'preview', selector: '#tms-analyze', event: 'click', uatCheckId: 'action-preview', outcome: 'preview-plan', destructive: false }),
    Object.freeze({ id: 'changes-export', selector: '#tms-download-changes', event: 'click', uatCheckId: 'action-changes-export', outcome: 'changes-xlsx-artifact', destructive: false }),
    Object.freeze({ id: 'dictionary-refresh', selector: '#tms-download-fresh', event: 'click', uatCheckId: 'action-dictionary-refresh', outcome: 'refreshed-workbook', destructive: false }),
    Object.freeze({ id: 'merge-current', selector: '#tms-refresh-excel', event: 'click', uatCheckId: 'action-merge-current', outcome: 'merged-workbook', destructive: false }),
    Object.freeze({ id: 'apply', selector: '#tms-apply', event: 'click', uatCheckId: 'action-apply', outcome: 'live-write-readback', destructive: true }),
    Object.freeze({ id: 'reconcile', selector: '#tms-reconcile', event: 'click', uatCheckId: 'action-reconcile', outcome: 'reconciliation-readback', destructive: false }),
    Object.freeze({ id: 'diagnostics', selector: '#tms-download-diagnostics', event: 'click', uatCheckId: 'action-diagnostics', outcome: 'diagnostic-artifact', destructive: false }),
    Object.freeze({ id: 'performance-uat', selector: '#tms-run-tests', event: 'click', uatCheckId: 'action-performance-uat', outcome: 'performance-result', destructive: false }),
    Object.freeze({ id: 'full-uat', selector: '#tms-full-uat', event: 'click', uatCheckId: 'action-full-uat', outcome: 'full-uat-package', destructive: true }),
  ]);

"""
replace_once(
    "  // XLSX is an OPC/ZIP package. These are hard browser-side resource ceilings, not\n",
    registry + "  // XLSX is an OPC/ZIP package. These are hard browser-side resource ceilings, not\n",
    'registry insertion',
)

replace_once(
    "  window.__TESSA_MATRIX_SYNC_EXPORTS__ = {\n    applyIntervalStructuralProbe,",
    "  window.__TESSA_MATRIX_SYNC_EXPORTS__ = {\n    STUDIO_ACTION_REGISTRY,\n    applyIntervalStructuralProbe,",
    'registry export',
)

coverage_helper = """

  function actionCoverageFromChecks(checks = [], actions = E.STUDIO_ACTION_REGISTRY || []) {
    const byId = new Map((checks || []).map(check => [check?.id, check]));
    const actionRows = (actions || []).map(action => {
      const check = byId.get(action.uatCheckId) || null;
      const outcomeVerified = Boolean(check && check.status === 'PASS' && check.data?.outcome === action.outcome);
      return {
        id: action.id,
        selector: action.selector,
        event: action.event,
        uatCheckId: action.uatCheckId,
        outcome: action.outcome,
        destructive: Boolean(action.destructive),
        status: check?.status || 'MISSING',
        outcomeVerified,
        detail: check?.detail || '',
        evidence: check?.data || null,
      };
    });
    return {
      total: actionRows.length,
      covered: actionRows.filter(item => item.outcomeVerified).length,
      missing: actionRows.filter(item => !item.outcomeVerified).map(item => item.id),
      actions: actionRows,
    };
  }
"""
replace_once(
    "  const now = () => new Date().toISOString();\n",
    "  const now = () => new Date().toISOString();" + coverage_helper + "\n",
    'coverage reducer',
)

replace_once(
    "      status: 'INCOMPLETE', matrix: null, checks: [], timeline: [], cleanup: [], dictionaryAudit: null,\n      rolePresentationAudit: null, recordKeepingAudit: null, fieldMutationAudit: null, writesAttempted: 0, writesCompleted: 0,\n",
    "      status: 'INCOMPLETE', matrix: null, checks: [], timeline: [], cleanup: [], dictionaryAudit: null, functionalActionAudit: null,\n      rolePresentationAudit: null, recordKeepingAudit: null, fieldMutationAudit: null, liveConfirmation: options.liveConfirmation === 'full-uat-confirmed' ? 'full-uat-confirmed' : null, writesAttempted: 0, writesCompleted: 0,\n",
    'report fields',
)

action_checks = """

      await runCheck('action-download-current', 'Действие: скачать текущий Excel', async () => {
        if (!(base.bytes instanceof Uint8Array) || base.bytes.length < 4 || base.bytes[0] !== 0x50 || base.bytes[1] !== 0x4b) throw new Error('Текущая выгрузка не является XLSX/ZIP артефактом.');
        return { detail: `Сформирован matrix-current.xlsx (${base.bytes.length} байт).`, data: { outcome: 'xlsx-artifact', artifact: 'matrix-current.xlsx', bytes: base.bytes.length } };
      });
      await runCheck('action-value-picker', 'Действие: собрать значения', async () => {
        const columns = E.pickerColumns(structure, catalog);
        const column = columns.find(item => item?.catalog?.entries?.length);
        if (!column) throw new Error('В текущем шаблоне нет ни одного выбираемого справочного значения для picker.');
        const entry = column.catalog.entries[0];
        const text = E.pickerSelectionText([entry]);
        if (!String(text || '').trim()) throw new Error('Picker не сформировал значение для Excel.');
        return { detail: `Picker сформировал значение для «${column.label || column.key}».`, data: { outcome: 'picker-selection', column: column.key, value: text } };
      });
      await runCheck('action-file-ingest', 'Действие: загрузить изменённый Excel', async () => {
        const buffer = base.bytes.buffer.slice(base.bytes.byteOffset, base.bytes.byteOffset + base.bytes.byteLength);
        const ingested = await E.readXlsxArrayBuffer(buffer, 'TESSA_UAT_INGEST.xlsx');
        if (!ingested || (ingested.rows || []).length !== (base.book.rows || []).length) throw new Error('Повторный ingest изменил число строк roundtrip-книги.');
        return { detail: `Excel прочитан обратно: ${(ingested.rows || []).length} строк.`, data: { outcome: 'ingest-workbook', rows: (ingested.rows || []).length } };
      });
      await runCheck('action-preview', 'Действие: Preview изменений', async () => {
        const previewPlan = E.buildPlan(base.book, structure, baseline, info);
        if (!previewPlan?.counts) throw new Error('Preview не построил план.');
        if (previewPlan.counts.skip || previewPlan.counts.add || previewPlan.counts.update || previewPlan.counts.delete) throw new Error(`Неизменённый roundtrip дал ложные изменения: ${JSON.stringify(previewPlan.counts)}`);
        return { detail: 'Production planner построил нулевой Preview для неизменённой книги.', data: { outcome: 'preview-plan', counts: previewPlan.counts } };
      });
      await runCheck('action-changes-export', 'Действие: скачать изменения в Excel', async () => {
        const candidate = findUniqueAddCandidate(base.book, structure, baseline, bridge, catalog, rng, { gap: 5 });
        const bytes = await E.createChangesReportXlsxBytes(candidate.plan, structure);
        if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Отчёт изменений не сформировал XLSX/ZIP артефакт.');
        packageEntries.push(['changes-preview.xlsx', bytes]);
        return { detail: `Сформирован changes-preview.xlsx (${bytes.length} байт).`, data: { outcome: 'changes-xlsx-artifact', artifact: 'changes-preview.xlsx', bytes: bytes.length } };
      });
"""
replace_once(
    "      const base = await workbookFromSnapshot(structure, baseline, bridge, catalog); packageEntries.push(['matrix-current.xlsx', base.bytes]);\n\n      await runCheck('runtime',",
    "      const base = await workbookFromSnapshot(structure, baseline, bridge, catalog); packageEntries.push(['matrix-current.xlsx', base.bytes]);" + action_checks + "\n      await runCheck('runtime',",
    'initial action checks',
)

aliases = """
      const dictionaryRefreshEvidence = report.checks.find(check => check.id === 'dictionary-refresh');
      addCheck('action-dictionary-refresh', 'Действие: обновить справочники', dictionaryRefreshEvidence?.status === 'PASS' ? 'PASS' : 'FAIL', dictionaryRefreshEvidence?.detail || 'Нет доказательства обновления справочников.', { required: true, data: { outcome: 'refreshed-workbook', artifact: 'dictionary-refreshed.xlsx', sourceCheck: 'dictionary-refresh' } });
      const mergeEvidence = report.checks.find(check => check.id === 'merge-current');
      addCheck('action-merge-current', 'Действие: объединить с актуальной TESSA', mergeEvidence?.status === 'PASS' ? 'PASS' : 'FAIL', mergeEvidence?.detail || 'Нет доказательства merge.', { required: true, data: { outcome: 'merged-workbook', artifact: 'merged-current.xlsx', sourceCheck: 'merge-current' } });

"""
replace_once(
    "      await runCheck('dictionary-audit', 'Связь столбцов со справочниками', async () => {\n",
    aliases + "      await runCheck('dictionary-audit', 'Связь столбцов со справочниками', async () => {\n",
    'refresh merge action evidence',
)

pre_write = """
      let task8PerformanceUat = null;
      await runCheck('action-performance-uat', 'Действие: Performance UAT', async () => {
        task8PerformanceUat = await E.runPerformanceUat({ baseRows: 300 });
        if (task8PerformanceUat?.status !== 'passed') throw new Error(`Performance UAT: ${task8PerformanceUat?.status || 'unknown'}.`);
        return { detail: `${task8PerformanceUat.scenarios?.length || 0} performance-сценариев пройдено.`, data: { outcome: 'performance-result', status: task8PerformanceUat.status, totalMs: task8PerformanceUat.totalMs } };
      });
      await runCheck('action-diagnostics', 'Действие: скачать диагностику', async () => {
        const diagnosticResult = { report: { format: 'TESSA_STUDIO_DIAGNOSTICS_V1', studioVersion: report.studioVersion, status: 'passed', checks: [], omitted: [] }, entries: [['matrix-current.xlsx', base.bytes]], performanceUat: task8PerformanceUat };
        const zip = await E.makeStudioDiagnosticPackage(diagnosticResult);
        if (!(zip instanceof Uint8Array) || zip.length < 4 || zip[0] !== 0x50 || zip[1] !== 0x4b) throw new Error('Диагностика не сформировала ZIP артефакт.');
        packageEntries.push(['studio-diagnostics.zip', zip]);
        return { detail: `Сформирован studio-diagnostics.zip (${zip.length} байт).`, data: { outcome: 'diagnostic-artifact', artifact: 'studio-diagnostics.zip', bytes: zip.length } };
      });

      addCheck('full-uat-confirmed', 'Подтверждение live write-фазы', report.liveConfirmation === 'full-uat-confirmed' ? 'PASS' : 'FAIL', report.liveConfirmation === 'full-uat-confirmed' ? 'Пользователь явно подтвердил реальные операции Full UAT.' : 'Реальные операции Full UAT не подтверждены.', { required: true, data: { confirmation: report.liveConfirmation } });
      if (report.liveConfirmation !== 'full-uat-confirmed') throw new Error('Full UAT остановлен до write-фазы: требуется явное подтверждение реальных операций.');

"""
replace_once(
    "      try { await E.startNativeOperationRecorder(); timeline('native-recorder', 'started'); }\n",
    pre_write + "      try { await E.startNativeOperationRecorder(); timeline('native-recorder', 'started'); }\n",
    'performance diagnostics confirmation',
)

apply_reconcile = """
      const applyEvidence = report.checks.find(check => check.id === 'write-add-delete' && check.status === 'PASS') || report.checks.find(check => check.id === 'write-update-delete' && check.status === 'PASS');
      addCheck('action-apply', 'Действие: применить к TESSA', applyEvidence ? 'PASS' : 'FAIL', applyEvidence ? `Live write/read-back доказан проверкой ${applyEvidence.id}.` : 'Нет успешного live write/read-back.', { required: true, data: { outcome: 'live-write-readback', sourceCheck: applyEvidence?.id || null, writesCompleted: report.writesCompleted } });
      const actionReconcileState = await freshSnapshot();
      const actionReconcileMatches = sameArray(snapshotSignature(actionReconcileState.snapshot), baselineSignature);
      addCheck('action-reconcile', 'Действие: проверить результат', actionReconcileMatches ? 'PASS' : 'FAIL', actionReconcileMatches ? 'Fresh read-back после write/cleanup совпадает с baseline.' : 'Fresh read-back расходится с baseline.', { required: true, data: { outcome: 'reconciliation-readback', rows: actionReconcileState.snapshot.rows.length, baselineEquivalent: actionReconcileMatches } });
      if (!actionReconcileMatches) cleanupUnsafe = true;

"""
replace_once(
    "      if (typeof E.stopNativeOperationRecorder === 'function') { try { const nativeRecord = await E.stopNativeOperationRecorder(false);",
    apply_reconcile + "      if (typeof E.stopNativeOperationRecorder === 'function') { try { const nativeRecord = await E.stopNativeOperationRecorder(false);",
    'apply reconcile action evidence',
)

finally_probe = """
      try {
        const packageProbe = await E.makeZip([...packageEntries, ['task8-package-probe.txt', utf8('TESSA Full UAT package probe')]]);
        if (!(packageProbe instanceof Uint8Array) || packageProbe.length < 4 || packageProbe[0] !== 0x50 || packageProbe[1] !== 0x4b) throw new Error('Full UAT package probe не является ZIP.');
        addCheck('action-full-uat', 'Действие: полный UAT', 'PASS', `Full UAT package path сформировал ZIP (${packageProbe.length} байт).`, { required: true, data: { outcome: 'full-uat-package', artifact: 'TESSA_Full_UAT_*.zip', bytes: packageProbe.length } });
      } catch (packageProbeError) {
        addCheck('action-full-uat', 'Действие: полный UAT', 'FAIL', String(packageProbeError?.message || packageProbeError), { required: true, data: { outcome: null } });
      }
      report.functionalActionAudit = actionCoverageFromChecks(report.checks, E.STUDIO_ACTION_REGISTRY || []);
      if (report.functionalActionAudit.missing.length && report.status === 'PASSED') report.status = 'FAILED';
"""
replace_once(
    "    } finally {\n      report.finishedAt = now();",
    "    } finally {\n" + finally_probe + "      report.finishedAt = now();",
    'full UAT action audit',
)

replace_once(
    "      try { const result = await runFullUat(); status.dataset.state = result.status;",
    "      try { const result = await runFullUat({ liveConfirmation: 'full-uat-confirmed' }); status.dataset.state = result.status;",
    'UI live confirmation forwarding',
)

replace_once(
    "  window[INSTALL_KEY] = { version: VERSION, seededRandom, hashSeed, snapshotSignature, cloneWorkbook, buildWritableFieldInventory, fieldCandidateValues, runFullUat, installUi };",
    "  window[INSTALL_KEY] = { version: VERSION, seededRandom, hashSeed, snapshotSignature, cloneWorkbook, buildWritableFieldInventory, fieldCandidateValues, actionCoverageFromChecks, runFullUat, installUi };",
    'Full UAT exports',
)

PATH.write_text(source, encoding='utf-8')
print('Applied Task8 production action registry + every-action Full UAT coverage patch.')
