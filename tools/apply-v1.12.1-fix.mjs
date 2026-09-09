import fs from 'node:fs';

const file = new URL('../tessa-matrix-studio.user.js', import.meta.url);
let code = fs.readFileSync(file, 'utf8');

function replaceOnce(before, after, label = before.slice(0, 80)) {
  const first = code.indexOf(before);
  if (first < 0) throw new Error(`pattern not found (${label})`);
  if (code.indexOf(before, first + before.length) >= 0) throw new Error(`pattern not unique (${label})`);
  code = code.slice(0, first) + after + code.slice(first + before.length);
}

function insertBefore(marker, text, label = marker.slice(0, 80)) {
  const index = code.indexOf(marker);
  if (index < 0) throw new Error(`insert marker not found (${label})`);
  if (code.indexOf(marker, index + marker.length) >= 0) throw new Error(`insert marker not unique (${label})`);
  code = code.slice(0, index) + text + code.slice(index);
}

function replaceRange(startMarker, endMarker, replacement, label) {
  const start = code.indexOf(startMarker);
  if (start < 0) throw new Error(`range start not found (${label})`);
  const end = code.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`range end not found (${label})`);
  code = code.slice(0, start) + replacement + code.slice(end);
}

// Published v1.12.0 is immutable. The repaired runtime must be a new version.
replaceOnce('// @version      1.12.0', '// @version      1.12.1', 'userscript version');
replaceOnce("    version: '1.12.0',", "    version: '1.12.1',", 'APP version');
replaceOnce(
  '    lastReport: null,\n    lastIntervalDiagnostics: null,',
  '    lastReport: null,\n    lastSupportReport: null,\n    lastIntervalDiagnostics: null,',
  'APP lastSupportReport',
);

// Saving row cards is not equivalent to saving the matrix card. The main matrix Store
// intentionally carries no stale business fields: clone -> removeAllButChanged -> clean.
// ForceTransaction guarantees server save extensions run even when the reduced card has
// no dirty values, which is exactly the post-Apply commit we need.
insertBefore(
  '    async deleteMatrixRow(versionId) {',
`    async saveMainMatrixAfterApply() {
      const hasEditorChanges = typeof this.editor?.cardModel?.hasChanges === 'function'
        ? await this.editor.cardModel.hasChanges()
        : false;
      if (hasEditorChanges) {
        throw new Error('Основная карточка матрицы получила несохранённые изменения во время Apply. Автосохранение остановлено, чтобы не перезаписать параллельную правку.');
      }
      if (!this.mainCard || typeof this.mainCard.clone !== 'function') {
        throw new Error('Не удалось подготовить основную карточку матрицы к сохранению.');
      }
      const card = this.mainCard.clone();
      if (typeof card.removeAllButChanged !== 'function') {
        throw new Error('Текущая версия TESSA не поддерживает безопасную подготовку карточки к сохранению.');
      }
      card.removeAllButChanged();
      card.clean?.();

      const req = new this.cards.CardStoreRequest();
      req.card = card;
      req.forceTransaction = true;
      const response = await this.cardService.store(req);
      const error = this.validationError(response, 'Не удалось сохранить основную карточку матрицы');
      if (error) throw error;
      return {
        ok: true,
        skipped: false,
        method: 'force-transaction-store',
        cardId: String(response?.cardId || this.mainCard.id || ''),
        cardVersion: response?.cardVersion ?? null,
      };
    }

`,
  'bridge matrix save',
);

insertBefore(
  '  async function refreshNativeMatrixViewAfterApply(bridge, options = {}) {',
`  async function persistMainMatrixAfterApply(bridge, result) {
    const acceptedCount = (result?.rows || []).filter(row => row?.status === 'ok').length;
    if (!acceptedCount) {
      return { ok: false, skipped: true, reason: 'no-successful-mutations', acceptedCount: 0 };
    }
    if (!bridge || typeof bridge.saveMainMatrixAfterApply !== 'function') {
      return { ok: false, skipped: false, reason: 'matrix-save-unavailable', acceptedCount };
    }
    try {
      const outcome = await bridge.saveMainMatrixAfterApply();
      return { ...outcome, ok: outcome?.ok !== false, skipped: false, acceptedCount };
    } catch (error) {
      return {
        ok: false,
        skipped: false,
        reason: 'matrix-save-failed',
        acceptedCount,
        error: friendlyErrorMessage(error),
      };
    }
  }

`,
  'post-apply persistence helper',
);

