from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')

# 1. Session-only review state. Function declarations are hoisted inside the userscript IIFE.
old = "    plan: null,\n    workbook: null,"
new = "    plan: null,\n    review: createPlanReviewState(),\n    workbook: null,"
if old not in text:
    raise SystemExit('APP plan anchor missing')
text = text.replace(old, new, 1)

# 2. A new Analyze always starts a clean review session.
old = "    APP.snapshot = snapshot;\n    APP.plan = plan;\n    renderPlan(plan);"
new = "    APP.snapshot = snapshot;\n    APP.review = createPlanReviewState();\n    APP.plan = plan;\n    renderPlan(plan);"
if old not in text:
    raise SystemExit('analyze review reset anchor missing')
text = text.replace(old, new, 1)

# 3. Replace preview renderer with reviewed/effective-plan aware UI.
start = text.index("  function renderPlan(plan) {\n")
end = text.index("  function flatToHtml(flat, columnMap = null) {\n", start)
render = r'''  function renderPlan(plan) {
    const summary = document.querySelector('#tms-summary');
    const table = document.querySelector('#tms-plan');
    if (!summary || !table) return;
    const reviewed = buildReviewedPlan(plan, APP.review);
    const c = reviewed.counts;
    const skipped = reviewed.skippedRows || [];
    const warnings = (reviewed.warnings || []).slice(0, 8);
    const reviewedSafety = reviewed.safety || plan.safety || { blocked: false, blockedReasons: [] };
    const excludedRowCount = APP.review?.excludedRows?.size || 0;
    const excludedChangeCount = [...(APP.review?.excludedChanges?.values?.() || [])].reduce((sum, values) => sum + (values?.size || 0), 0);
    const hasReviewExclusions = excludedRowCount > 0 || excludedChangeCount > 0;
    summary.innerHTML = `
      <div class="tms-counters">
        <span class="tms-count tms-update">изменить <b>${c.update}</b></span>
        <span class="tms-count tms-add">добавить <b>${c.add}</b></span>
        <span class="tms-count tms-delete">удалить <b>${c.delete}</b></span>
        <span class="tms-count tms-noop">без изменений <b>${c.noop}</b></span>
        <span class="tms-count tms-skip">пропустить <b>${c.skip || 0}</b></span>
      </div>
      ${hasReviewExclusions ? `<div class="tms-review-note"><b>Фильтр применения включён.</b> Отключённые здесь изменения не попадут в TESSA; исходный Excel не изменяется.</div>` : ''}
      ${reviewedSafety.blocked ? `<div class="tms-fatal"><b>Этот набор изменений нельзя безопасно применить</b><br>${(reviewedSafety.blockedReasons || []).map(escapeHtml).join('<br>')}</div>` : ''}
      ${skipped.length ? `<details class="tms-skipped-box"><summary><b>Пропущено строк: ${skipped.length}</b> · корректные изменения можно применить</summary><div>${skipped.slice(0, 20).map(item => `<div class="tms-skip-line">${item.excelRow ? `Excel ${item.excelRow}: ` : ''}${escapeHtml(item.reason)}</div>`).join('')}${skipped.length > 20 ? `<div class="tms-skip-more">Ещё ${skipped.length - 20}…</div>` : ''}</div></details>` : ''}
      ${warnings.length ? `<details class="tms-warning"><summary>Нужно проверить</summary><div>${warnings.map(item => `<div>${escapeHtml(item)}</div>`).join('')}</div></details>` : ''}
    `;

    // Не теряем раскрытую строку после клика по review-кнопке и повторного renderPlan().
    const openActionKeys = new Set([...table.querySelectorAll('details[open][data-review-action-key]')].map(item => item.dataset.reviewActionKey));
    table.innerHTML = '';

    // Показываем исходные найденные действия, а не только effective actions: иначе
    // полностью отключённая строка исчезнет из preview и её нельзя будет вернуть.
    const visible = plan.actions.filter(action => action.type !== 'noop');
    const previewLimit = 40;
    const previewActions = visible.slice(0, previewLimit);
    if (!visible.length && !skipped.length) table.innerHTML = '<div class="tms-empty">Изменений нет.</div>';

    previewActions.forEach(action => {
      const item = document.createElement('details');
      item.className = `tms-action tms-action-${action.type}`;
      const actionKey = planReviewActionKey(action);
      item.dataset.reviewActionKey = actionKey;
      if (openActionKeys.has(actionKey)) item.open = true;
      const isReplacement = action.type === 'update' && isOverwriteMatch(action.match);
      const label = isReplacement ? 'ЗАМЕНИТЬ' : action.type === 'update' ? 'ИЗМЕНИТЬ' : action.type === 'add' ? 'ДОБАВИТЬ' : 'УДАЛИТЬ';
      const rowText = isReplacement ? `Excel ${action.excelRow.excelRow} → TESSA ${action.currentRow.index + 1}` : action.excelRow ? `Excel ${action.excelRow.excelRow}` : `TESSA ${action.currentRow.index + 1}`;
      const rowExcluded = action.type === 'update' && Boolean(APP.review?.excludedRows?.has?.(actionKey));
      if (rowExcluded) item.classList.add('tms-review-row-excluded');
      item.innerHTML = `<summary><b>${label}</b> — ${rowText}${action.match?.lowConfidence ? ' ⚠' : ''}${rowExcluded ? ' · <span class="tms-review-state">не будет применено</span>' : ''}</summary>`;
      const body = document.createElement('div');
      body.className = 'tms-action-body';

      if (action.type === 'update') {
        const excludedChanges = reviewExcludedChanges(APP.review, action);
        const rowButtonLabel = rowExcluded ? 'Вернуть все изменения строки' : 'Не применять всю строку';
        const rowsExcludedIndividually = (action.changes || []).filter(change => excludedChanges.has(change.key)).length;
        body.innerHTML = `
          <div class="tms-review-row-actions">
            <button type="button" class="tms-review-btn tms-review-row-btn" data-review-action="${escapeHtml(actionKey)}" data-review-row="true" aria-pressed="${rowExcluded ? 'true' : 'false'}">${rowButtonLabel}</button>
            ${!rowExcluded && rowsExcludedIndividually ? `<span class="tms-review-state">Не применяется полей: ${rowsExcludedIndividually}</span>` : ''}
          </div>
          ${(action.changes || []).map(change => {
            const individuallyExcluded = excludedChanges.has(change.key);
            const excluded = rowExcluded || individuallyExcluded;
            const button = rowExcluded ? '' : `<button type="button" class="tms-review-btn tms-review-change-btn" data-review-action="${escapeHtml(actionKey)}" data-review-change="${escapeHtml(change.key)}" aria-pressed="${individuallyExcluded ? 'true' : 'false'}">${individuallyExcluded ? 'Вернуть' : 'Не применять'}</button>`;
            return `<div class="tms-diff${excluded ? ' tms-diff-excluded' : ''}">
              <div class="tms-diff-head"><b>${escapeHtml(change.label || change.key)}</b>${button}</div>
              <span class="tms-before">было: ${escapeHtml((change.before || []).join(' | ') || '∅')}</span><br>
              <span class="tms-after">стало: ${escapeHtml((change.after || []).join(' | ') || '∅')}</span>
              ${excluded ? '<div class="tms-review-state">Это изменение не будет применено</div>' : ''}
            </div>`;
          }).join('')}`;
      } else if (action.type === 'add') body.innerHTML = flatToHtml(action.excelRow.flat, plan.columnMap);
      else body.innerHTML = flatToHtml(action.currentRow.flat, plan.columnMap);
      item.appendChild(body);
      table.appendChild(item);
    });

    if (visible.length > previewLimit) {
      const more = document.createElement('div');
      more.className = 'tms-empty';
      more.textContent = `Ещё ${visible.length - previewLimit} изменений не развёрнуты. Счётчики сверху учитывают весь план.`;
      table.appendChild(more);
    }

    // Делегируем клики одной функцией: renderPlan может пересобирать карточки сколько угодно.
    table.onclick = event => {
      const button = event.target?.closest?.('button[data-review-action]');
      if (!button || !APP.plan || APP.busy) return;
      const sourceAction = (APP.plan.actions || []).find(candidate => planReviewActionKey(candidate) === button.dataset.reviewAction);
      if (!sourceAction || sourceAction.type !== 'update') return;
      if (button.hasAttribute('data-review-row')) {
        const currentlyExcluded = Boolean(APP.review?.excludedRows?.has?.(planReviewActionKey(sourceAction)));
        setPlanReviewRow(APP.review, sourceAction, !currentlyExcluded);
      } else if (button.hasAttribute('data-review-change')) {
        const changeKey = button.dataset.reviewChange;
        const currentlyExcluded = reviewExcludedChanges(APP.review, sourceAction).has(changeKey);
        setPlanReviewChange(APP.review, sourceAction, changeKey, !currentlyExcluded);
      }
      renderPlan(APP.plan);
    };

    const executableCount = reviewed.actions.filter(action => action.type !== 'noop').length;
    const apply = document.querySelector('#tms-apply');
    if (apply) {
      apply.disabled = !executableCount || Boolean(reviewedSafety.blocked);
      apply.textContent = executableCount ? `Применить к TESSA · ${executableCount}` : 'Применить к TESSA';
    }
  }

'''
text = text[:start] + render + text[end:]

