from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')

marker = "  async function makeStudioDiagnosticPackage(result) {\n"
assert text.count(marker) == 1, 'makeStudioDiagnosticPackage marker mismatch'
helpers = r'''  function buildIntervalDiagnosticSummary(report = {}) {
    const number = value => Math.max(0, Number(value) || 0);
    const topologySummary = topology => {
      if (!topology || typeof topology !== 'object') return null;
      return {
        cardIdPresent: Boolean(topology.cardIdPresent),
        cardVersion: topology.cardVersion ?? null,
        mainSectionChanged: Boolean(topology.mainSectionChanged),
        versionRowCount: number(topology.versionRowCount),
        requestVersionMatchesVersionRow: topology.requestVersionMatchesVersionRow == null
          ? null : Boolean(topology.requestVersionMatchesVersionRow),
        ownerMismatchCount: number(topology.ownerMismatchCount),
        ownerMissingCount: number(topology.ownerMissingCount),
        missingRowIdCount: number(topology.missingRowIdCount),
        duplicateRowIdCount: number(topology.duplicateRowIdCount),
        rowCounts: {
          versions: number(topology.rowCounts?.versions),
          values: number(topology.rowCounts?.values),
          roles: number(topology.rowCounts?.roles),
        },
        markerCounts: {
          state: number(topology.markerCounts?.state),
          changed: number(topology.markerCounts?.changed),
        },
      };
    };
    return {
      format: 'TESSA_INTERVAL_SUMMARY_V1',
      studioVersion: String(report.studioVersion || APP.version),
      scope: report.scope || 'read-only',
      writesAttempted: number(report.writesAttempted),
      interrupted: Boolean(report.interrupted),
      sampleCount: Array.isArray(report.samples) ? report.samples.length : 0,
      samples: (report.samples || []).map(sample => {
        const topology = topologySummary(sample?.identityTopology);
        return {
          kind: normalizeSpace(sample?.kind || '') || null,
          outcome: normalizeSpace(sample?.outcome || '') || null,
          code: normalizeSpace(sample?.code || '') || null,
          structuralMode: normalizeSpace(sample?.structuralMode || '') || null,
          ...(topology ? { identityTopology: topology } : {}),
        };
      }),
    };
  }

  async function resolveStudioIntervalDiagnostics({
    plan, workbook, structure, snapshot, cached = null, assertContext,
    createBridge = () => TessaBridge.create(), collect = collectIntervalDiagnostics,
  } = {}) {
    const failedRows = plan?.skippedRows || [];
    if (!failedRows.some(row => row?.code === 'duplicate-interval-extractor')) return null;
    if (cached?.value) return { ...cached, reused: true, cacheable: true };

    const name = `TESSA_Interval_Diagnostics_${nowIso().replace(/[:.]/g, '-')}.json`;
    if (!workbook || !structure || !snapshot || typeof assertContext !== 'function') {
      return {
        name,
        reused: false,
        cacheable: false,
        value: {
          format: 'TESSA_INTERVAL_DIAGNOSTICS_V1',
          studioVersion: APP.version,
          scope: 'read-only',
          writesAttempted: 0,
          interrupted: true,
          interruptionReason: 'Контекст Preview недоступен для диагностики интервалов.',
          samples: [],
        },
      };
    }

    await assertContext();
    const bridge = await createBridge();
    await assertContext();
    const value = await collect({ bridge, workbook, structure, snapshot, failedRows, assertContext });
    return { value, name, reused: false, cacheable: !value?.interrupted };
  }

'''
text = text.replace(marker, helpers + marker, 1)