replaceOnce(
`    result.viewRefresh = { ok: false, skipped: true, reason: 'not-attempted' };
    if (!cancelled && result.startedCount > 0) {`,
`    result.matrixSave = await persistMainMatrixAfterApply(bridge, result);
    if (result.matrixSave.ok) {
      log('Основная карточка матрицы сохранена после применения.');
    } else if (!result.matrixSave.skipped) {
      log(\`Строки записаны, но основную карточку матрицы не удалось сохранить автоматически: \${result.matrixSave.error || result.matrixSave.reason}.\`, 'warn');
    }

    result.viewRefresh = { ok: false, skipped: true, reason: 'not-attempted' };
    if (!cancelled && result.startedCount > 0) {`,
  'applyPlan matrix persistence',
);

const finalizeApplyResult = `  function finalizeApplyResult(result, options = {}) {
    const cancelled = Boolean(options.cancelled ?? result?.cancelled);
    result.acceptedCount = (result.rows || []).filter(row => row.status === 'ok').length;
    // Apply accounting and post-write verification are deliberately separate facts.
    result.appliedCount = result.acceptedCount;
    result.verifiedCount = result.reconciliation
      ? Math.min(result.acceptedCount, Math.max(0, Number(result.reconciliation.verifiedCount || 0)))
      : Math.max(0, Number(result.verifiedCount || 0));
    result.storeSkippedCount = (result.rows || []).filter(row => row.status === 'skipped').length;
    result.failedCount = result.storeSkippedCount;
    result.notStartedCount = Math.max(0, Number(result.plannedCount || 0) - Number(result.startedCount || 0));
    result.skippedCount = (result.skipped || []).length;
    const inferredSourceSkipped = (result.skipped || []).filter(item => item?.phase === 'source' || item?.source === 'excel-validation').length;
    const inferredPreflightSkipped = (result.skipped || []).filter(item => item?.phase === 'preflight').length;
    result.sourceSkippedCount = Math.max(0, Number(result.sourceSkippedCount ?? inferredSourceSkipped) || 0);
    result.preflightSkippedCount = Math.max(0, Number(result.preflightSkippedCount ?? inferredPreflightSkipped) || 0);
    result.cancelled = cancelled;
    result.matrixSaveIncomplete = Boolean(result.matrixSave && !result.matrixSave.ok && !result.matrixSave.skipped);
    result.verificationIncomplete = Boolean(result.refreshError || (result.reconciliation
      ? result.reconciliation.status !== 'verified' || result.verifiedCount !== result.acceptedCount
      : result.verificationIncomplete));
    const mutationIncomplete = result.matrixSaveIncomplete
      || result.verificationIncomplete
      || result.preflightSkippedCount > 0
      || result.storeSkippedCount > 0
      || result.failedCount > 0
      || result.notStartedCount > 0;
    result.status = cancelled ? 'cancelled' : (mutationIncomplete ? 'partial' : 'completed');
    result.partial = result.status !== 'completed';
    result.success = result.status === 'completed';
    return result;
  }
`;
replaceRange(
  '  function finalizeApplyResult(result, options = {}) {',
  '\n\n  function applyResultMessage(result) {',
  finalizeApplyResult,
  'finalizeApplyResult',
);