# 4. Busy-state recovery must respect the reviewed plan too.
old = "      const apply = document.querySelector('#tms-apply');\n      if (apply) { const executable = Boolean(APP.plan?.actions?.some(a => a.type !== 'noop')); apply.disabled = !executable || Boolean(APP.plan?.safety?.blocked); apply.textContent = executable ? `Применить к TESSA · ${APP.plan.actions.filter(a => a.type !== 'noop').length}` : 'Применить к TESSA'; }"
new = "      const apply = document.querySelector('#tms-apply');\n      if (apply) { const reviewedPlan = buildReviewedPlan(APP.plan, APP.review); const executableCount = reviewedPlan?.actions?.filter(a => a.type !== 'noop').length || 0; apply.disabled = !executableCount || Boolean(reviewedPlan?.safety?.blocked); apply.textContent = executableCount ? `Применить к TESSA · ${executableCount}` : 'Применить к TESSA'; }"
if old not in text:
    raise SystemExit('setBusy apply anchor missing')
text = text.replace(old, new, 1)

# 5. Apply the reviewed effective plan, never the immutable source preview.
old = "      try { const result = await applyPlan(APP.plan); if (result) alert(`Готово."
new = "      try { const reviewedPlan = buildReviewedPlan(APP.plan, APP.review); const result = await applyPlan(reviewedPlan); if (result) alert(`Готово."
if old not in text:
    raise SystemExit('apply handler anchor missing')
