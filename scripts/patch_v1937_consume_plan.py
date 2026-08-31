from pathlib import Path

p = Path('tessa-matrix-studio.user.js')
s = p.read_text(encoding='utf-8')

def once(old, new, label):
    global s
    if old not in s:
        raise SystemExit(f'{label} missing')
    s = s.replace(old, new, 1)

anchor = """  function createPlanReviewState() {\n    return { excludedRows: new Set(), excludedChanges: new Map() };\n  }\n"""
addition = anchor + """\n  // Любая реально начатая запись делает текущий Preview устаревшим. Даже если ответ\n  // Store/Delete неоднозначен, повторно применять тот же план нельзя без свежего чтения.\n  function invalidatePlanStateAfterApply(state, result) {\n    if (!state) return false;\n    const started = Math.max(0, Number(result?.startedCount || 0));\n    const applied = Math.max(0, Number(result?.appliedCount || 0));\n    if (!started && !applied) return false;\n    state.plan = null;\n    state.snapshot = null;\n    state.bridge = null;\n    state.review = createPlanReviewState();\n    state.previewView = createPreviewViewState();\n    return true;\n  }\n\n  function renderPlanConsumedNotice(result) {\n    const summary = document.querySelector?.('#tms-summary');\n    const table = document.querySelector?.('#tms-plan');\n    const applied = Math.max(0, Number(result?.appliedCount || 0));\n    if (summary) summary.innerHTML = `<div class=\"tms-review-note\"><b>Нужна свежая проверка.</b> В TESSA уже началась запись${applied ? `: применено ${applied}` : ''}. Старый Preview больше нельзя применять повторно. Скачайте свежий Excel или обновите страницу, затем снова нажмите «Проверить изменения».</div>`;\n    if (table) table.innerHTML = '';\n  }\n"""
once(anchor, addition, 'review state anchor')

old_handler = """      try { const reviewedPlan = buildReviewedPlan(APP.plan, APP.review); const result = await applyPlan(reviewedPlan); if (result) alert(applyResultMessage(result)); }\n"""
new_handler = """      try {\n        const reviewedPlan = buildReviewedPlan(APP.plan, APP.review);\n        const result = await applyPlan(reviewedPlan);\n        if (result) {\n          if (invalidatePlanStateAfterApply(APP, result)) renderPlanConsumedNotice(result);\n          alert(applyResultMessage(result));\n        }\n      }\n"""
once(old_handler, new_handler, 'Apply result handler')

old_export = """    createPlanReviewState, keepReviewedPackage, planReviewActionKey, setPlanReviewChange, setPlanReviewRow, buildReviewedPlan, createPreviewViewState, selectPreviewItems,\n"""
new_export = """    createPlanReviewState, invalidatePlanStateAfterApply, keepReviewedPackage, planReviewActionKey, setPlanReviewChange, setPlanReviewRow, buildReviewedPlan, createPreviewViewState, selectPreviewItems,\n"""
once(old_export, new_export, 'test export')

p.write_text(s, encoding='utf-8')
