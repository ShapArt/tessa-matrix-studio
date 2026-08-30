from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    text = text.replace(old, new, 1)

replace_once(
    "  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));",
    "  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));\n\n  function requestApplyAbort() {\n    APP.abortRequested = true;\n  }",
    'abort helper',
)

old_result = '''    const result = {
      planId: plan.id,
      startedAt: nowIso(),
      finishedAt: null,
      rows: [],
      skipped: [...(plan.skippedRows || []), ...runtimeSkips],
      success: false,
      partial: false,
      appliedCount: 0,
      skippedCount: 0,
    };

    for (const prepared of preparedUpdates.values()) {
      if (APP.abortRequested) throw new Error('Операция остановлена пользователем.');
      const action = prepared.action;'''
new_result = '''    const result = {
      planId: plan.id,
      startedAt: nowIso(),
      finishedAt: null,
      rows: [],
      skipped: [...(plan.skippedRows || []), ...runtimeSkips],
      success: false,
      partial: false,
      status: 'running',
      cancelled: false,
      plannedCount: totalToStore,
      startedCount: 0,
      appliedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      notStartedCount: totalToStore,
    };
    let cancelled = false;
    const shouldStopBeforeNextMutation = () => {
      if (!APP.abortRequested) return false;
      cancelled = true;
      result.cancelled = true;
      return true;
    };

    for (const prepared of preparedUpdates.values()) {
      if (shouldStopBeforeNextMutation()) break;
      result.startedCount += 1;
      const action = prepared.action;'''
replace_once(old_result, new_result, 'result and update-loop cancellation')

old_add = '''    for (const created of preparedAdds.values()) {
      if (APP.abortRequested) throw new Error('Операция остановлена пользователем.');
      const action = created.action;'''
new_add = '''    if (!cancelled) for (const created of preparedAdds.values()) {
      if (shouldStopBeforeNextMutation()) break;
      result.startedCount += 1;
      const action = created.action;'''
replace_once(old_add, new_add, 'add-loop cancellation')

old_delete = '''    for (const prepared of readyDeletes) {
      if (APP.abortRequested) throw new Error('Операция остановлена пользователем.');
      const action = prepared.action;'''
new_delete = '''    if (!cancelled) for (const prepared of readyDeletes) {
      if (shouldStopBeforeNextMutation()) break;
      result.startedCount += 1;
      const action = prepared.action;'''
replace_once(old_delete, new_delete, 'delete-loop cancellation')

old_finish = '''    setProgress(96, 'Обновляю карточку TESSA', 'Получаю итоговое состояние');
    await bridge.refresh();
    result.finishedAt = nowIso();
    result.appliedCount = result.rows.filter(row => row.status === 'ok').length;
    result.skippedCount = result.skipped.length;
    result.partial = result.skippedCount > 0;
    result.success = true;
    log(`Готово. Применено: ${result.appliedCount}; пропущено: ${result.skippedCount}.`, result.partial ? 'warn' : 'info');
    downloadJson(result, `TESSA_Matrix_Apply_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    setProgress(100, result.partial ? 'Применение завершено с пропусками' : 'Все изменения применены', `Применено: ${result.appliedCount} · пропущено: ${result.skippedCount}`);
    return result;'''
new_finish = '''    setProgress(96, cancelled ? 'Фиксирую остановленную операцию' : 'Обновляю карточку TESSA', 'Получаю итоговое состояние');
    await bridge.refresh();
    result.finishedAt = nowIso();
    result.appliedCount = result.rows.filter(row => row.status === 'ok').length;
    result.failedCount = result.rows.filter(row => row.status === 'skipped').length;
    result.skippedCount = result.skipped.length;
    result.notStartedCount = Math.max(0, result.plannedCount - result.startedCount);
    result.cancelled = cancelled;
    result.status = cancelled ? 'cancelled' : (result.skippedCount > 0 || result.failedCount > 0 ? 'partial' : 'completed');
    result.partial = result.status !== 'completed';
    result.success = !cancelled;
    const resultLevel = result.partial ? 'warn' : 'info';
    log(`Готово. Статус: ${result.status}; применено: ${result.appliedCount}; пропущено: ${result.skippedCount}; не начато: ${result.notStartedCount}.`, resultLevel);
    downloadJson(result, `TESSA_Matrix_Apply_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    const progressLabel = cancelled ? 'Применение остановлено' : result.partial ? 'Применение завершено с пропусками' : 'Все изменения применены';
    setProgress(100, progressLabel, `Применено: ${result.appliedCount} · пропущено: ${result.skippedCount} · не начато: ${result.notStartedCount}`);
    return result;'''
replace_once(old_finish, new_finish, 'result finalization')

replace_once(
    "    panel.querySelector('#tms-stop').addEventListener('click', () => { APP.abortRequested = true; });",
    "    panel.querySelector('#tms-stop').addEventListener('click', requestApplyAbort);",
    'stop button handler',
)

replace_once(
    "    preflightPlan, applyPreflightPreview, applyPlan, hydrateMissingIdsForAction, nativeEditAccessState, assertNativeEditMode, isWritableMatrixDraft, assertWritableMatrixDraft,",
    "    preflightPlan, applyPreflightPreview, applyPlan, requestApplyAbort, hydrateMissingIdsForAction, nativeEditAccessState, assertNativeEditMode, isWritableMatrixDraft, assertWritableMatrixDraft,",
    'abort helper export',
)

path.write_text(text, encoding='utf-8')
print('Applied cancellation-aware Apply result patch')