text = text.replace(old, new, 1)

# 6. Review controls and muted visual state.
old = ".tms-action summary{cursor:pointer}.tms-action-body{padding:8px 2px 1px}.tms-diff{padding:7px 0;border-top:1px dashed #e5e5e5}.tms-before{color:#8a3232}.tms-after{color:#17683a}.tms-empty"
new = ".tms-action summary{cursor:pointer}.tms-action-body{padding:8px 2px 1px}.tms-review-row-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 0 8px}.tms-review-btn{border:1px solid #d6d6d6;background:#fff;color:#555;border-radius:9px;padding:5px 8px;font:600 11px/1.2 Arial,sans-serif;cursor:pointer}.tms-review-btn:hover{border-color:#aaa;background:#f8f8f8}.tms-review-btn[aria-pressed=\"true\"]{border-color:#b9b9b9;background:#f0f0f0;color:#444}.tms-diff{padding:7px 0;border-top:1px dashed #e5e5e5;transition:.15s opacity,.15s background}.tms-diff-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.tms-diff-excluded{opacity:.58;background:#f7f7f7;margin:0 -6px;padding:7px 6px}.tms-diff-excluded .tms-before,.tms-diff-excluded .tms-after{text-decoration:line-through}.tms-review-row-excluded{background:#f7f7f7;border-left-color:#aaa}.tms-review-state{font-size:10px;color:#777;font-weight:700}.tms-review-note{margin-top:8px;padding:9px 11px;border-radius:11px;background:#f4f7fb;color:#485466;border:1px solid #dbe3ee}.tms-before{color:#8a3232}.tms-after{color:#17683a}.tms-empty"
if old not in text:
    raise SystemExit('CSS review anchor missing')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
