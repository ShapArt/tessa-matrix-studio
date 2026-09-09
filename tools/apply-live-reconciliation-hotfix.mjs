import fs from 'node:fs';

const file = new URL('../tessa-matrix-studio.user.js', import.meta.url);
let code = fs.readFileSync(file, 'utf8');

function replaceBlock(startMarker, endMarker, replacement) {
  const start = code.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  const end = code.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found after: ${startMarker}`);
  code = code.slice(0, start) + replacement + code.slice(end);
}

const reconciliationBlock = `  function isNativeIdentitySnapshotError(error) {
    const text = String(error?.message || error || '');
    return /Нативное представление TESSA вернуло|MatrixRowID|скрытые MatrixRowID\\/MatrixVersionID/i.test(text);
  }

  async function buildTargetedReconciliationSnapshot(bridge, receiptContext, structure) {
    const receipts = receiptContext?.receipts || [];
    const rawLinks = typeof bridge?.rawMatrixSectionLinks === 'function' ? bridge.rawMatrixSectionLinks() : [];
    const membershipVersions = new Set();
    const rememberVersion = value => {
      const key = canonicalValue(value || '');
      if (key) membershipVersions.add(key);
    };
    for (const raw of rawLinks) {
      // RowID/RowRowID are never used as CardID. For reconciliation they are safe only
      // as membership/version evidence, exactly like resolveMatrixSectionLinks already does.
      rememberVersion(raw?.rowRowID);
      rememberVersion(raw?.rowID);
      rememberVersion(raw?.cardRowId);
    }

    // The native view may still contain most usable identities even when one unrelated
    // row has no MatrixRowID. Add those VersionIDs to membership without requiring a
    // complete view. Known CardID for CardGet always comes from the mutation receipt.
    if (typeof bridge?.collectNativeMatrixViewLinksAllPages === 'function') {
      try {
        const native = await bridge.collectNativeMatrixViewLinksAllPages();
        for (const link of native?.links || []) rememberVersion(link?.versionId);
      } catch (error) {
        log(\`Точечная проверка: нативное представление прочитано не полностью: \${error.message || error}.\`, 'warn');
      }
    }

    if (!rawLinks.length && !membershipVersions.size && receipts.length) {
      throw new Error('Точечная проверка не получила состав матрицы TESSA.');
    }

    const rows = [];
    for (const receipt of receipts) {
      const versionKey = canonicalValue(receipt?.versionId || '');
      if (!versionKey) continue;
      const isMember = membershipVersions.has(versionKey);

      if (receipt?.type === 'delete') {
        // Existing membership is enough to prove a failed DELETE; absence means the
        // deleted version is no longer attached to this matrix. No CardGet is needed.
        if (isMember) rows.push({
          rowCardId: receipt.rowCardId || null,
          versionId: receipt.versionId,
          values: {}, roles: {}, flat: {},
        });
        continue;
      }

      if (!isMember || !receipt?.rowCardId) continue;
      const card = await bridge.getCard(receipt.rowCardId);
      rows.push(bridge.readMatrixRowFromCard(card, {
        index: -1,
        rowCardId: receipt.rowCardId,
        versionId: receipt.versionId,
        rowName: receipt.excelRow ? \`Excel \${receipt.excelRow}\` : 'Проверяемая строка',
        source: 'reconcile-targeted-receipts',
      }, structure));
    }

    return {
      matrixId: String(bridge?.mainCard?.id || ''),
      templateId: structure?.templateId || receiptContext?.templateId || '',
      rows,
    };
  }

  async function runReconciliationRead(bridgeFactory, receiptContext, options = {}) {
    const maxAttempts = Math.max(1, Math.min(5, Number(options.attempts) || 3));
    const baseDelayMs = Math.max(0, Number(options.baseDelayMs ?? 450));
    const startedAt = nowIso();
    let lastError = null;
    let usedAttempts = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      usedAttempts = attempt;
      if (attempt > 1 && baseDelayMs) await sleep(baseDelayMs * (2 ** (attempt - 2)));
      try {
        const bridge = await bridgeFactory();
        const structure = await bridge.requestStructure(receiptContext.templateId);
        const expectedMatrixId = canonicalValue(receiptContext?.matrixId || '');
        const actualMatrixId = canonicalValue(bridge?.mainCard?.id || '');
        const expectedTemplateId = canonicalValue(receiptContext?.templateId || '');
        const actualTemplateId = canonicalValue(bridge?.templateId?.() || structure?.templateId || '');
        if (!expectedMatrixId || actualMatrixId !== expectedMatrixId
          || !expectedTemplateId || actualTemplateId !== expectedTemplateId) {
          return {
            status: 'incomplete',
            checkedCount: 0,
            verifiedCount: 0,
            divergentCount: 0,
            missingCount: 0,
            unknownCount: receiptContext?.receipts?.length || 0,
            rows: [],
            attempts: attempt,
            retryable: false,
            reasonCode: 'reconcile-context-mismatch',
            startedAt,
            finishedAt: nowIso(),
          };
        }

        try {
          const snapshot = await bridge.loadSnapshot(structure);
          return {
            ...reconcileMutationReceipts(receiptContext?.receipts || [], snapshot, structure),
            mode: 'full-snapshot',
            attempts: attempt,
            retryable: false,
            startedAt,
            finishedAt: nowIso(),
          };
        } catch (error) {
          if (isWriterLockError(error) || !isNativeIdentitySnapshotError(error)) throw error;
          log(\`Полный снимок для проверки результата недоступен: \${error.message || error}. Проверяю только изменённые строки по receipt ID.\`, 'warn');
          const targeted = await buildTargetedReconciliationSnapshot(bridge, receiptContext, structure);
          return {
            ...reconcileMutationReceipts(receiptContext?.receipts || [], targeted, structure),
            mode: 'targeted-receipts',
            fallbackReasonCode: 'reconcile-full-snapshot-failed',
            attempts: attempt,
            retryable: false,
            startedAt,
            finishedAt: nowIso(),
          };
        }
      } catch (error) {
        lastError = error;
        if (!isWriterLockError(error) || attempt === maxAttempts) break;
      }
    }
    const retryable = isWriterLockError(lastError);
    return {
      status: 'incomplete',
      checkedCount: 0,
      verifiedCount: 0,
      divergentCount: 0,
      missingCount: 0,
      unknownCount: receiptContext?.receipts?.length || 0,
      rows: [],
      attempts: usedAttempts,
      retryable,
      reasonCode: retryable ? 'reconcile-writer-lock' : 'reconcile-read-failed',
      error: lastError?.message || String(lastError || ''),
      startedAt,
      finishedAt: nowIso(),
    };
  }
`;

replaceBlock(
  '  async function runReconciliationRead(bridgeFactory, receiptContext, options = {}) {',
  '\n\n  function deletionGuard(plan) {',
  reconciliationBlock,
);

const finalizeBlock = `  function finalizeApplyResult(result, options = {}) {
    const cancelled = Boolean(options.cancelled ?? result?.cancelled);
    result.acceptedCount = (result.rows || []).filter(row => row.status === 'ok').length;
    // Keep the pre-1.12 Apply contract: appliedCount describes mutations that TESSA
    // accepted without a validation/store/delete error. Readback is a separate layer.
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
    result.verificationIncomplete = Boolean(result.refreshError || (result.reconciliation
      ? result.reconciliation.status !== 'verified' || result.verifiedCount !== result.acceptedCount
      : result.verificationIncomplete));
    const mutationIncomplete = result.verificationIncomplete
      || result.preflightSkippedCount > 0
      || result.storeSkippedCount > 0
      || result.failedCount > 0
      || result.notStartedCount > 0;
    result.status = cancelled ? 'cancelled' : (mutationIncomplete ? 'partial' : 'completed');
    result.partial = result.status !== 'completed';
    result.success = result.status === 'completed';
    return result;
  }`;
replaceBlock(
  '  function finalizeApplyResult(result, options = {}) {',
  '\n\n  function applyResultMessage(result) {',
  finalizeBlock,
);

const messageBlock = `  function applyResultMessage(result) {
    const applied = Math.max(0, Number(result?.appliedCount || 0));
    const accepted = Math.max(applied, Number(result?.acceptedCount || 0));
    const verified = Math.max(0, Number(result?.verifiedCount ?? result?.reconciliation?.verifiedCount ?? 0));
    const requested = Math.max(applied, Number(result?.requestedCount || result?.plannedCount || applied));
    const sourceSkipped = Math.max(0, Number(result?.sourceSkippedCount || 0));
    const preflightSkipped = Math.max(0, Number(result?.preflightSkippedCount || 0));
    const storeSkipped = Math.max(0, Number(result?.storeSkippedCount || 0));
    const notStarted = Math.max(0, Number(result?.notStartedCount || 0));
    if (result?.cancelled || result?.status === 'cancelled') {
      return \`Применение остановлено.\n\nПрименено: \${applied}\nНе начато: \${notStarted}\n\nУже выполненные записи не откатываются. Перед продолжением используйте свежую проверку TESSA.\`;
    }
    if (result?.status === 'completed') {
      const sourceNote = sourceSkipped ? \`\nЕщё \${sourceSkipped} строк не вошли в Apply и остались без изменений.\` : '';
      const refreshNote = result?.viewRefresh?.ok
        ? '\\nОтображение TESSA обновлено автоматически.'
        : (result?.viewRefresh && !result.viewRefresh.skipped ? '\\nЗапись завершена, но отображение TESSA не удалось обновить автоматически.' : '');
      const verifyNote = result?.reconciliation ? \`\nПовторная проверка: подтверждено \${verified} из \${accepted}.\` : '';
      return \`Готово. Применено: \${applied} из \${requested}.\nВсе подготовленные изменения применены.\${verifyNote}\${sourceNote}\${result.skippedFields?.length ? \`\\nНе применено отдельных полей: \${result.skippedFields.length}. Причины указаны в отчёте.\` : ''}\${refreshNote}\nПеред следующим Apply нужна свежая проверка или свежая выгрузка Excel.\`;
    }
    const mutationSkipped = preflightSkipped + storeSkipped;
    if (result?.verificationIncomplete && mutationSkipped === 0 && notStarted === 0 && applied === requested) {
      const verificationState = result?.reconciliation?.status === 'divergent'
        ? 'Повторная проверка обнаружила расхождения'
        : 'Повторная проверка результата не завершена';
      return \`Запись в TESSA завершена: \${applied} из \${requested} операций приняты сервером.\n\n\${verificationState}: подтверждено \${verified} из \${accepted}.\nЭто не означает, что применено 0 строк: Apply и последующая read-only проверка учитываются отдельно.\n\nНе запускайте тот же Apply повторно по старому Excel. Сначала обновите карточку TESSA или выполните свежую проверку.\`;
    }
    return \`Применение завершено частично.\n\nПрименено: \${applied} из \${requested}\nНе применено после проверки: \${mutationSkipped}\nНе начато: \${notStarted}\${sourceSkipped ? \`\nОтдельно не вошли в Apply: \${sourceSkipped}\` : ''}\${result?.reconciliation ? \`\nПовторно подтверждено: \${verified} из \${accepted}\` : ''}\n\nПеред следующим Apply выполните свежую проверку.\`;
  }`;
replaceBlock(
  '  function applyResultMessage(result) {',
  '\n\n  /**\n   * Применяет только заранее построенный и прошедший preflight план.',
  messageBlock,
);

fs.writeFileSync(file, code);
console.log('Applied live reconciliation/accounting hotfix');
