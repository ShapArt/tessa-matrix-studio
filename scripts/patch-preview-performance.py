from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')


def one(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one marker, got {count}')
    text = text.replace(old, new, 1)


def between(start: str, end: str, replacement: str, label: str) -> None:
    global text
    a = text.find(start)
    if a < 0:
        raise SystemExit(f'{label}: start marker missing')
    b = text.find(end, a)
    if b < 0:
        raise SystemExit(f'{label}: end marker missing')
    text = text[:a] + replacement + text[b:]


one(
    '    SnapshotCardGetConcurrency: 6,\n    PreviewSnapshotTtlMs:',
    '    SnapshotCardGetConcurrency: 6,\n    PreflightAddConcurrency: 4,\n    PreviewSnapshotTtlMs:',
    'PreflightAddConcurrency',
)
one(
    '    PreviewSnapshotTtlMs: 15 * 60 * 1000,\n    ZipConcurrency: 4,',
    '    PreviewSnapshotTtlMs: 15 * 60 * 1000,\n    PreviewYieldDeadlineMs: 40,\n    ZipConcurrency: 4,',
    'PreviewYieldDeadlineMs',
)

helper_marker = '  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));\n\n  function requestApplyAbort() {'
helpers = '''  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const monotonicNow = () => Number(globalThis.performance?.now?.() ?? Date.now());

  async function yieldToMain() {
    if (globalThis.scheduler?.yield) {
      await globalThis.scheduler.yield();
      return;
    }
    await sleep(0);
  }

  function estimateRemainingMs({ completed, total, elapsedMs }) {
    const done = Math.max(0, Number(completed) || 0);
    const size = Math.max(0, Number(total) || 0);
    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    if (!size || done <= 0 || elapsed <= 0) return null;
    if (done >= size) return 0;
    return Math.max(0, Math.round((elapsed / done) * (size - done)));
  }

  function formatEtaMs(ms) {
    const value = Math.max(0, Number(ms) || 0);
    if (value < 5000) return 'меньше 5 сек';
    const totalSeconds = Math.max(1, Math.round(value / 1000));
    if (totalSeconds < 60) return `${totalSeconds} сек`;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (totalMinutes < 60) return seconds ? `${totalMinutes} мин ${seconds} сек` : `${totalMinutes} мин`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `${hours} ч ${minutes} мин` : `${hours} ч`;
  }

  function formatProgressCount(value) {
    return String(Math.max(0, Math.trunc(Number(value) || 0))).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ' ');
  }

  function workProgressDetail({ completed, total, elapsedMs }) {
    const done = Math.max(0, Number(completed) || 0);
    const size = Math.max(0, Number(total) || 0);
    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    let tail = 'оцениваю время…';
    if (done >= size && size > 0) {
      tail = 'готово';
    } else if (done >= 5 && elapsed >= 500) {
      const eta = estimateRemainingMs({ completed: done, total: size, elapsedMs: elapsed });
      if (eta !== null) tail = `~${formatEtaMs(eta)} осталось`;
    }
    return `${formatProgressCount(done)} из ${formatProgressCount(size)} · ${tail}`;
  }

  function requestApplyAbort() {'''
one(helper_marker, helpers, 'ETA helpers')

for index, (old, new) in enumerate([
    ("setProgress(8, 'Читаю Excel', file.name);", "setProgress(5, '1/6 · Читаю Excel', file.name);"),
    ("setProgress(22, 'Excel прочитан', `${workbook.rows.length} строк данных`);", "setProgress(18, '1/6 · Excel прочитан', `${workbook.rows.length} строк данных`);"),
    ("setProgress(30, 'Подключаюсь к TESSA', 'Проверяю открытую матрицу');", "setProgress(22, '2/6 · Подключаюсь к TESSA', 'Проверяю открытую матрицу');"),
    ("setProgress(42, 'Читаю структуру TESSA', 'Критерии и функции');", "setProgress(32, '3/6 · Читаю структуру TESSA', 'Критерии и функции');"),
    ("setProgress(canReuseSnapshot ? 58 : 52, canReuseSnapshot ? 'Использую свежий снимок' : 'Читаю строки TESSA', canReuseSnapshot ? 'Повторная загрузка не нужна' : 'Сверяю текущие строки');", "setProgress(canReuseSnapshot ? 48 : 40, canReuseSnapshot ? '3/6 · Использую свежий снимок' : '3/6 · Читаю строки TESSA', canReuseSnapshot ? 'Повторная загрузка не нужна' : 'Сверяю текущие строки');"),
    ("setProgress(72, 'Сопоставляю Excel и TESSA', `${snapshot.rows.length} строк в TESSA`);", "setProgress(55, '4/6 · Сопоставляю Excel и TESSA', `${snapshot.rows.length} строк в TESSA`);"),
    ("setProgress(88, 'Проверяю безопасность', 'Дубли, права, удаления и неоднозначности');", "setProgress(62, '5/6 · Проверяю безопасность', 'Дубли, права, удаления и неоднозначности');"),
], start=1):
    one(old, new, f'analyze stage {index}')

preview_start = "    let previewPlan = plan;\n    if (!plan.safety.blocked && plan.actions.some(action => action.type !== 'noop')) {"
preview_end = '    APP.workbook = workbook;'
preview_block = '''    let previewPlan = plan;
    if (!plan.safety.blocked && plan.actions.some(action => action.type !== 'noop')) {
      const previewPolicy = previewPreflightPolicy(plan.actions);
      if (previewPolicy.skipServerAddValidation) log(previewPolicy.reason, 'warn');
      const previewProgress = (phasePercent, label, detail = '') => {
        const bounded = Math.max(10, Math.min(42, Number(phasePercent) || 10));
        const percent = 70 + Math.round(((bounded - 10) / 32) * 28);
        setProgress(percent, `6/6 · ${label}`, detail);
      };
      setProgress(70, '6/6 · Проверяю применимость', previewPolicy.skipServerAddValidation
        ? 'Большой пакет: быстрый локальный Preview без тысяч лишних CardNew/duplicate запросов'
        : 'Справочники, дубли и зависимости перед Apply');
      const previewPreflight = await preflightPlan(plan, { previewOnly: true, bridge, structure, onProgress: previewProgress });
      previewPlan = applyPreflightPreview(plan, previewPreflight);
      if (previewPlan.preflightPreview.runtimeSkipCount) {
        log(`Предварительная проверка: ${previewPlan.preflightPreview.runtimeSkipCount} операций заранее переведены в ПРОПУСТИТЬ.`, 'warn');
      }
    }
'''
between(preview_start, preview_end, preview_block, 'analyze Preview block')

one(
    '    const warnings = [...(plan.warnings || [])];\n    if (runtimeSkipCount) {\n      warnings.push(`Предварительная проверка до Apply: ${runtimeSkipCount} операций переведены в ПРОПУСТИТЬ. Причины показаны выше.`);\n    }\n    return {',
    '    const warnings = [...(plan.warnings || [])];\n    if (runtimeSkipCount) {\n      warnings.push(`Предварительная проверка до Apply: ${runtimeSkipCount} операций переведены в ПРОПУСТИТЬ. Причины показаны выше.`);\n    }\n    const serverAddValidationSkipped = Boolean(preflight?.previewPolicy?.skipServerAddValidation);\n    if (serverAddValidationSkipped && preflight?.previewPolicy?.reason) warnings.push(preflight.previewPolicy.reason);\n    return {',
    'preview projection warning',
)
one(
    "        executableCount: actions.filter(action => action.type !== 'noop').length,\n        validatedAt: nowIso(),",
    "        executableCount: actions.filter(action => action.type !== 'noop').length,\n        serverAddValidationSkipped,\n        applyBlockedByBatch: Boolean(preflight?.previewPolicy?.applyBlocked),\n        validatedAt: nowIso(),",
    'preview projection metadata',
)

preflight_header_old = """  async function preflightPlan(plan, options = {}) {
    const previewOnly = Boolean(options.previewOnly);
    const preflightProgress = previewOnly ? () => {} : setProgress;
    preflightProgress(10, 'Предварительная проверка', 'Перечитываю матрицу перед записью');"""
preflight_header_new = """  async function preflightPlan(plan, options = {}) {
    const previewOnly = Boolean(options.previewOnly);
    const preflightProgress = typeof options.onProgress === 'function'
      ? options.onProgress
      : (previewOnly ? () => {} : setProgress);
    const previewPolicy = previewOnly
      ? previewPreflightPolicy(plan?.actions || [])
      : { applyBlocked: false, skipServerAddValidation: false, reason: null };
    const skipServerAddValidation = Boolean(previewPolicy.skipServerAddValidation);
    preflightProgress(10, 'Предварительная проверка', 'Перечитываю матрицу перед записью');"""
one(preflight_header_old, preflight_header_new, 'preflight header')

add_start = '    // ADD: если конкретная новая строка не проходит справочник/дубликат/тип — пропускаем её.'
add_end = '    // DELETE тоже проверяется по fingerprint отдельно.'
add_block = '''    // ADD: локальные справочники/типы проверяются всегда. Серверный CardNew +
    // ValidateDuplicate нужен для применяемых пакетов, но для Preview >2000 он только
    // создаёт тысячи сетевых запросов к пакету, который всё равно нельзя Apply.
    const addActions = plan.actions.filter(x => x.type === 'add');
    let createCapabilityError = null;
    if (addActions.length && !skipServerAddValidation) {
      try { bridge.assertCanCreateRows(); } catch (error) { createCapabilityError = error; }
    }
    const addStartedAt = monotonicNow();
    let completedAdds = 0;
    let lastYieldAt = addStartedAt;

    const validateAddAction = async action => {
      try {
        if (!skipServerAddValidation && createCapabilityError) throw createCapabilityError;
        if (action.match?.matchedBy === 'copied-row-auto-add') {
          const sourceVersionId = canonicalValue(action.match.sourceVersionId || '');
          const sourceRowCardId = canonicalValue(action.match.sourceRowCardId || '');
          const sourceCurrent = (sourceVersionId ? freshByVersion.get(sourceVersionId) : null)
            || (sourceRowCardId ? freshByCard.get(sourceRowCardId) : null);
          if (!sourceCurrent) throw new Error(`Исходная строка Excel ${action.excelRow.excelRow} исчезла после предпросмотра.`);
          const sourceExpectedFingerprint = canonicalValue(action.match.sourceFingerprint || '');
          const sourceFreshFingerprint = canonicalValue(sourceCurrent.fingerprint || fingerprintFlat(sourceCurrent.flat || {}));
          if (!sourceExpectedFingerprint || sourceExpectedFingerprint !== sourceFreshFingerprint) {
            throw new Error(`Исходная строка Excel ${action.excelRow.excelRow} изменилась в TESSA после предпросмотра.`);
          }
        }
        await hydrateMissingIdsForAction(action, structure, fresh, bridge);
        for (const condition of structure.conditions) {
          const column = action.excelRow.columns.get(condition.criterionRowId);
          if (!column) continue;
          const displays = action.excelRow.flat[column.key] || [];
          const ids = action.excelRow.ids[column.key] || [];
          displays.forEach((display, i) => bridge.resolveCriterion(condition, display, ids[i] || null, fresh));
        }
        let roleCount = 0;
        for (const fn of structure.functions) {
          const column = action.excelRow.columns.get(fn.id);
          if (!column) continue;
          const displays = action.excelRow.flat[column.key] || [];
          const ids = action.excelRow.ids[column.key] || [];
          displays.forEach((display, i) => { bridge.resolveRole(fn, display, ids[i] || null, fresh); roleCount += 1; });
        }
        if (!roleCount) throw new Error(`В строке Excel ${action.excelRow.excelRow} не указан ни один исполнитель.`);
        if (skipServerAddValidation) return { action, prepared: { action, previewLocalOnly: true } };
        const created = await bridge.createRowCard(structure.templateId);
        log(`Подготавливаю новую строку Excel ${action.excelRow.excelRow} через CardService.${created.newMethod}`);
        bridge.rebuildRowCard(created.card, created.versionId, action.excelRow, structure, fresh);
        await bridge.validateDuplicate(created.card, created.versionId);
        return { action, prepared: { action, ...created } };
      } catch (error) {
        return { action, error };
      }
    };

    const recordAddResult = result => {
      if (!result?.error) {
        preparedAdds.set(result.action.excelRow.excelRow, result.prepared);
        return;
      }
      const excelRow = Number(result.action?.excelRow?.excelRow);
      if (Number.isFinite(excelRow)) failedMutationRows.add(excelRow);
      runtimeSkippedActions.add(result.action);
      runtimeSkips.push(runtimeSkip(result.action, result.error, 'preflight-add'));
    };

    const reportAddProgress = () => {
      completedAdds += 1;
      const elapsedMs = Math.max(0, monotonicNow() - addStartedAt);
      const percent = addActions.length ? 28 + Math.round((completedAdds / addActions.length) * 8) : 36;
      preflightProgress(percent,
        skipServerAddValidation ? 'Быстрый Preview новых строк' : 'Проверяю новые строки',
        workProgressDetail({ completed: completedAdds, total: addActions.length, elapsedMs }));
    };

    if (skipServerAddValidation) {
      for (const action of addActions) {
        recordAddResult(await validateAddAction(action));
        reportAddProgress();
        const current = monotonicNow();
        if (current - lastYieldAt >= PERFORMANCE.PreviewYieldDeadlineMs) {
          await yieldToMain();
          lastYieldAt = monotonicNow();
        }
      }
    } else {
      const results = await mapConcurrent(addActions, PERFORMANCE.PreflightAddConcurrency, async action => {
        const result = await validateAddAction(action);
        reportAddProgress();
        return result;
      });
      results.forEach(recordAddResult);
    }

    preflightProgress(36,
      skipServerAddValidation ? 'Быстрый Preview новых строк завершён' : 'Проверяю новые строки',
      workProgressDetail({ completed: addActions.length, total: addActions.length, elapsedMs: Math.max(0, monotonicNow() - addStartedAt) }));

'''
between(add_start, add_end, add_block, 'ADD preflight block')

one(
    "    preflightProgress(42, 'Предварительная проверка завершена', `Готово к записи: ${preparedUpdates.size + preparedAdds.size + readyDeletes.length}`);\n    return { bridge, structure, fresh, preparedUpdates, preparedAdds, readyDeletes, runtimeSkips, runtimeSkippedActions };",
    "    preflightProgress(42,\n      skipServerAddValidation ? 'Быстрый Preview завершён' : 'Предварительная проверка завершена',\n      skipServerAddValidation\n        ? `Локально проверено: ${preparedUpdates.size + preparedAdds.size + readyDeletes.length} · глубокая ADD-проверка будет после разделения пакета`\n        : `Готово к записи: ${preparedUpdates.size + preparedAdds.size + readyDeletes.length}`);\n    return { bridge, structure, fresh, preparedUpdates, preparedAdds, readyDeletes, runtimeSkips, runtimeSkippedActions, previewPolicy };",
    'preflight return',
)

policy_anchor = '''  /**
   * Финализирует отчёт Apply так, чтобы два уровня счётчиков можно было сверить:'''
policy = '''  function previewPreflightPolicy(actions) {
    const batch = evaluateApplyBatch(actions);
    const skipServerAddValidation = Boolean(batch.blocked);
    const reason = skipServerAddValidation
      ? `Большой локальный Preview: ${batch.count} операций. Пакет всё равно заблокирован для Apply (>2000), поэтому тысячи CardNew/duplicate-запросов для ADD в Preview не выполняются. Разделите пакет до 2000 операций — каждая применяемая часть пройдёт глубокую серверную проверку перед записью.`
      : null;
    return { applyBlocked: batch.blocked, skipServerAddValidation, count: batch.count, reason };
  }

'''
one(policy_anchor, policy + policy_anchor, 'preview policy insertion')

one(
    '    normalizeSpace, isOverwriteMatch, stripFormulaMarker, canonicalHeader, canonicalValue, definitionKey, splitCell, mapConcurrent,',
    '    normalizeSpace, isOverwriteMatch, stripFormulaMarker, canonicalHeader, canonicalValue, definitionKey, splitCell, mapConcurrent, yieldToMain, estimateRemainingMs, formatEtaMs, workProgressDetail,',
    'helper exports',
)
one(
    '    parseBoolean, parseRange, headerSimilarity, countActions, matrixStateCaption, operandKind, typedScalarSemantic, typedRangeSemantic, deletionGuard, evaluateApplyBatch, finalizeApplyResult, applyResultMessage,',
    '    parseBoolean, parseRange, headerSimilarity, countActions, matrixStateCaption, operandKind, typedScalarSemantic, typedRangeSemantic, deletionGuard, evaluateApplyBatch, previewPreflightPolicy, finalizeApplyResult, applyResultMessage,',
    'policy export',
)

path.write_text(text, encoding='utf-8')
print('Preview performance patch applied.')
