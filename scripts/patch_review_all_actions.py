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
"""    const actions = (plan.actions || []).map(action => {
      if (action.type !== 'update') return action;
      const actionKey = planReviewActionKey(action);
      const excludedKeys = new Set(reviewExcludedChanges(state, action));
      if (state.excludedRows?.has?.(actionKey)) {
        for (const change of action.changes || []) excludedKeys.add(change.key);
      }
      if (!excludedKeys.size) return action;""",
"""    const actions = (plan.actions || []).map(action => {
      const actionKey = planReviewActionKey(action);
      const rowExcluded = Boolean(state.excludedRows?.has?.(actionKey));
      // Whole-operation review is intentionally available for every mutation type.
      // ADD/DELETE are atomic from the review UI perspective; UPDATE additionally
      // supports per-field exclusions below.
      if (rowExcluded && (action.type === 'add' || action.type === 'delete')) {
        return { ...action, type: 'noop', changes: [], reviewExcluded: true, originalType: action.type };
      }
      if (action.type !== 'update') return action;
      const excludedKeys = new Set(reviewExcludedChanges(state, action));
      if (rowExcluded) {
        for (const change of action.changes || []) excludedKeys.add(change.key);
      }
      if (!excludedKeys.size) return action;""",
'buildReviewedPlan whole-operation exclusion')

replace_once(
"""      const rowExcluded = action.type === 'update' && Boolean(APP.review?.excludedRows?.has?.(actionKey));
      if (rowExcluded) item.classList.add('tms-review-row-excluded');""",
"""      const rowExcluded = Boolean(APP.review?.excludedRows?.has?.(actionKey));
      const supportsWholeActionReview = action.type === 'update' || action.type === 'add' || action.type === 'delete';
      if (rowExcluded) item.classList.add('tms-review-row-excluded');""",
'render generic row exclusion')

replace_once(
"""      const body = document.createElement('div');
      body.className = 'tms-action-body';

      if (action.type === 'update') {
        const excludedChanges = reviewExcludedChanges(APP.review, action);
        const rowButtonLabel = rowExcluded ? 'Вернуть все изменения строки' : 'Не применять всю строку';
        const rowsExcludedIndividually = (action.changes || []).filter(change => excludedChanges.has(change.key)).length;
        body.innerHTML = `
          <div class=\"tms-review-row-actions\">
            <button type=\"button\" class=\"tms-review-btn tms-review-row-btn\" data-review-action=\"${escapeHtml(actionKey)}\" data-review-row=\"true\" aria-pressed=\"${rowExcluded ? 'true' : 'false'}\">${rowButtonLabel}</button>
            ${!rowExcluded && rowsExcludedIndividually ? `<span class=\"tms-review-state\">Не применяется полей: ${rowsExcludedIndividually}</span>` : ''}
          </div>
          ${(action.changes || []).map(change => {""",
"""      const body = document.createElement('div');
      body.className = 'tms-action-body';
      const rowButtonLabel = action.type === 'update'
        ? (rowExcluded ? 'Вернуть все изменения строки' : 'Не применять всю строку')
        : (rowExcluded ? 'Вернуть операцию' : 'Не применять');
      const rowReviewControl = supportsWholeActionReview ? `
        <div class=\"tms-review-row-actions\">
          <button type=\"button\" class=\"tms-review-btn tms-review-row-btn\" data-review-action=\"${escapeHtml(actionKey)}\" data-review-row=\"true\" aria-pressed=\"${rowExcluded ? 'true' : 'false'}\">${rowButtonLabel}</button>
        </div>` : '';

      if (action.type === 'update') {
        const excludedChanges = reviewExcludedChanges(APP.review, action);
        const rowsExcludedIndividually = (action.changes || []).filter(change => excludedChanges.has(change.key)).length;
        body.innerHTML = `${rowReviewControl}
          ${!rowExcluded && rowsExcludedIndividually ? `<div class=\"tms-review-state\">Не применяется полей: ${rowsExcludedIndividually}</div>` : ''}
          ${(action.changes || []).map(change => {""",
'render row review control')

replace_once(
"""      } else if (action.type === 'add') body.innerHTML = flatToHtml(action.excelRow.flat, plan.columnMap);
      else body.innerHTML = flatToHtml(action.currentRow.flat, plan.columnMap);""",
"""      } else if (action.type === 'add') body.innerHTML = `${rowReviewControl}${flatToHtml(action.excelRow.flat, plan.columnMap)}`;
      else body.innerHTML = `${rowReviewControl}${flatToHtml(action.currentRow.flat, plan.columnMap)}`;""",
'render add delete review control')

replace_once(
"""      const sourceAction = (APP.plan.actions || []).find(candidate => planReviewActionKey(candidate) === button.dataset.reviewAction);
      if (!sourceAction || sourceAction.type !== 'update') return;
      if (button.hasAttribute('data-review-row')) {
        const currentlyExcluded = Boolean(APP.review?.excludedRows?.has?.(planReviewActionKey(sourceAction)));
        setPlanReviewRow(APP.review, sourceAction, !currentlyExcluded);
      } else if (button.hasAttribute('data-review-change')) {
        const changeKey = button.dataset.reviewChange;
        const currentlyExcluded = reviewExcludedChanges(APP.review, sourceAction).has(changeKey);
        setPlanReviewChange(APP.review, sourceAction, changeKey, !currentlyExcluded);
      }""",
"""      const sourceAction = (APP.plan.actions || []).find(candidate => planReviewActionKey(candidate) === button.dataset.reviewAction);
      if (!sourceAction) return;
      if (button.hasAttribute('data-review-row')) {
        const currentlyExcluded = Boolean(APP.review?.excludedRows?.has?.(planReviewActionKey(sourceAction)));
        setPlanReviewRow(APP.review, sourceAction, !currentlyExcluded);
      } else if (button.hasAttribute('data-review-change')) {
        if (sourceAction.type !== 'update') return;
        const changeKey = button.dataset.reviewChange;
        const currentlyExcluded = reviewExcludedChanges(APP.review, sourceAction).has(changeKey);
        setPlanReviewChange(APP.review, sourceAction, changeKey, !currentlyExcluded);
      }""",
'review click handler')

path.write_text(text, encoding='utf-8')
