const fs = require('fs');

const path = 'tessa-matrix-studio.user.js';
let text = fs.readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, got ${count}`);
  text = text.replace(before, after);
}

replaceOnce(
`  function runtimeSkip(action, error, phase = 'preflight') {
    const rowNumber = action?.excelRow?.excelRow || null;
    return makeSkippedRow(rowNumber, friendlyErrorMessage(error), phase, action?.type || null);
  }

  async function preflightPlan(plan) {
    setProgress(10, 'Предварительная проверка', 'Перечитываю матрицу перед записью');
    if (plan?.safety?.blocked) throw new Error(\`Файл нельзя применить: \${plan.safety.blockedReasons.join(' ')}\`);
    const bridge = await TessaBridge.create();
    assertWritableMatrixDraft(bridge);
    assertNativeEditMode();
    const structure = await bridge.requestStructure(bridge.templateId());
    const fresh = await bridge.loadSnapshot(structure);
    setProgress(18, 'Сверяю актуальное состояние', \`\${fresh.rows.length} строк в TESSA\`);`,
`  function runtimeSkip(action, error, phase = 'preflight') {
    const rowNumber = action?.excelRow?.excelRow || null;
    return makeSkippedRow(rowNumber, friendlyErrorMessage(error), phase, action?.type || null);
  }

  function applyPreflightPreview(plan, preflight) {
    if (!plan) return plan;
    const skippedActions = preflight?.runtimeSkippedActions instanceof Set
      ? preflight.runtimeSkippedActions
      : new Set();
    const runtimeSkips = Array.isArray(preflight?.runtimeSkips) ? preflight.runtimeSkips : [];
    const seenSkips = new Set();
    const skippedRows = [];
    for (const item of [...(plan.skippedRows || []), ...runtimeSkips]) {
      const key = [item?.phase || '', item?.actionType || '', item?.excelRow ?? '', item?.reason || ''].join('|');
      if (seenSkips.has(key)) continue;
      seenSkips.add(key);
      skippedRows.push(item);
    }
    const actions = (plan.actions || []).filter(action => !skippedActions.has(action));
    const runtimeSkipCount = runtimeSkips.length;
    const warnings = [...(plan.warnings || [])];
    if (runtimeSkipCount) {
      warnings.push(`Предварительная проверка до Apply: ${runtimeSkipCount} операций переведены в ПРОПУСТИТЬ. Причины показаны выше.`);
    }
    return {
      ...plan,
      actions,
      skippedRows,
      warnings,
      counts: countActions(actions, skippedRows),
      preflightPreview: {
        validated: true,
        runtimeSkipCount,
        attemptedCount: (plan.actions || []).filter(action => action.type !== 'noop').length,
        executableCount: actions.filter(action => action.type !== 'noop').length,
        validatedAt: nowIso(),
      },
    };
  }

  async function preflightPlan(plan, options = {}) {
    const previewOnly = Boolean(options.previewOnly);
    const preflightProgress = previewOnly ? () => {} : setProgress;
    preflightProgress(10, 'Предварительная проверка', 'Перечитываю матрицу перед записью');
    if (plan?.safety?.blocked) throw new Error(\`Файл нельзя применить: \${plan.safety.blockedReasons.join(' ')}\`);
    const bridge = options.bridge || await TessaBridge.create();
    assertWritableMatrixDraft(bridge);
    if (!previewOnly) assertNativeEditMode();
    const structure = options.structure || await bridge.requestStructure(bridge.templateId());
    const fresh = options.fresh || await bridge.loadSnapshot(structure);
    preflightProgress(18, 'Сверяю актуальное состояние', \`\${fresh.rows.length} строк в TESSA\`);`,
'preflight projection and preview mode');

replaceOnce(
`    const runtimeSkips = [];
    const preparedUpdates = new Map();`,
`    const runtimeSkips = [];
    const runtimeSkippedActions = new Set();
    const preparedUpdates = new Map();`,
'runtime skipped action set');

replaceOnce(
`        runtimeSkips.push(runtimeSkip(action, error, 'preflight-update'));
      }
    }

    setProgress(28, 'Проверяю изменяемые строки', \`Проверено: \${plan.actions.filter(x => x.type === 'update').length}\`);`,
`        runtimeSkippedActions.add(action);
        runtimeSkips.push(runtimeSkip(action, error, 'preflight-update'));
      }
    }

    preflightProgress(28, 'Проверяю изменяемые строки', \`Проверено: \${plan.actions.filter(x => x.type === 'update').length}\`);`,
'update runtime skip projection');

replaceOnce(
`        runtimeSkips.push(runtimeSkip(action, error, 'preflight-add'));
      }
    }

    setProgress(36, 'Проверяю новые строки', \`Проверено: \${plan.actions.filter(x => x.type === 'add').length}\`);`,
`        runtimeSkippedActions.add(action);
        runtimeSkips.push(runtimeSkip(action, error, 'preflight-add'));
      }
    }

    preflightProgress(36, 'Проверяю новые строки', \`Проверено: \${plan.actions.filter(x => x.type === 'add').length}\`);`,
'add runtime skip projection');

replaceOnce(
`      } catch (error) {
        runtimeSkips.push(runtimeSkip(action, error, 'preflight-delete'));
      }
    }

    setProgress(42, 'Предварительная проверка завершена', \`Готово к записи: \${preparedUpdates.size + preparedAdds.size + readyDeletes.length}\`);
    return { bridge, structure, fresh, preparedUpdates, preparedAdds, readyDeletes, runtimeSkips };`,
`      } catch (error) {
        runtimeSkippedActions.add(action);
        runtimeSkips.push(runtimeSkip(action, error, 'preflight-delete'));
      }
    }

    preflightProgress(42, 'Предварительная проверка завершена', \`Готово к записи: \${preparedUpdates.size + preparedAdds.size + readyDeletes.length}\`);
    return { bridge, structure, fresh, preparedUpdates, preparedAdds, readyDeletes, runtimeSkips, runtimeSkippedActions };`,
'delete runtime skip projection and return');

replaceOnce(
`    } else if (plan.skippedRows?.length) {
      log(\`Проверка готова: \${plan.skippedRows.length} строк будут пропущены, остальные можно применить.\`, 'warn');
    }
    APP.workbook = workbook;`,
`    } else if (plan.skippedRows?.length) {
      log(\`Проверка готова: \${plan.skippedRows.length} строк будут пропущены, остальные можно применить.\`, 'warn');
    }
    let previewPlan = plan;
    if (!plan.safety.blocked && plan.actions.some(action => action.type !== 'noop')) {
      setProgress(92, 'Проверяю применимость', 'Справочники, дубли и зависимости перед Apply');
      const previewPreflight = await preflightPlan(plan, { previewOnly: true, bridge, structure, fresh: snapshot });
      previewPlan = applyPreflightPreview(plan, previewPreflight);
      if (previewPlan.preflightPreview.runtimeSkipCount) {
        log(\`Предварительная проверка: \${previewPlan.preflightPreview.runtimeSkipCount} операций заранее переведены в ПРОПУСТИТЬ.\`, 'warn');
      }
    }
    APP.workbook = workbook;`,
'analyze preview preflight call');

replaceOnce(
`    APP.review = createPlanReviewState();
    APP.plan = plan;
    renderPlan(plan);
    const visible = plan.actions.filter(action => action.type !== 'noop').length;
    setProgress(100, 'Проверка завершена', visible ? \`Найдено изменений: \${visible}\` : 'Изменений нет');
    return plan;`,
`    APP.review = createPlanReviewState();
    APP.plan = previewPlan;
    renderPlan(previewPlan);
    const visible = previewPlan.actions.filter(action => action.type !== 'noop').length;
    const skipped = previewPlan.counts?.skip || 0;
    const detail = visible
      ? \`Корректных изменений: \${visible}\${skipped ? ` · пропустить: \${skipped}` : ''}\`
      : (skipped ? \`Корректных изменений нет · пропустить: \${skipped}\` : 'Изменений нет');
    setProgress(100, 'Проверка завершена', detail);
    return previewPlan;`,
'analyze render projected plan');

replaceOnce(
`    preflightPlan, applyPlan, hydrateMissingIdsForAction, nativeEditAccessState, assertNativeEditMode, isWritableMatrixDraft, assertWritableMatrixDraft,`,
`    preflightPlan, applyPreflightPreview, applyPlan, hydrateMissingIdsForAction, nativeEditAccessState, assertNativeEditMode, isWritableMatrixDraft, assertWritableMatrixDraft,`,
'export preview projection');

fs.writeFileSync(path, text);
console.log('v1.9.20 preview preflight patch applied');
// trigger helper after workflow registration
