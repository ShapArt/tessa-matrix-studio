from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one marker, got {count}')
    text = text.replace(old, new, 1)

replace_once(
"""    const addStartedAt = monotonicNow();
    let completedAdds = 0;
    let lastYieldAt = addStartedAt;

    const validateAddAction = async action => {""",
"""    const addStartedAt = monotonicNow();
    let completedAdds = 0;
    let lastYieldAt = addStartedAt;
    const addProgressLabel = skipServerAddValidation ? 'Быстрый Preview новых строк' : 'Проверяю новые строки';
    if (addActions.length) {
      preflightProgress(29, addProgressLabel,
        skipServerAddValidation
          ? `0 из ${formatProgressCount(addActions.length)} · локальная проверка`
          : `0 из ${formatProgressCount(addActions.length)} · жду ответ TESSA`);
    }

    const validateAddAction = async action => {""",
'ADD phase initial progress')

replace_once(
"""    const reportAddProgress = () => {
      completedAdds += 1;
      const elapsedMs = Math.max(0, monotonicNow() - addStartedAt);
      const percent = addActions.length ? 28 + Math.round((completedAdds / addActions.length) * 8) : 36;
      preflightProgress(percent,
        skipServerAddValidation ? 'Быстрый Preview новых строк' : 'Проверяю новые строки',
        workProgressDetail({ completed: completedAdds, total: addActions.length, elapsedMs }));
    };""",
"""    const reportAddProgress = () => {
      completedAdds += 1;
      const elapsedMs = Math.max(0, monotonicNow() - addStartedAt);
      const percent = addActions.length ? 29 + Math.round((completedAdds / addActions.length) * 7) : 36;
      preflightProgress(percent, addProgressLabel,
        workProgressDetail({ completed: completedAdds, total: addActions.length, elapsedMs }));
    };""",
'ADD completion progress')

replace_once(
"""    } else {
      const results = await mapConcurrent(addActions, PERFORMANCE.PreflightAddConcurrency, async action => {
        const result = await validateAddAction(action);
        reportAddProgress();
        return result;
      });
      results.forEach(recordAddResult);
    }

    preflightProgress(36,""",
"""    } else {
      let heartbeatTimer = null;
      if (addActions.length) {
        heartbeatTimer = setInterval(() => {
          const elapsedMs = Math.max(0, monotonicNow() - addStartedAt);
          const elapsedSeconds = Math.max(1, Math.floor(elapsedMs / 1000));
          const percent = 29 + Math.round((completedAdds / addActions.length) * 7);
          preflightProgress(percent, addProgressLabel,
            `${formatProgressCount(completedAdds)} из ${formatProgressCount(addActions.length)} · жду ответ TESSA · прошло ${elapsedSeconds} сек`);
        }, 1000);
      }
      try {
        const results = await mapConcurrent(addActions, PERFORMANCE.PreflightAddConcurrency, async action => {
          const result = await validateAddAction(action);
          reportAddProgress();
          return result;
        });
        results.forEach(recordAddResult);
      } finally {
        if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
      }
    }

    preflightProgress(36,""",
'ADD TESSA heartbeat')

replace_once(
"""    if (c.delete && !window.confirm(`Будет удалено строк: ${c.delete}. Подтвердите удаление отдельно.`)) return null;

    APP.abortRequested = false;""",
"""    APP.abortRequested = false;""",
'redundant DELETE confirmation')

path.write_text(text, encoding='utf-8')