const applyResultMessage = `  function applyResultMessage(result) {
    const applied = Math.max(0, Number(result?.appliedCount || 0));
    const accepted = Math.max(applied, Number(result?.acceptedCount || 0));
    const verified = Math.max(0, Number(result?.verifiedCount ?? result?.reconciliation?.verifiedCount ?? 0));
    const requested = Math.max(applied, Number(result?.requestedCount || result?.plannedCount || applied));
    const sourceSkipped = Math.max(0, Number(result?.sourceSkippedCount || 0));
    const preflightSkipped = Math.max(0, Number(result?.preflightSkippedCount || 0));
    const storeSkipped = Math.max(0, Number(result?.storeSkippedCount || 0));
    const notStarted = Math.max(0, Number(result?.notStartedCount || 0));
    const matrixSaveOk = Boolean(result?.matrixSave?.ok);
    const matrixSaveFailed = Boolean(result?.matrixSaveIncomplete);
    const matrixSaveNote = matrixSaveOk
      ? '\\nОсновная карточка матрицы сохранена.'
      : matrixSaveFailed
        ? '\\nСтроки записаны, но основная карточка матрицы не сохранена автоматически. Нажмите штатную кнопку «Сохранить» в TESSA; повторно Apply по старому Excel не запускайте.'
        : '';
    if (result?.cancelled || result?.status === 'cancelled') {
      return \`Применение остановлено.\\n\\nПрименено: \${applied}\\nНе начато: \${notStarted}\${matrixSaveNote}\\n\\nУже выполненные записи не откатываются. Перед продолжением используйте свежую проверку TESSA.\`;
    }
    if (result?.status === 'completed') {
      const sourceNote = sourceSkipped ? \`\\nЕщё \${sourceSkipped} строк не вошли в Apply и остались без изменений.\` : '';
      const refreshNote = result?.viewRefresh?.ok
        ? '\\nОтображение TESSA обновлено автоматически.'
        : (result?.viewRefresh && !result.viewRefresh.skipped ? '\\nЗапись завершена, но отображение TESSA не удалось обновить автоматически.' : '');
      const verifyNote = result?.reconciliation ? \`\\nПовторная проверка: подтверждено \${verified} из \${accepted}.\` : '';
      return \`Готово. Применено: \${applied} из \${requested}.\\nВсе подготовленные изменения применены.\${matrixSaveNote}\${verifyNote}\${sourceNote}\${result.skippedFields?.length ? \`\\nНе применено отдельных полей: \${result.skippedFields.length}. Причины указаны в отчёте.\` : ''}\${refreshNote}\\nПеред следующим Apply нужна свежая проверка или свежая выгрузка Excel.\`;
    }
    const mutationSkipped = preflightSkipped + storeSkipped;
    if (result?.verificationIncomplete && mutationSkipped === 0 && notStarted === 0 && applied === requested) {
      const verificationState = result?.reconciliation?.status === 'divergent'
        ? 'Повторная проверка обнаружила расхождения'
        : 'Повторная проверка результата не завершена';
      return \`Запись в TESSA завершена: \${applied} из \${requested} операций приняты сервером.\${matrixSaveNote}\\n\\n\${verificationState}: подтверждено \${verified} из \${accepted}.\\nЭто не означает, что применено 0 строк: Apply и последующая read-only проверка учитываются отдельно.\\n\\nНе запускайте тот же Apply повторно по старому Excel. Сначала обновите карточку TESSA или выполните свежую проверку.\`;
    }
    return \`Применение завершено частично.\\n\\nПрименено: \${applied} из \${requested}\\nНе применено после проверки: \${mutationSkipped}\\nНе начато: \${notStarted}\${matrixSaveNote}\${sourceSkipped ? \`\\nОтдельно не вошли в Apply: \${sourceSkipped}\` : ''}\${result?.reconciliation ? \`\\nПовторно подтверждено: \${verified} из \${accepted}\` : ''}\\n\\nПеред следующим Apply выполните свежую проверку.\`;
  }
`;
replaceRange(
  '  function applyResultMessage(result) {',
  '\n\n  /**\n   * Применяет только заранее построенный и прошедший preflight план.',
  applyResultMessage,
  'applyResultMessage',
);

// Support reports are intentionally whitelisted. Extend the safe surface with only
// booleans/reason codes/method names needed to diagnose post-Apply persistence.
const supportFunctions = `  function sanitizeSupportReport(input = {}, options = {}) {
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
        acceptedCount: Number(input.apply.acceptedCount || input.apply.appliedCount || 0),
        verifiedCount: Number(input.apply.verifiedCount || 0),
        failedCount: Number(input.apply.failedCount || 0),
        notStartedCount: Number(input.apply.notStartedCount || 0),
      } : null,
      matrixSave: input.matrixSave ? {
        ok: Boolean(input.matrixSave.ok),
        skipped: Boolean(input.matrixSave.skipped),
        reason: input.matrixSave.reason || null,
        method: input.matrixSave.method || null,
      } : null,
      viewRefresh: input.viewRefresh ? {
        ok: Boolean(input.viewRefresh.ok),
        skipped: Boolean(input.viewRefresh.skipped),
        reason: input.viewRefresh.reason || null,
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

  function buildApplySupportReport(result, capabilities = APP.capabilities, version = APP.version) {
    return sanitizeSupportReport({
      version,
      capabilities,
      apply: result || null,
      matrixSave: result?.matrixSave || null,
      viewRefresh: result?.viewRefresh || null,
      reconciliation: result?.reconciliation || null,
    });
  }
`;
replaceRange(
  '  function sanitizeSupportReport(input = {}, options = {}) {',
  '\n\n  function jsonReplacer(key, value) {',
  supportFunctions,
  'support report whitelist',
);

