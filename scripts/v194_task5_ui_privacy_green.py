from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')

if 'function reconciliationSummary(' in text or 'function sanitizeSupportReport(' in text:
    raise SystemExit('Task 5 helpers already exist; refusing duplicate patch.')


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one marker, found {count}')
    text = text.replace(old, new, 1)

replace_once(
    "    lastMutationReceipts: null,\n    busy: false,",
    "    lastMutationReceipts: null,\n    lastReconciliation: null,\n    busy: false,",
    'APP reconciliation slot',
)

replace_once(
    "    APP.abortRequested = false;\n    APP.lastMutationReceipts = null;\n    let preflight;",
    "    APP.abortRequested = false;\n    APP.lastMutationReceipts = null;\n    APP.lastReconciliation = null;\n    let preflight;",
    'clear stale reconciliation before Apply',
)

json_marker = "  function jsonReplacer(key, value) {"
helpers = r'''  function reconciliationSummary(result) {
    if (!result) return 'Проверка результата не выполнялась.';
    if (result.status === 'verified') {
      return `Подтверждено: ${Number(result.verifiedCount || 0)} из ${Number(result.checkedCount || 0)}.`;
    }
    if (result.status === 'divergent') {
      return `Подтверждено: ${Number(result.verifiedCount || 0)}; расхождений: ${Number(result.divergentCount || 0) + Number(result.missingCount || 0)}.`;
    }
    return `Проверка неполная: подтверждено ${Number(result.verifiedCount || 0)}; неизвестно ${Number(result.unknownCount || 0)}.`;
  }

  function renderReconciliationResult(result) {
    const host = document.querySelector?.('#tms-reconciliation-result');
    if (!host) return null;
    host.textContent = reconciliationSummary(result);
    host.dataset.status = result?.status || 'not-run';
    return host.textContent;
  }

  function updateReconciliationControlState() {
    const button = document.querySelector?.('#tms-reconcile');
    if (!button) return false;
    const hasReceipts = Boolean(APP.lastMutationReceipts?.receipts?.length);
    const capabilityAllows = Boolean(APP.capabilityAvailability?.reconcile?.enabled);
    button.hidden = !hasReceipts;
    button.disabled = Boolean(APP.busy || !hasReceipts || !capabilityAllows);
    button.title = hasReceipts && !capabilityAllows
      ? humanCapabilityBlocker(APP.capabilityAvailability?.reconcile?.blockers || [])
      : '';
    return !button.disabled;
  }

  function sanitizeSupportReport(input = {}, options = {}) {
    const reconciliation = input.reconciliation || {};
    const reasonCodes = [...new Set([
      reconciliation.reasonCode,
      ...(reconciliation.rows || []).map(row => row?.reasonCode),
    ].filter(Boolean))];
    return {
      studioVersion: String(input.version || APP.version),
      createdAt: nowIso(),
      ...(options.includeIds ? {
        matrixId: input.matrixId || null,
        templateId: input.templateId || null,
      } : {}),
      capabilities: {
        overall: input.capabilities?.overall || null,
        blockers: (input.capabilities?.blockers || []).map(item => ({ code: item?.code || null, scope: item?.scope || null })),
        warnings: (input.capabilities?.warnings || []).map(item => ({ code: item?.code || null, scope: item?.scope || null })),
      },
      apply: input.apply ? {
        status: input.apply.status || null,
        requestedCount: Number(input.apply.requestedCount || 0),
        appliedCount: Number(input.apply.appliedCount || 0),
        failedCount: Number(input.apply.failedCount || 0),
        notStartedCount: Number(input.apply.notStartedCount || 0),
      } : null,
      reconciliation: {
        status: reconciliation.status || null,
        checkedCount: Number(reconciliation.checkedCount || 0),
        verifiedCount: Number(reconciliation.verifiedCount || 0),
        divergentCount: Number(reconciliation.divergentCount || 0),
        missingCount: Number(reconciliation.missingCount || 0),
        unknownCount: Number(reconciliation.unknownCount || 0),
        reasonCodes,
      },
    };
  }

'''
replace_once(json_marker, helpers + json_marker, 'UI/privacy helper insertion')

# Keep reconciliation button state correct after setBusy(true/false), without touching Apply semantics.
set_busy_tail = '''      if ((APP.progress?.percent || 0) < 100) {
        const status = APP.plan ? (APP.plan.safety?.blocked ? 'Нужен другой файл или черновик матрицы' : (APP.plan.skippedRows?.length ? `Готово: ${APP.plan.skippedRows.length} строк будут пропущены` : 'Готово к применению')) : 'Готово';
        setProgress(0, status, '');
      }
    }
  }
'''
set_busy_new = '''      if ((APP.progress?.percent || 0) < 100) {
        const status = APP.plan ? (APP.plan.safety?.blocked ? 'Нужен другой файл или черновик матрицы' : (APP.plan.skippedRows?.length ? `Готово: ${APP.plan.skippedRows.length} строк будут пропущены` : 'Готово к применению')) : 'Готово';
        setProgress(0, status, '');
      }
    }
    updateReconciliationControlState();
  }
'''
replace_once(set_busy_tail, set_busy_new, 'setBusy reconciliation state')

