from pathlib import Path
import re

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')


def sub_once(pattern: str, replacement: str, label: str, flags=re.S):
    global text
    text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 replacement, got {count}')
    print(f'patched: {label}')

# 1) Apply result accounting + native-view refresh retry helpers.
sub_once(
    r"  function finalizeApplyResult\(result, options = \{\}\) \{.*?\n  \}\n\n  function applyResultMessage\(result\) \{.*?\n  \}\n",
    r'''  function isWriterLockError(error) {
    const text = `${error?.message || error || ''} ${error?.code || ''}`.toLowerCase();
    return /obtainwriterlock|writeheartbit|cardislockedbywriter|cardlocktimeoutwhileobtainingwriterlock|locked by writer|writer[- ]lock/.test(text);
  }

  async function refreshNativeMatrixViewAfterApply(bridge, options = {}) {
    if (!bridge || typeof bridge.refreshNativeMatrixView !== 'function') {
      return { ok: false, attempts: 0, reason: 'native-view-refresh-unavailable', error: 'Нативное отображение матрицы недоступно.' };
    }
    const attempts = Math.max(1, Math.min(5, Number(options.attempts) || 3));
    const baseDelayMs = Math.max(0, Number(options.baseDelayMs) || 0);
    let lastError = null;
    for (let index = 0; index < attempts; index += 1) {
      if (index > 0 && baseDelayMs > 0) await sleep(baseDelayMs * (2 ** (index - 1)));
      try {
        const outcome = await bridge.refreshNativeMatrixView();
        if (outcome?.ok === false) throw new Error(outcome.error || outcome.reason || 'Не удалось обновить отображение матрицы.');
        return { ok: true, attempts: index + 1, ...(outcome || {}) };
      } catch (error) {
        lastError = error;
        if (!isWriterLockError(error) || index + 1 >= attempts) break;
        log(`Отображение TESSA ещё занято writer-lock; повторяю refresh (${index + 2}/${attempts}).`, 'warn');
      }
    }
    return {
      ok: false,
      attempts: Math.max(1, Math.min(attempts, attempts)),
      reason: isWriterLockError(lastError) ? 'writer-lock' : 'refresh-failed',
      error: lastError?.message || String(lastError || 'Не удалось обновить отображение матрицы.'),
    };
  }

  /**
   * Финализирует отчёт Apply. Source-skipped строки уже были исключены planner'ом
   * и не являются частью requested mutation-plan, поэтому сами по себе не делают
   * успешный Apply частичным.
   */
  function finalizeApplyResult(result, options = {}) {
    const cancelled = Boolean(options.cancelled ?? result?.cancelled);
    result.appliedCount = (result.rows || []).filter(row => row.status === 'ok').length;
    result.storeSkippedCount = (result.rows || []).filter(row => row.status === 'skipped').length;
    result.failedCount = result.storeSkippedCount;
    result.notStartedCount = Math.max(0, Number(result.plannedCount || 0) - Number(result.startedCount || 0));
    result.skippedCount = (result.skipped || []).length;
    const inferredSourceSkipped = (result.skipped || []).filter(item => item?.phase === 'source' || item?.source === 'excel-validation').length;
    const inferredPreflightSkipped = (result.skipped || []).filter(item => item?.phase === 'preflight').length;
    result.sourceSkippedCount = Math.max(0, Number(result.sourceSkippedCount ?? inferredSourceSkipped) || 0);
    result.preflightSkippedCount = Math.max(0, Number(result.preflightSkippedCount ?? inferredPreflightSkipped) || 0);
    result.cancelled = cancelled;
    result.verificationIncomplete = Boolean(result.verificationIncomplete || result.refreshError);
    const mutationIncomplete = result.verificationIncomplete
      || result.preflightSkippedCount > 0
      || result.storeSkippedCount > 0
      || result.failedCount > 0
      || result.notStartedCount > 0;
    result.status = cancelled ? 'cancelled' : (mutationIncomplete ? 'partial' : 'completed');
    result.partial = result.status !== 'completed';
    result.success = result.status === 'completed';
    return result;
  }

  function applyResultMessage(result) {
    const applied = Math.max(0, Number(result?.appliedCount || 0));
    const requested = Math.max(applied, Number(result?.requestedCount || result?.plannedCount || applied));
    const sourceSkipped = Math.max(0, Number(result?.sourceSkippedCount || 0));
    const preflightSkipped = Math.max(0, Number(result?.preflightSkippedCount || 0));
    const storeSkipped = Math.max(0, Number(result?.storeSkippedCount || 0));
    const notStarted = Math.max(0, Number(result?.notStartedCount || 0));
    if (result?.cancelled || result?.status === 'cancelled') {
      return `Применение остановлено.\n\nПрименено: ${applied}\nНе начато: ${notStarted}\n\nУже выполненные записи не откатываются. Перед продолжением используйте свежую проверку TESSA.`;
    }
    if (result?.status === 'completed') {
      const sourceNote = sourceSkipped ? `\nЕщё ${sourceSkipped} строк не вошли в Apply и остались без изменений.` : '';
      const refreshNote = result?.viewRefresh?.ok
        ? '\nОтображение TESSA обновлено автоматически.'
        : (result?.viewRefresh && !result.viewRefresh.skipped ? '\nЗапись завершена, но отображение TESSA не удалось обновить автоматически.' : '');
      return `Готово. Применено: ${applied} из ${requested}.\nВсе подготовленные изменения применены.${sourceNote}${refreshNote}`;
    }
    const mutationSkipped = preflightSkipped + storeSkipped;
    return `Применение завершено частично.\n\nПрименено: ${applied} из ${requested}\nНе применено после проверки: ${mutationSkipped}\nНе начато: ${notStarted}${sourceSkipped ? `\nОтдельно не вошли в Apply: ${sourceSkipped}` : ''}\n\nПеред следующим Apply выполните свежую проверку.`;
  }
''',
    'result accounting and messages',
)

