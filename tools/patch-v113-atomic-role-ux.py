from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
s = path.read_text(encoding='utf-8')
marker = 'ATOMIC_CROSS_MATRIX_REPLACEMENT_PREVIEW_V1'
if marker in s:
    print(f'{marker} already installed')
    raise SystemExit(0)

needle = "  function applyPreflightPreview(plan, preflight) {\n"
helper = """  // ATOMIC_CROSS_MATRIX_REPLACEMENT_PREVIEW_V1
  function crossMatrixReplacementIntegrity(plan, extraSkippedRows = []) {
    if (!plan?.crossMatrixReplacement?.enabled) return { blocked: false, reason: null, skippedCount: 0, skippedFieldCount: 0, reviewExcludedCount: 0 };
    const skippedRows = [...(plan.skippedRows || []), ...(extraSkippedRows || [])];
    const skippedFieldCount = (plan.skippedFields || []).length;
    const reviewExcludedCount = (plan.actions || []).filter(action => Boolean(action?.reviewExcluded)).length;
    if (!skippedRows.length && !skippedFieldCount && !reviewExcludedCount) {
      return { blocked: false, reason: null, skippedCount: 0, skippedFieldCount: 0, reviewExcludedCount: 0 };
    }
    const pieces = [];
    if (skippedRows.length) pieces.push(`${skippedRows.length} строк не могут быть перенесены`);
    if (skippedFieldCount) pieces.push(`${skippedFieldCount} полей нельзя применить`);
    if (reviewExcludedCount) pieces.push(`${reviewExcludedCount} операций исключены вручную`);
    return {
      blocked: true,
      skippedCount: skippedRows.length,
      skippedFieldCount,
      reviewExcludedCount,
      reason: `Перенос из другой матрицы неполный: ${pieces.join(' и ')}. Для полного переноса частичное применение запрещено: ни добавление, ни удаление строк TESSA не начнётся. Исправьте все ошибки исходного Excel и верните все операции в выбранный набор, затем повторите проверку.`,
    };
  }

"""
if needle not in s:
    raise RuntimeError('applyPreflightPreview marker missing')
s = s.replace(needle, helper + needle, 1)

old = """    const serverAddValidationSkipped = Boolean(preflight?.previewPolicy?.skipServerAddValidation);
    if (serverAddValidationSkipped && preflight?.previewPolicy?.reason) warnings.push(preflight.previewPolicy.reason);
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
        serverAddValidationSkipped,
        applyBlockedByBatch: Boolean(preflight?.previewPolicy?.applyBlocked),
        validatedAt: nowIso(),
      },
    };
"""
new = """    const serverAddValidationSkipped = Boolean(preflight?.previewPolicy?.skipServerAddValidation);
    if (serverAddValidationSkipped && preflight?.previewPolicy?.reason) warnings.push(preflight.previewPolicy.reason);
    const replacementIntegrity = crossMatrixReplacementIntegrity({ ...plan, skippedRows });
    const safety = plan.safety
      ? { ...plan.safety, blockedReasons: [...(plan.safety.blockedReasons || [])] }
      : { blocked: false, blockedReasons: [], suppressUnsafePreview: false };
    if (replacementIntegrity.blocked) {
      safety.blocked = true;
      safety.blockedReasons = [...new Set([...safety.blockedReasons, replacementIntegrity.reason])];
      if (!warnings.includes(replacementIntegrity.reason)) warnings.push(replacementIntegrity.reason);
    }
    return {
      ...plan,
      actions,
      skippedRows,
      warnings,
      safety,
      counts: countActions(actions, skippedRows),
      preflightPreview: {
        validated: true,
        runtimeSkipCount,
        attemptedCount: (plan.actions || []).filter(action => action.type !== 'noop').length,
        executableCount: actions.filter(action => action.type !== 'noop').length,
        serverAddValidationSkipped,
        applyBlockedByBatch: Boolean(preflight?.previewPolicy?.applyBlocked),
        atomicReplacementBlocked: replacementIntegrity.blocked,
        atomicReplacementReason: replacementIntegrity.reason,
        validatedAt: nowIso(),
      },
    };
"""
if old not in s:
    raise RuntimeError('applyPreflightPreview return block missing')
s = s.replace(old, new, 1)

old = """    reviewed.safety = safety;
    reviewed.reviewIssues = [...new Set([...localizedDuplicates.localizedIssues, ...localizedDuplicates.unresolvedIssues])];
    return reviewed;
"""
new = """    const replacementIntegrity = crossMatrixReplacementIntegrity(reviewed);
    if (replacementIntegrity.blocked) {
      safety.blocked = true;
      safety.blockedReasons = [...new Set([...safety.blockedReasons, replacementIntegrity.reason])];
    }
    reviewed.safety = safety;
    reviewed.reviewIssues = [...new Set([...localizedDuplicates.localizedIssues, ...localizedDuplicates.unresolvedIssues])];
    return reviewed;
"""
if old not in s:
    raise RuntimeError('buildReviewedPlan safety block missing')
s = s.replace(old, new, 1)

old = """  async function applyPlan(plan) {
    if (!plan) throw new Error('Сначала проверьте Excel.');
    if (plan?.safety?.blocked) throw new Error(`Файл нельзя применить: ${plan.safety.blockedReasons.join(' ')}`);
"""
new = """  async function applyPlan(plan) {
    if (!plan) throw new Error('Сначала проверьте Excel.');
    const replacementIntegrity = crossMatrixReplacementIntegrity(plan);
    if (replacementIntegrity.blocked) throw new Error(replacementIntegrity.reason);
    if (plan?.safety?.blocked) throw new Error(`Файл нельзя применить: ${plan.safety.blockedReasons.join(' ')}`);
"""
if old not in s:
    raise RuntimeError('applyPlan prefix missing')