old_package = r'''  async function makeStudioDiagnosticPackage(result) {
    // Late packaging is local only. Re-downloading never re-runs server checks.
    const readme = 'TESSA Matrix Studio — проверки без записи\n\nНачните с report.json: checks содержит результат каждого этапа, omitted — данные, не вошедшие в пакет.\nrequests/ содержит бизнес-запросы и ответы. selected.xlsx — исходный выбранный файл; matrix-current.xlsx — свежая выгрузка, если их удалось собрать.\nЗапись, удаление, транзакции и чужая параллельная запись не тестировались. Успешная проверка дубликатов не разрешает Apply без обычного свежего Preview.\nПакет содержит рабочие значения. Передавайте его только тем, кому можно видеть эту матрицу. Cookies, пароли и HTTP-заголовки не собираются.\n';
    return makeZip([['README.txt', readme], ['report.json', JSON.stringify(result.report, null, 2)], ...result.entries]);
  }
'''
new_package = r'''  async function makeStudioDiagnosticPackage(result) {
    // Late packaging is local only. Re-downloading never re-runs server checks.
    const readme = 'TESSA Matrix Studio — проверки без записи\n\nНачните с report.json: checks содержит результат каждого этапа, omitted — данные, не вошедшие в пакет.\nrequests/ содержит бизнес-запросы и ответы. selected.xlsx — исходный выбранный файл; matrix-current.xlsx — свежая выгрузка, если их удалось собрать.\nЕсли Preview содержит ошибку интервала, interval/ содержит полный opt-in raw JSON и отдельный privacy-safe interval-summary.json.\nЗапись, удаление, транзакции и чужая параллельная запись не тестировались. Успешная проверка дубликатов не разрешает Apply без обычного свежего Preview.\nПакет содержит рабочие значения. Передавайте его только тем, кому можно видеть эту матрицу. Cookies, пароли и HTTP-заголовки не собираются.\n';
    const interval = result?.intervalDiagnostics?.value;
    const intervalEntries = interval ? [
      ['interval/TESSA_Interval_Diagnostics.json', JSON.stringify(interval, null, 2)],
      ['interval/interval-summary.json', JSON.stringify(buildIntervalDiagnosticSummary(interval), null, 2)],
    ] : [];
    return makeZip([['README.txt', readme], ['report.json', JSON.stringify(result.report, null, 2)], ...result.entries, ...intervalEntries]);
  }
'''
assert old_package in text, 'package block mismatch'
text = text.replace(old_package, new_package, 1)

old_run = r'''      assertIdentity();
      // References stay in memory only; package serialization uses report/entries.
      result.source = { plan: originalPlan, workbook: originalWorkbook, file };
      APP.lastStudioDiagnostics = result;
      renderStudioDiagnostics(result.report);
'''
new_run = r'''      assertIdentity();
      const intervalDiagnostics = await resolveStudioIntervalDiagnostics({
        plan: originalPlan,
        workbook: originalWorkbook,
        structure: APP.structure,
        snapshot: APP.snapshot,
        cached: APP.lastIntervalDiagnostics,
        assertContext,
      });
      assertIdentity();
      if (intervalDiagnostics) {
        result.intervalDiagnostics = intervalDiagnostics;
        result.report.intervalDiagnostics = {
          included: true,
          reused: Boolean(intervalDiagnostics.reused),
          status: intervalDiagnostics.value?.interrupted ? 'incomplete' : 'captured',
          sampleCount: Number(intervalDiagnostics.value?.samples?.length || 0),
          writesAttempted: Number(intervalDiagnostics.value?.writesAttempted || 0),
        };
        if (intervalDiagnostics.cacheable && !APP.lastIntervalDiagnostics) {
          APP.lastIntervalDiagnostics = { value: intervalDiagnostics.value, name: intervalDiagnostics.name };
          updateIntervalDiagnosticControlState();
        }
      } else {
        delete result.intervalDiagnostics;
        result.report.intervalDiagnostics = { included: false, status: 'not-needed', writesAttempted: 0 };
      }
      // References stay in memory only; package serialization uses report/entries.
      result.source = { plan: originalPlan, workbook: originalWorkbook, file };
      APP.lastStudioDiagnostics = result;
      renderStudioDiagnostics(result.report);
'''
assert old_run in text, 'runStudioDiagnostics integration block mismatch'
text = text.replace(old_run, new_run, 1)

old_export = "    applyIntervalStructuralProbe, applyCardNewTopologyProbe, applyCardNewEnvelopeProbe, summarizeCardIdentityTopology, collectIntervalDiagnostics, collectStudioDiagnostics, makeStudioDiagnosticPackage,\n"
new_export = "    applyIntervalStructuralProbe, applyCardNewTopologyProbe, applyCardNewEnvelopeProbe, summarizeCardIdentityTopology, collectIntervalDiagnostics, buildIntervalDiagnosticSummary, resolveStudioIntervalDiagnostics, collectStudioDiagnostics, makeStudioDiagnosticPackage,\n"
assert text.count(old_export) == 1, 'export block mismatch'
text = text.replace(old_export, new_export, 1)

path.write_text(text, encoding='utf-8')
print('patched unified Studio + interval diagnostics bundle')
