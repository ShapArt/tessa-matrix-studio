from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')

marker = "  function createPlanReviewState() {\n"
helper = """  /**\n   * Глобальная ошибка контекста (другая MatrixID/TemplateID, неподходящее состояние\n   * и т.п.) делает построчный diff нерелевантным. Сохраняем кандидатов только для\n   * диагностики, а пользовательскому Preview показываем один авторитетный blocker.\n   */\n  function suppressUnsafePlanPreview(plan) {\n    if (!plan) return plan;\n    plan.candidateCounts = { ...(plan.counts || countActions([], [])) };\n    plan.candidateActions = Array.isArray(plan.actions) ? plan.actions : [];\n    plan.candidateSkippedRows = Array.isArray(plan.skippedRows) ? plan.skippedRows : [];\n    plan.actions = [];\n    plan.skippedRows = [];\n    plan.counts = countActions([], []);\n    plan.previewSuppressed = true;\n    return plan;\n  }\n\n"""
if 'function suppressUnsafePlanPreview(plan)' not in text:
    if marker not in text:
        raise SystemExit('createPlanReviewState marker not found')
    text = text.replace(marker, helper + marker, 1)

old = """      if (plan.safety.suppressUnsafePreview) {\n        plan.candidateCounts = { ...plan.counts };\n        plan.candidateActions = plan.actions;\n        plan.actions = [];\n        plan.counts = countActions([], plan.skippedRows);\n        plan.previewSuppressed = true;\n"""
new = """      if (plan.safety.suppressUnsafePreview) {\n        suppressUnsafePlanPreview(plan);\n"""
if old not in text:
    raise SystemExit('unsafe preview suppression block not found')
text = text.replace(old, new, 1)

old_export = '    createPlanReviewState, invalidatePlanStateAfterApply, keepReviewedPackage, planReviewActionKey,'
new_export = '    createPlanReviewState, suppressUnsafePlanPreview, invalidatePlanStateAfterApply, keepReviewedPackage, planReviewActionKey,'
if old_export not in text:
    raise SystemExit('test export marker not found')
text = text.replace(old_export, new_export, 1)

path.write_text(text, encoding='utf-8')
print('global blocker preview suppression patched')