s = s.replace(old, new, 1)

old = """    const detail = visible
      ? `Корректных изменений: ${visible}${skipped ? ` · пропустить строк: ${skipped}` : ''}${previewPlan.skippedFields?.length ? ` · не применяются поля: ${previewPlan.skippedFields.length}` : ''}`
      : (skipped ? `Нет изменений для применения · пропущено строк: ${skipped}` : 'Изменений нет');
    setProgress(100, 'Проверка завершена', detail);
"""
new = """    const detail = visible
      ? `Корректных изменений: ${visible}${skipped ? ` · пропустить строк: ${skipped}` : ''}${previewPlan.skippedFields?.length ? ` · не применяются поля: ${previewPlan.skippedFields.length}` : ''}`
      : (skipped ? `Нет изменений для применения · пропущено строк: ${skipped}` : 'Изменений нет');
    const atomicReplacementReason = previewPlan.preflightPreview?.atomicReplacementReason || null;
    setProgress(100, atomicReplacementReason ? 'Перенос заблокирован' : 'Проверка завершена', atomicReplacementReason || detail);
"""
if old not in s:
    raise RuntimeError('analyze progress block missing')
s = s.replace(old, new, 1)

old = """  function pickerCompactList(value, limit = 180) {
    const unique = [...new Set(String(value || '').split(/\\s*;\\s*/).map(normalizeSpace).filter(Boolean))];
    const text = unique.join(', ');
    return text.length > limit ? `${text.slice(0, Math.max(1, limit - 1))}…` : text;
  }

  function pickerEntryPresentation(item) {
    const value = String(item?.selector || item?.display || '').trim();
    const roleType = canonicalValue(item?.roleTypeId);
    const roleFullName = pickerDetailValue(item, ['RoleFullName', 'UserFullName']);
    const position = pickerCompactList(pickerDetailValue(item, ['RolePositionName', 'UserPosition', 'PositionName', 'Position']));
    const department = pickerCompactList(pickerDetailValue(item, ['Departments', 'UserDepartment', 'Department', 'Info']));
    const isPerson = roleType === '1' || Boolean(roleFullName);
    const title = isPerson ? (roleFullName || normalizeSpace(item?.qualifier) || normalizeSpace(item?.display) || value) : (normalizeSpace(item?.display) || value);
    const typeLabel = roleType ? previewRoleTypeLabel(roleType) : '';
    const subtitle = [...new Set([position, department, typeLabel].filter(Boolean))].join(' · ');
    return { title, subtitle, typeLabel, value };
  }
"""
new = """  function pickerCompactValues(value) {
    return [...new Set(String(value || '').split(/\\s*;\\s*|[\\r\\n]+/).map(normalizeSpace).filter(Boolean))];
  }

  function pickerCompactList(value, limit = 180) {
    const unique = pickerCompactValues(value);
    const text = unique.join(', ');
    return text.length > limit ? `${text.slice(0, Math.max(1, limit - 1))}…` : text;
  }

  function pickerPrimaryValue(value) {
    const unique = pickerCompactValues(value);
    if (!unique.length) return '';
    return `${unique[0]}${unique.length > 1 ? ` (+${unique.length - 1})` : ''}`;
  }

  function pickerEntryPresentation(item) {
    const value = String(item?.selector || item?.display || '').trim();
    const roleType = canonicalValue(item?.roleTypeId);
    const display = normalizeSpace(item?.display);
    const roleFullName = pickerDetailValue(item, ['RoleFullName', 'UserFullName']);
    const positionRaw = pickerDetailValue(item, ['RolePositionName', 'UserPosition', 'PositionName', 'Position']);
    const position = pickerPrimaryValue(positionRaw);
    const department = pickerCompactList(pickerDetailValue(item, ['Departments', 'UserDepartment', 'Department', 'Info']));
    const isPerson = roleType === '1' || Boolean(roleFullName);
    const titleBase = display || roleFullName || normalizeSpace(item?.qualifier) || value;
    const title = isPerson && position ? `${titleBase} — ${position}` : titleBase;
    const typeLabel = roleType ? previewRoleTypeLabel(roleType) : '';
    const subtitle = [...new Set([isPerson && roleFullName && canonicalValue(roleFullName) !== canonicalValue(titleBase) ? roleFullName : '', department, typeLabel].filter(Boolean))].join(' · ');
    return { title, subtitle, typeLabel, value };
  }
"""
if old not in s:
    raise RuntimeError('picker presentation block missing')
s = s.replace(old, new, 1)

old = """    preflightPlan, applyPreflightPreview, verifyCrossMatrixRollback, finalizeCrossMatrixTransferVerification, applyPlan, requestApplyAbort, hydrateMissingIdsForAction, nativeEditAccessState, assertNativeEditMode, isWritableMatrixDraft, assertWritableMatrixDraft,
"""
new = """    preflightPlan, applyPreflightPreview, crossMatrixReplacementIntegrity, verifyCrossMatrixRollback, finalizeCrossMatrixTransferVerification, applyPlan, requestApplyAbort, hydrateMissingIdsForAction, nativeEditAccessState, assertNativeEditMode, isWritableMatrixDraft, assertWritableMatrixDraft,
"""
if old not in s:
    raise RuntimeError('test export block missing')
s = s.replace(old, new, 1)

path.write_text(s, encoding='utf-8')
print('ATOMIC_CROSS_MATRIX_REPLACEMENT_PREVIEW_V1 installed')