# 2) Low-level native matrix-view refresh. Keep full-card refresh() for explicit export/schema flows.
sub_once(
    r"\n    async refresh\(\) \{\n      await this\.editor\?\.refreshCard\?\.\(\);",
    r'''
    async refreshNativeMatrixView() {
      const nativeControl = this.findNativeMatrixControl();
      if (!nativeControl) return { ok: false, reason: 'native-view-not-found', error: 'Не найдено нативное отображение матрицы TESSA.' };
      const { target, controlName } = nativeControl;
      const page = this.nativePagingInfo(target).currentPage;
      if (typeof target?.refresh === 'function') {
        await target.refresh();
      } else if (typeof target?.setPageAndRefresh === 'function') {
        await target.setPageAndRefresh(page);
      } else if (typeof target?.viewComponent?.refresh === 'function') {
        await target.viewComponent.refresh();
      } else {
        throw new Error(`Представление «${controlName}» не поддерживает локальное обновление.`);
      }
      return { ok: true, controlName, page };
    }

    async refresh() {
      await this.editor?.refreshCard?.();''',
    'native view refresh method',
)

# 3) Apply: refresh only native view with bounded writer-lock retry after mutation phase.
sub_once(
    r"    // Не форсим editor\.refreshCard\(\) сразу после Store/Delete\..*?    setProgress\(96, cancelled \? 'Фиксирую остановленную операцию' : 'Завершаю применение',\n      cancelled \? 'Сохраняю точную границу выполненных операций' : 'Запись завершена · карточка TESSA автоматически не перезагружается'\);",
    r'''    result.viewRefresh = { ok: false, skipped: true, reason: 'not-attempted' };
    if (!cancelled && result.startedCount > 0) {
      setProgress(96, 'Обновляю отображение TESSA', 'Только представление матрицы · без перезагрузки карточки');
      result.viewRefresh = await refreshNativeMatrixViewAfterApply(bridge, { attempts: 3, baseDelayMs: 450 });
      if (result.viewRefresh.ok) {
        log(`Отображение TESSA обновлено автоматически${result.viewRefresh.controlName ? `: ${result.viewRefresh.controlName}` : ''}.`);
      } else {
        log(`Запись завершена, но отображение TESSA не обновилось автоматически: ${result.viewRefresh.error || result.viewRefresh.reason}.`, 'warn');
      }
    } else {
      setProgress(96, cancelled ? 'Фиксирую остановленную операцию' : 'Завершаю применение',
        cancelled ? 'Сохраняю точную границу выполненных операций' : 'Запись завершена');
    }''',
    'post-apply native refresh integration',
)