// Reliable browser download: Chromium may ignore a detached anchor. Attach it for the
// user gesture, click, then remove/revoke asynchronously.
const downloadFunctions = `  function triggerBlobDownload(blob, name, options = {}) {
    const doc = options.document || document;
    const urlApi = options.urlApi || URL;
    const host = doc?.body || doc?.documentElement;
    if (!host || typeof host.appendChild !== 'function') throw new Error('Страница не готова для скачивания файла.');
    const url = urlApi.createObjectURL(blob);
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.rel = 'noopener';
    anchor.hidden = true;
    anchor.style.display = 'none';
    host.appendChild(anchor);
    const cleanup = () => {
      try {
        if (typeof anchor.remove === 'function') anchor.remove();
        else anchor.parentNode?.removeChild?.(anchor);
      } finally {
        urlApi.revokeObjectURL(url);
      }
    };
    try {
      anchor.click();
    } catch (error) {
      cleanup();
      throw error;
    }
    setTimeout(cleanup, Math.max(0, Number(options.cleanupDelayMs ?? 1200)));
    return { ok: true, name };
  }

  function downloadJson(value, name, replacer = jsonReplacer) {
    const blob = new Blob([JSON.stringify(value, replacer, 2)], { type: 'application/json;charset=utf-8' });
    return triggerBlobDownload(blob, name);
  }
`;
replaceRange(
  '  function downloadJson(value, name, replacer = jsonReplacer) {',
  '\n\n  // Отчёты храним в памяти вкладки.',
  downloadFunctions,
  'download helper',
);

// Keep support data after Apply invalidates the stale plan.
replaceOnce(
  '    APP.lastStudioDiagnostics = null;\n    APP.lastReport = null;',
  '    APP.lastStudioDiagnostics = null;\n    APP.lastReport = null;\n    APP.lastSupportReport = null;',
  'reset last support report',
);

// UI wording and behavior: download current preview support before Apply, or immutable
// post-Apply support after APP.plan has intentionally been cleared.
replaceOnce('>Отчёт для поддержки</button>', '>Скачать отчёт для поддержки</button>', 'support button label');
replaceOnce(
`    panel.querySelector('#tms-download-support-report').addEventListener('click', () => {
      if (APP.busy || !APP.plan) return;
      downloadJson(buildPreviewSupportReport(APP.plan, APP.review),
        \`TESSA_Matrix_Support_\${new Date().toISOString().replace(/[:.]/g, '-')}\.json\`, null);
    });`,
`    panel.querySelector('#tms-download-support-report').addEventListener('click', () => {
      if (APP.busy) return;
      const report = APP.plan ? buildPreviewSupportReport(APP.plan, APP.review) : APP.lastSupportReport;
      if (!report) {
        setProgress(100, 'Отчёт пока недоступен', 'Сначала выполните проверку Excel или Apply.');
        return;
      }
      const name = \`TESSA_Matrix_Support_\${new Date().toISOString().replace(/[:.]/g, '-')}\.json\`;
      downloadJson(report, name, null);
      setProgress(100, 'Отчёт скачан', name);
    });`,
  'support button listener',
);

replaceOnce(
`        if (result) {
          invalidatePlanStateAfterApply(APP, result);`,
`        if (result) {
          APP.lastSupportReport = buildApplySupportReport(result, APP.capabilities, APP.version);
          invalidatePlanStateAfterApply(APP, result);`,
  'persist post-apply support report',
);

// Progress explicitly distinguishes saving the matrix from merely refreshing the view.
replaceOnce(
  "    if (result.viewRefresh?.ok) progressParts.push('отображение TESSA обновлено');",
  "    if (result.matrixSave?.ok) progressParts.push('матрица сохранена');\n    else if (result.matrixSaveIncomplete) progressParts.push('матрица требует сохранения');\n    if (result.viewRefresh?.ok) progressParts.push('отображение TESSA обновлено');",
  'progress matrix save status',
);

// Test exports.
replaceOnce(
  'rememberReport, downloadLastReport, reconciliationSummary, renderReconciliationResult, sanitizeSupportReport,',
  'rememberReport, downloadLastReport, triggerBlobDownload, downloadJson, reconciliationSummary, renderReconciliationResult, sanitizeSupportReport, buildApplySupportReport,',
  'support exports',
);
replaceOnce(
  'previewPreflightPolicy, isWriterLockError, refreshNativeMatrixViewAfterApply, finalizeApplyResult, applyResultMessage,',
  'previewPreflightPolicy, isWriterLockError, persistMainMatrixAfterApply, refreshNativeMatrixViewAfterApply, finalizeApplyResult, applyResultMessage,',
  'persistence export',
);

fs.writeFileSync(file, code);
console.log('Applied v1.12.1 post-Apply persistence/support fix');
