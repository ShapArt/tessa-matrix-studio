import fs from 'node:fs';

const file = 'tessa-matrix-studio.user.js';
let code = fs.readFileSync(file, 'utf8');

function replaceOnce(label, before, after) {
  const first = code.indexOf(before);
  if (first < 0) throw new Error(`${label}: source block not found`);
  if (code.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: source block is not unique`);
  code = code.replace(before, after);
}

replaceOnce('insert duplicate localizer', `  function issueExcelRows(issue) {`, `  // Duplicate conflicts are row-local whenever the conflicting mutation can be
  // identified by its Excel row. Removing one bad mutation can reveal another
  // duplicate against the unchanged TESSA snapshot, so prune to a fixed point.
  // Conflicts that cannot be mapped back to an executable Excel mutation remain
  // unresolved and are allowed to keep the global safety gate fail-closed.
  function localizeDuplicateConflicts(actions, skippedRows, snapshot, structure, source = 'duplicate-validation') {
    let remaining = [...(actions || [])];
    const skipped = [...(skippedRows || [])];
    const localizedIssues = [];
    let unresolvedIssues = [];
    const maxPasses = Math.max(1, remaining.filter(action => action?.type && action.type !== 'noop').length + 1);

    for (let pass = 0; pass < maxPasses; pass += 1) {
      const issues = detectPlanDuplicateConflicts(remaining.filter(action => action?.type !== 'noop'), snapshot, structure);
      if (!issues.length) return { actions: remaining, skippedRows: skipped, localizedIssues, unresolvedIssues: [] };

      const executableByRow = new Map();
      for (const action of remaining) {
        if (!action?.type || action.type === 'noop') continue;
        const rowNumber = Number(action.excelRow?.excelRow);
        if (Number.isFinite(rowNumber) && rowNumber > 0) executableByRow.set(rowNumber, action);
      }

      const reasonsByRow = new Map();
      unresolvedIssues = [];
      for (const issue of issues) {
        const rows = issueExcelRows(issue).filter(rowNumber => executableByRow.has(rowNumber));
        if (!rows.length) {
          unresolvedIssues.push(issue);
          continue;
        }
        localizedIssues.push(issue);
        for (const rowNumber of rows) {
          if (!reasonsByRow.has(rowNumber)) reasonsByRow.set(rowNumber, []);
          reasonsByRow.get(rowNumber).push(issue);
        }
      }

      if (!reasonsByRow.size) {
        return { actions: remaining, skippedRows: skipped, localizedIssues, unresolvedIssues: [...new Set(unresolvedIssues.length ? unresolvedIssues : issues)] };
      }

      const removedRows = new Set();
      remaining = remaining.filter(action => {
        if (!action?.type || action.type === 'noop') return true;
        const rowNumber = Number(action.excelRow?.excelRow);
        if (!Number.isFinite(rowNumber) || !reasonsByRow.has(rowNumber)) return true;
        removedRows.add(rowNumber);
        return false;
      });
      for (const rowNumber of removedRows) {
        const action = executableByRow.get(rowNumber);
        const reasons = [...new Set(reasonsByRow.get(rowNumber) || [])];
        skipped.push(makeSkippedRow(rowNumber, reasons.join(' '), source, action?.type || null));
      }
    }

    const tail = detectPlanDuplicateConflicts(remaining.filter(action => action?.type !== 'noop'), snapshot, structure);
    return {
      actions: remaining,
      skippedRows: skipped,
      localizedIssues: [...new Set(localizedIssues)],
      unresolvedIssues: [...new Set([...unresolvedIssues, ...tail])],
    };
  }

  function issueExcelRows(issue) {`);

replaceOnce('planner duplicate block', `    // Дубликаты после применения тоже локальны: пропускаем только изменяемые Excel-строки,
    // которые образуют конфликт, а не весь файл.
    const duplicateIssues = detectPlanDuplicateConflicts(actions, snapshot, structure);
    if (duplicateIssues.length) {
      const duplicateRows = new Set();
      for (const issue of duplicateIssues) issueExcelRows(issue).forEach(rowNumber => duplicateRows.add(rowNumber));
      actions = actions.filter(action => {
        const rowNumber = action.excelRow?.excelRow;
        if (!rowNumber || !duplicateRows.has(rowNumber)) return true;
        const reasons = duplicateIssues.filter(issue => issueExcelRows(issue).includes(rowNumber));
        skippedRows.push(makeSkippedRow(rowNumber, reasons.join(' '), 'duplicate-validation', action.type));
        return false;
      });
    }
`, `    // Дубликаты локализуются до устойчивого состояния. Это важно для каскада:
    // пропуск одного конфликтующего UPDATE может вернуть исходную строку TESSA и тем
    // самым обнаружить дубль у следующего ADD. Весь корректный пакет при этом живёт.
    const localizedDuplicates = localizeDuplicateConflicts(actions, skippedRows, snapshot, structure);
    actions = localizedDuplicates.actions;
    skippedRows.length = 0;
    skippedRows.push(...localizedDuplicates.skippedRows);
    // В обычном Planner каждый duplicate issue содержит изменяемую Excel-строку.
    // Если это когда-либо перестанет быть так, не угадываем: превращаем в fatal issue.
    fatalIssues.push(...localizedDuplicates.unresolvedIssues);
`);

replaceOnce('review actions mutable', `    const actions = (plan.actions || []).map(action => {`, `    let actions = (plan.actions || []).map(action => {`);

replaceOnce('review duplicate block', `    // Частичная отмена меняет итоговую строку, поэтому заново проверяем дубли.
    // Иначе пользователь мог бы убрать одно поле и случайно собрать комбинацию,
    // уже существующую в другой строке TESSA.
    const duplicateIssues = detectPlanDuplicateConflicts(actions.filter(action => action.type !== 'noop'), plan.snapshot, plan.structure);
    const safety = plan.safety
      ? { ...plan.safety, blockedReasons: [...(plan.safety.blockedReasons || [])] }
      : { blocked: false, blockedReasons: [] };
    if (duplicateIssues.length) {
      safety.blocked = true;
      safety.blockedReasons = [...new Set([...safety.blockedReasons, ...duplicateIssues])];
    }
    reviewed.safety = safety;
    reviewed.reviewIssues = duplicateIssues;
    return reviewed;
  }
`, `    // Частичная отмена тоже может собрать дубль. Как и Planner, локализуем только
    // конфликтующую Excel-операцию и продолжаем с остальными. Повторяем проверку до
    // устойчивого состояния, потому что один локальный SKIP может открыть следующий.
    const localizedDuplicates = localizeDuplicateConflicts(actions, plan.skippedRows || [], plan.snapshot, plan.structure);
    actions = localizedDuplicates.actions;
    reviewed.actions = actions;
    reviewed.skippedRows = localizedDuplicates.skippedRows;
    reviewed.counts = countActions(actions, reviewed.skippedRows);
    const safety = plan.safety
      ? { ...plan.safety, blockedReasons: [...(plan.safety.blockedReasons || [])] }
      : { blocked: false, blockedReasons: [] };
    if (localizedDuplicates.unresolvedIssues.length) {
      safety.blocked = true;
      safety.blockedReasons = [...new Set([...safety.blockedReasons, ...localizedDuplicates.unresolvedIssues])];
    }
    reviewed.safety = safety;
    reviewed.reviewIssues = [...new Set([...localizedDuplicates.localizedIssues, ...localizedDuplicates.unresolvedIssues])];
    return reviewed;
  }
`);

replaceOnce('apply availability helper', `  function applyAvailability(plan, review = null) {
    const reviewed = buildReviewedPlan(plan, review);
    const safety = reviewed?.safety || plan?.safety || { blocked: false, blockedReasons: [] };
    const batch = evaluateApplyBatch(reviewed?.actions || []);
    const safetyReasons = safety.blocked ? [...(safety.blockedReasons || [])] : [];
    const blockedReasons = batch.blocked ? [...safetyReasons, batch.reason].filter(Boolean) : safetyReasons;
    const blocked = Boolean(safety.blocked || batch.blocked);
    const canApply = Boolean(batch.count > 0 && !blocked);
    const label = batch.blocked
      ? \`Пакет слишком большой · \${batch.count} / 2000\`
      : batch.count
        ? \`Применить к TESSA · \${batch.count}\`
        : 'Применить к TESSA';
    return {
      count: batch.count,
      warning: batch.warning,
      blocked,
      batchBlocked: batch.blocked,
      canApply,
      reason: batch.blocked ? batch.reason : (blockedReasons[0] || null),
      blockedReasons,
      label,
    };
  }
`, `  function reviewedApplyAvailability(reviewed, fallbackSafety = null) {
    const safety = reviewed?.safety || fallbackSafety || { blocked: false, blockedReasons: [] };
    const batch = evaluateApplyBatch(reviewed?.actions || []);
    const safetyReasons = safety.blocked ? [...(safety.blockedReasons || [])] : [];
    const blockedReasons = batch.blocked ? [...safetyReasons, batch.reason].filter(Boolean) : safetyReasons;
    const blocked = Boolean(safety.blocked || batch.blocked);
    const canApply = Boolean(batch.count > 0 && !blocked);
    const label = batch.blocked
      ? \`Пакет слишком большой · \${batch.count} / 2000\`
      : batch.count
        ? \`Применить к TESSA · \${batch.count}\`
        : 'Применить к TESSA';
    return {
      count: batch.count,
      warning: batch.warning,
      blocked,
      batchBlocked: batch.blocked,
      canApply,
      reason: batch.blocked ? batch.reason : (blockedReasons[0] || null),
      blockedReasons,
      label,
    };
  }

  function applyAvailability(plan, review = null) {
    const reviewed = buildReviewedPlan(plan, review);
    return reviewedApplyAvailability(reviewed, plan?.safety);
  }
`);

replaceOnce('preview report builder', `  function compactPlanForExport(plan) {`, `  function buildPreviewReport(plan, review = null) {
    const reviewed = buildReviewedPlan(plan, review);
    const availability = reviewedApplyAvailability(reviewed, plan?.safety);
    return {
      format: 'TESSA_MATRIX_PREVIEW_REPORT_V1',
      studioVersion: APP.version,
      createdAt: nowIso(),
      plan: compactPlanForExport(reviewed),
      skippedRows: [...(reviewed?.skippedRows || [])],
      skippedFields: [...(reviewed?.skippedFields || [])],
      reviewIssues: [...(reviewed?.reviewIssues || [])],
      review: {
        excludedRows: [...(review?.excludedRows || [])],
        excludedChanges: Object.fromEntries([...(review?.excludedChanges || new Map())].map(([key, values]) => [key, [...values]])),
      },
      apply: {
        canApply: availability.canApply,
        count: availability.count,
        blocked: availability.blocked,
        batchBlocked: availability.batchBlocked,
        warning: availability.warning || null,
        reason: availability.reason || null,
        blockedReasons: availability.blockedReasons || [],
      },
    };
  }

  function compactPlanForExport(plan) {`);

replaceOnce('move report button out of tools', `            <button id="tms-download-report" hidden disabled>Скачать отчёт</button>
`, ``);
replaceOnce('preview report button', `          <section id="tms-merge-conflicts" hidden aria-label="Конфликты объединения"></section><div class="tms-step"><div class="tms-step-label">3 · Проверка</div><div class="tms-row"><button id="tms-analyze" class="tms-primary" disabled>Проверить изменения</button><button id="tms-stop" hidden disabled>Отмена</button></div></div>
`, `          <section id="tms-merge-conflicts" hidden aria-label="Конфликты объединения"></section><div class="tms-step"><div class="tms-step-label">3 · Проверка</div><div class="tms-row"><button id="tms-analyze" class="tms-primary" disabled>Проверить изменения</button><button id="tms-download-report" hidden disabled>Скачать результат</button><button id="tms-stop" hidden disabled>Отмена</button></div></div>
`);

replaceOnce('refresh preview report', `    const applyNote = document.querySelector('#tms-apply-note');
    if (applyNote) {
      applyNote.textContent = applyState.batchBlocked
        ? \`Нужно уменьшить пакет: сейчас \${applyState.count}, максимум 2000 операций за один Apply.\`
        : applyState.warning
          ? \`Большой пакет: \${applyState.count} операций. Перед записью потребуется дополнительное подтверждение.\`
          : '';
    }
  }
`, `    const applyNote = document.querySelector('#tms-apply-note');
    if (applyNote) {
      applyNote.textContent = applyState.batchBlocked
        ? \`Нужно уменьшить пакет: сейчас \${applyState.count}, максимум 2000 операций за один Apply.\`
        : applyState.warning
          ? \`Большой пакет: \${applyState.count} операций. Перед записью потребуется дополнительное подтверждение.\`
          : '';
    }
    rememberReport(buildPreviewReport(plan, APP.review),
      \`TESSA_Matrix_Preview_\${new Date().toISOString().replace(/[:.]/g, '-')}.json\`);
  }
`);

replaceOnce('clear stale report on reset', `    APP.lastIntervalDiagnostics = null;
    APP.lastStudioDiagnostics = null;
    renderStudioDiagnostics();
`, `    APP.lastIntervalDiagnostics = null;
    APP.lastStudioDiagnostics = null;
    APP.lastReport = null;
    const reportButton = document.querySelector?.('#tms-download-report');
    if (reportButton) {
      reportButton.hidden = true;
      reportButton.title = '';
      setControlDisabled(reportButton, true);
    }
    renderStudioDiagnostics();
`);

replaceOnce('exports', `    dictionaryStructureSignature, dictionaryCacheKey, readDictionaryCache, writeDictionaryCache, deleteDictionaryCache, mergeSnapshotIntoDictionaryCatalog, compactPlanForExport,
`, `    dictionaryStructureSignature, dictionaryCacheKey, readDictionaryCache, writeDictionaryCache, deleteDictionaryCache, mergeSnapshotIntoDictionaryCatalog, buildPreviewReport, compactPlanForExport,
`);

fs.writeFileSync(file, code);

for (const path of [
  '.github/workflows/temporary-row-local-preview-report-patch.yml',
  'tools/temporary-row-local-preview-report-patch.mjs',
]) {
  try { fs.unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

console.log('patched row-local duplicates + Preview report');