# 4) Final progress distinguishes source-excluded rows from failed requested mutations.
sub_once(
    r"    const progressLabel = cancelled \? 'Применение остановлено' : result\.partial \? 'Применение завершено с пропусками' : 'Все изменения применены';\n    setProgress\(100, progressLabel, `Применено: \$\{result\.appliedCount\} · пропущено: \$\{result\.skippedCount\} · не начато: \$\{result\.notStartedCount\}`\);",
    r'''    const progressLabel = cancelled
      ? 'Применение остановлено'
      : result.partial
        ? 'Применение завершено частично'
        : `Применено ${result.appliedCount} из ${Math.max(result.appliedCount, Number(result.requestedCount || result.plannedCount || result.appliedCount))}`;
    const progressParts = [];
    if (result.preflightSkippedCount || result.storeSkippedCount) progressParts.push(`не применено: ${result.preflightSkippedCount + result.storeSkippedCount}`);
    if (result.sourceSkippedCount) progressParts.push(`не вошли в Apply: ${result.sourceSkippedCount}`);
    if (result.notStartedCount) progressParts.push(`не начато: ${result.notStartedCount}`);
    if (result.viewRefresh?.ok) progressParts.push('отображение TESSA обновлено');
    else if (result.viewRefresh && !result.viewRefresh.skipped) progressParts.push('отображение можно обновить кнопкой ниже');
    setProgress(100, progressLabel, progressParts.join(' · ') || 'Готово');''',
    'final progress semantics',
)

# 5) Inline post-Apply notice and manual native-view refresh fallback.
sub_once(
    r"  function renderPlanConsumedNotice\(result\) \{.*?\n  \}\n",
    r'''  function renderPlanConsumedNotice(result) {
    const summary = document.querySelector?.('#tms-summary');
    const table = document.querySelector?.('#tms-plan');
    const refreshButton = document.querySelector?.('#tms-refresh-view');
    const applied = Math.max(0, Number(result?.appliedCount || 0));
    const requested = Math.max(applied, Number(result?.requestedCount || result?.plannedCount || applied));
    const sourceSkipped = Math.max(0, Number(result?.sourceSkippedCount || 0));
    const completed = result?.status === 'completed' && result?.success === true;
    const title = completed
      ? `Изменения применены: ${applied} из ${requested}.`
      : result?.cancelled
        ? `Применение остановлено: применено ${applied}.`
        : `Применение завершено частично: применено ${applied} из ${requested}.`;
    const sourceText = sourceSkipped ? ` Ещё ${sourceSkipped} строк не входили в Apply и остались без изменений.` : '';
    const refreshText = result?.viewRefresh?.ok
      ? ' Отображение TESSA обновлено автоматически.'
      : (result?.viewRefresh && !result.viewRefresh.skipped ? ' Запись завершена; отображение можно обновить кнопкой ниже.' : '');
    if (summary) summary.innerHTML = `<div class="tms-review-note"><b>${title}</b>${sourceText}${refreshText} Старый Preview погашен: для следующего Apply нужна свежая проверка.</div>`;
    if (table) table.innerHTML = '';
    if (refreshButton) {
      const needsManualRefresh = Boolean(result?.viewRefresh && !result.viewRefresh.ok && !result.viewRefresh.skipped);
      refreshButton.hidden = !needsManualRefresh;
      refreshButton.disabled = !needsManualRefresh;
    }
  }
''',
    'inline consumed notice',
)

# 6) Sticky progress/status strip inside the scrollable panel body.
old_status = ".tms-body{padding:14px 16px 16px;overflow:auto;background:linear-gradient(180deg,#fff 0,#fff 55%,#fffafa 100%)}.tms-status{padding:11px 12px;border-radius:13px;background:#f7f7f7;color:#555;margin-bottom:12px;border:1px solid #ededed;transition:.2s}"
new_status = ".tms-body{padding:14px 16px 16px;overflow:auto;background:linear-gradient(180deg,#fff 0,#fff 55%,#fffafa 100%)}.tms-status{position:sticky;top:0;z-index:30;padding:11px 12px;border-radius:13px;background:#f7f7f7;color:#555;margin-bottom:12px;border:1px solid #ededed;box-shadow:0 8px 18px #00000010;transition:.2s}"
if old_status not in text:
    raise SystemExit('sticky status: source marker not found')