css_old = ".tms-capability-details{font-size:10px;color:#777;margin-top:3px;line-height:1.35}.tms-step{"
css_new = ".tms-capability-details{font-size:10px;color:#777;margin-top:3px;line-height:1.35}.tms-reconciliation-result{margin-top:2px;min-height:16px}.tms-reconciliation-result[data-status=verified]{color:#2d6a3f}.tms-reconciliation-result[data-status=divergent]{color:var(--tms-red-dark);font-weight:700}.tms-reconciliation-result[data-status=incomplete]{color:#86630b}.tms-step{"
replace_once(css_old, css_new, 'reconciliation CSS')

markup_old = '''          <div class="tms-step tms-step-apply"><div class="tms-step-label">4 · Применение</div><button id="tms-apply" class="tms-primary" disabled>Применить к TESSA</button><button id="tms-download-report" class="tms-ghost" hidden disabled>Скачать отчёт</button><button id="tms-refresh-view" class="tms-ghost" hidden disabled>Обновить отображение</button><div id="tms-apply-note" class="tms-step-caption"></div></div>
'''
markup_new = '''          <div class="tms-step tms-step-apply"><div class="tms-step-label">4 · Применение</div><button id="tms-apply" class="tms-primary" disabled>Применить к TESSA</button><button id="tms-reconcile" class="tms-ghost" hidden disabled>Проверить результат</button><div id="tms-reconciliation-result" class="tms-step-caption tms-reconciliation-result"></div><button id="tms-download-report" class="tms-ghost" hidden disabled>Скачать отчёт</button><button id="tms-refresh-view" class="tms-ghost" hidden disabled>Обновить отображение</button><div id="tms-apply-note" class="tms-step-caption"></div></div>
'''
replace_once(markup_old, markup_new, 'reconciliation markup')

handler_marker = "    panel.querySelector('#tms-download-report').addEventListener('click', () => { downloadLastReport(); });\n"
handler = r'''    panel.querySelector('#tms-reconcile').addEventListener('click', async () => {
      if (APP.busy || !APP.lastMutationReceipts?.receipts?.length) return;
      setBusy(true);
      try {
        requireRuntimeOperation('reconcile');
        setProgress(20, 'Проверяю результат', 'Свежий snapshot TESSA · без записи');
        APP.lastReconciliation = await runReconciliationRead(
          () => TessaBridge.create(),
          APP.lastMutationReceipts,
          { attempts: 3, baseDelayMs: 450 },
        );
        renderReconciliationResult(APP.lastReconciliation);
        setProgress(100, 'Проверка результата завершена', reconciliationSummary(APP.lastReconciliation));
      } catch (error) {
        const retryable = isWriterLockError(error);
        APP.lastReconciliation = {
          status: 'incomplete',
          checkedCount: 0,
          verifiedCount: 0,
          divergentCount: 0,
          missingCount: 0,
          unknownCount: APP.lastMutationReceipts?.receipts?.length || 0,
          rows: [],
          attempts: 0,
          retryable,
          reasonCode: retryable ? 'reconcile-writer-lock' : 'reconcile-read-failed',
        };
        renderReconciliationResult(APP.lastReconciliation);
        setProgress(100, 'Проверка результата не завершена', reconciliationSummary(APP.lastReconciliation));
      } finally {
        setBusy(false);
      }
    });
'''
replace_once(handler_marker, handler_marker + handler, 'reconciliation handler')

apply_consumed_old = '''          invalidatePlanStateAfterApply(APP, result);
          renderPlanConsumedNotice(result);
'''
apply_consumed_new = '''          invalidatePlanStateAfterApply(APP, result);
          renderPlanConsumedNotice(result);
          renderReconciliationResult(APP.lastReconciliation);
          updateReconciliationControlState();
'''
replace_once(apply_consumed_old, apply_consumed_new, 'post-Apply reconciliation control')

export_old = 'normalizeSpace, isOverwriteMatch, stripFormulaMarker, canonicalHeader, canonicalValue, definitionKey, splitCell, mapConcurrent, yieldToMain, estimateRemainingMs, formatEtaMs, workProgressDetail, rememberReport, downloadLastReport,'
export_new = 'normalizeSpace, isOverwriteMatch, stripFormulaMarker, canonicalHeader, canonicalValue, definitionKey, splitCell, mapConcurrent, yieldToMain, estimateRemainingMs, formatEtaMs, workProgressDetail, rememberReport, downloadLastReport, reconciliationSummary, renderReconciliationResult, sanitizeSupportReport,'
replace_once(export_old, export_new, 'Task 5 test exports')

path.write_text(text, encoding='utf-8')
