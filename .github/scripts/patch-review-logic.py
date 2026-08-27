from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')

anchor = "  function compactPlanForExport(plan) {\n"
if anchor not in text:
    raise SystemExit('compactPlanForExport anchor missing')

helpers = r'''  function createPlanReviewState() {
    return { excludedRows: new Set(), excludedChanges: new Map() };
  }

  function planReviewActionKey(action) {
    const excelRow = Number(action?.excelRow?.excelRow) || 0;
    const versionId = canonicalValue(action?.currentRow?.versionId || '');
    const rowCardId = canonicalValue(action?.currentRow?.rowCardId || '');
    return `${action?.type || 'action'}:${excelRow}:${versionId || rowCardId || 'new'}`;
  }

  function reviewExcludedChanges(review, action) {
    const key = planReviewActionKey(action);
    return review?.excludedChanges?.get?.(key) || new Set();
  }

  function setPlanReviewChange(review, action, changeKey, excluded) {
    if (!review || !action || !changeKey) return review;
    const actionKey = planReviewActionKey(action);
    let set = review.excludedChanges.get(actionKey);
    if (!set) {
      set = new Set();
      review.excludedChanges.set(actionKey, set);
    }
    if (excluded) set.add(changeKey);
    else set.delete(changeKey);
    if (!set.size) review.excludedChanges.delete(actionKey);
    return review;
  }

  function setPlanReviewRow(review, action, excluded) {
    if (!review || !action) return review;
    const actionKey = planReviewActionKey(action);
    if (excluded) review.excludedRows.add(actionKey);
    else {
      review.excludedRows.delete(actionKey);
      // «Вернуть все» означает именно полный возврат строки, включая ранее
      // отключённые отдельные поля.
      review.excludedChanges.delete(actionKey);
    }
    return review;
  }

  function currentIdsForReview(currentRow, column) {
    if (!currentRow || !column) return [];
    if (column.kind === 'function') {
      return (currentRow.roles?.[column.id] || []).map(item => {
        const id = normalizeSpace(item?.id ?? '');
        if (!id) return '';
        const roleTypeId = item?.roleTypeId;
        return roleTypeId === null || roleTypeId === undefined || roleTypeId === '' ? id : `${id}|${roleTypeId}`;
      });
    }
    const kind = operandKind(column);
    if (kind !== 'ReferenceGuid' && kind !== 'ReferenceInt' && !column.refSection) return [];
    return (currentRow.values?.[column.id] || []).map(item => item?.id === null || item?.id === undefined ? '' : String(item.id));
  }

  function reviewedExcelRow(action, excludedKeys) {
    const source = action?.excelRow;
    const current = action?.currentRow;
    if (!source || !current || !excludedKeys?.size) return source;
    const flat = { ...(source.flat || {}) };
    const ids = { ...(source.ids || {}) };
    const compare = { ...(source.compare || {}) };
    const columns = new Map(source.columns || []);
    const byKey = new Map([...columns.values()].map(column => [column.key, column]));
    for (const key of excludedKeys) {
      const column = byKey.get(key);
      flat[key] = [...(current.flat?.[key] || [])];
      if (column) {
        ids[key] = currentIdsForReview(current, column);
        compare[key] = currentCompareValues(current, column);
      } else {
        ids[key] = [];
        compare[key] = [...(flat[key] || [])].map(value => `value:${canonicalValue(value)}`);
      }
    }
    return {
      ...source,
      flat,
      ids,
      compare,
      columns,
      fingerprint: fingerprintFlat(flat),
      compareFingerprint: fingerprintFlat(compare),
    };
  }

  function buildReviewedPlan(plan, review = null) {
    if (!plan) return null;
    const state = review || createPlanReviewState();
    const actions = (plan.actions || []).map(action => {
      if (action.type !== 'update') return action;
      const actionKey = planReviewActionKey(action);
      const excludedKeys = new Set(reviewExcludedChanges(state, action));
      if (state.excludedRows?.has?.(actionKey)) {
        for (const change of action.changes || []) excludedKeys.add(change.key);
      }
      if (!excludedKeys.size) return action;
      const changes = (action.changes || []).filter(change => !excludedKeys.has(change.key));
      const excelRow = reviewedExcelRow(action, excludedKeys);
      if (!changes.length) {
        return { ...action, type: 'noop', changes: [], excelRow, reviewExcluded: true, originalType: 'update' };
      }
      return { ...action, changes, excelRow, reviewExcludedKeys: [...excludedKeys] };
    });

    const reviewed = {
      ...plan,
      actions,
      counts: countActions(actions, plan.skippedRows || []),
      reviewApplied: true,
    };

    // Частичная отмена меняет итоговую строку, поэтому заново проверяем дубли.
    // Иначе пользователь мог бы убрать одно поле и случайно собрать комбинацию,
    // уже существующую в другой строке TESSA.
    const duplicateIssues = detectPlanDuplicateConflicts(actions.filter(action => action.type !== 'noop'), plan.snapshot);
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

'''

text = text.replace(anchor, helpers + anchor, 1)

export_anchor = "    parseBoolean, parseRange, headerSimilarity, countActions, matrixStateCaption, operandKind, typedScalarSemantic, typedRangeSemantic, deletionGuard,\n"
export_replacement = export_anchor + "    createPlanReviewState, planReviewActionKey, setPlanReviewChange, setPlanReviewRow, buildReviewedPlan,\n"
if export_anchor not in text:
    raise SystemExit('exports anchor missing')
text = text.replace(export_anchor, export_replacement, 1)

path.write_text(text, encoding='utf-8')