text = text.replace(old_status, new_status, 1)
print('patched: sticky progress status')

# 7) Add manual native-view refresh button to Apply step.
old_markup = '<button id=\\"tms-download-report\\" class=\\"tms-ghost\\" hidden disabled>Скачать отчёт</button><div id=\\"tms-apply-note\\" class=\\"tms-step-caption\\"></div>'
new_markup = '<button id=\\"tms-download-report\\" class=\\"tms-ghost\\" hidden disabled>Скачать отчёт</button><button id=\\"tms-refresh-view\\" class=\\"tms-ghost\\" hidden disabled>Обновить отображение</button><div id=\\"tms-apply-note\\" class=\\"tms-step-caption\\"></div>'
if old_markup not in text:
    raise SystemExit('refresh button markup: source marker not found')
text = text.replace(old_markup, new_markup, 1)
print('patched: manual view refresh button')

# 8) Wire manual refresh fallback before Apply handler.
old_listener = "    panel.querySelector('#tms-download-report').addEventListener('click', () => { downloadLastReport(); });\n    panel.querySelector('#tms-apply').addEventListener('click', async () => {"
new_listener = """    panel.querySelector('#tms-download-report').addEventListener('click', () => { downloadLastReport(); });
    panel.querySelector('#tms-refresh-view').addEventListener('click', async () => {
      if (APP.busy) return;
      setBusy(true);
      try {
        const bridge = await TessaBridge.create();
        const outcome = await refreshNativeMatrixViewAfterApply(bridge, { attempts: 3, baseDelayMs: 450 });
        if (!outcome.ok) throw new Error(outcome.error || 'Не удалось обновить отображение TESSA.');
        const button = panel.querySelector('#tms-refresh-view');
        if (button) { button.hidden = true; button.disabled = true; }
        setProgress(100, 'Отображение обновлено', outcome.controlName || 'Матрица TESSA обновлена');
      } catch (error) {
        const message = friendlyErrorMessage(error);
        log(message, 'error', error);
        setProgress(100, 'Не удалось обновить отображение', 'Запись в TESSA не отменяется; можно повторить позже.');
        alert(`Не удалось обновить отображение TESSA: ${message}`);
      } finally { setBusy(false); }
    });
    panel.querySelector('#tms-apply').addEventListener('click', async () => {"""
if old_listener not in text:
    raise SystemExit('manual refresh listener: source marker not found')
text = text.replace(old_listener, new_listener, 1)
print('patched: manual refresh listener')

# 9) Ordinary Apply completion is inline, not blocking alert().
old_success = """        if (result) {
          if (invalidatePlanStateAfterApply(APP, result)) renderPlanConsumedNotice(result);
          alert(applyResultMessage(result));
        }"""
new_success = """        if (result) {
          invalidatePlanStateAfterApply(APP, result);
          renderPlanConsumedNotice(result);
        }"""
if old_success not in text:
    raise SystemExit('apply success handler: source marker not found')
text = text.replace(old_success, new_success, 1)
print('patched: inline apply success handler')

# 10) Export new helpers to regression tests.
old_exports = "typedScalarSemantic, typedRangeSemantic, deletionGuard, evaluateApplyBatch, applyAvailability, previewPreflightPolicy, finalizeApplyResult, applyResultMessage,"
new_exports = "typedScalarSemantic, typedRangeSemantic, deletionGuard, evaluateApplyBatch, applyAvailability, previewPreflightPolicy, isWriterLockError, refreshNativeMatrixViewAfterApply, finalizeApplyResult, applyResultMessage,"
if old_exports not in text:
    raise SystemExit('test exports: source marker not found')
text = text.replace(old_exports, new_exports, 1)
print('patched: test exports')

path.write_text(text, encoding='utf-8')
print('v1.9.39 behavior patch applied successfully')
