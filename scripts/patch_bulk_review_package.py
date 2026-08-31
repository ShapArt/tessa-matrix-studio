from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')

def replace_once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 marker, got {count}')
    text = text.replace(old, new, 1)

# Pure helper: turn the current Preview filter into an exact executable package.
old = """  function createPlanReviewState() {\n    return { excludedRows: new Set(), excludedChanges: new Map() };\n  }\n\n  function planReviewActionKey(action) {\n"""
new = """  function createPlanReviewState() {\n    return { excludedRows: new Set(), excludedChanges: new Map() };\n  }\n\n  /**\n   * Keeps only the first N executable operations from the requested Preview filter.\n   * Everything outside that package is represented through ordinary review exclusions,\n   * so Planner/Apply stay unchanged and the user can restore the full plan at any time.\n   */\n  function keepReviewedPackage(plan, review = null, options = {}) {\n    if (!plan) return review || createPlanReviewState();\n    const filter = ['all', 'update', 'add', 'delete'].includes(options.filter) ? options.filter : 'all';\n    if (options.filter === 'skip') throw new Error('Пропущенные строки нельзя включить в пакет Apply.');\n    const limit = Math.max(0, Math.min(2000, Math.trunc(Number(options.limit) || 0)));\n    const state = review || createPlanReviewState();\n    const executable = (plan.actions || []).filter(action => action?.type && action.type !== 'noop');\n    const candidates = executable.filter(action => filter === 'all' || action.type === filter);\n    const keepKeys = new Set(candidates.slice(0, limit).map(planReviewActionKey));\n\n    executable.forEach(action => {\n      const key = planReviewActionKey(action);\n      if (keepKeys.has(key)) state.excludedRows.delete(key);\n      else state.excludedRows.add(key);\n    });\n    return state;\n  }\n\n  function planReviewActionKey(action) {\n"""
replace_once(old, new, 'helper insertion')

# Preview toolbar controls. Default to one operation because this is the safest live-UAT path.
old = """      <input id=\"tms-preview-query\" class=\"tms-preview-query\" type=\"search\" placeholder=\"Найти строку или значение\" value=\"${escapeHtml(selection.query)}\">\n      <div class=\"tms-preview-pager\">\n"""
new = """      <input id=\"tms-preview-query\" class=\"tms-preview-query\" type=\"search\" placeholder=\"Найти строку или значение\" value=\"${escapeHtml(selection.query)}\">\n      <div class=\"tms-preview-package\">\n        <strong>Пакет для Apply</strong>\n        <select id=\"tms-review-package-limit\" aria-label=\"Размер пакета Apply\">\n          <option value=\"1\">1</option><option value=\"10\">10</option><option value=\"100\">100</option><option value=\"500\">500</option><option value=\"2000\">2000</option>\n        </select>\n        <button type=\"button\" data-review-package=\"keep\" ${selection.filter === 'skip' ? 'disabled' : ''}>Оставить в Apply</button>\n        <button type=\"button\" data-review-package=\"reset\">Вернуть всё</button>\n        <span>${selection.filter === 'all' ? 'Из всех операций' : selection.filter === 'skip' ? 'Пропущенные строки не применяются' : `Только: ${selection.filter === 'update' ? 'изменить' : selection.filter === 'add' ? 'добавить' : 'удалить'}`}</span>\n      </div>\n      <div class=\"tms-preview-pager\">\n"""
replace_once(old, new, 'toolbar insertion')

# Delegate bulk package controls before per-row review handling.
old = """      const button = event.target?.closest?.('button[data-review-action]');\n      if (!button || !APP.plan || APP.busy) return;\n"""
new = """      const packageButton = event.target?.closest?.('button[data-review-package]');\n      if (packageButton && APP.plan && !APP.busy) {\n        if (packageButton.dataset.reviewPackage === 'reset') {\n          APP.review = createPlanReviewState();\n        } else if (packageButton.dataset.reviewPackage === 'keep') {\n          const limitInput = table.querySelector?.('#tms-review-package-limit') || document.querySelector('#tms-review-package-limit');\n          const limit = Math.max(0, Math.trunc(Number(limitInput?.value) || 0));\n          APP.review = keepReviewedPackage(APP.plan, APP.review, { filter: APP.previewView.filter, limit });\n        }\n        APP.previewView = createPreviewViewState({ ...APP.previewView, page: 1 });\n        renderPlan(APP.plan);\n        return;\n      }\n\n      const button = event.target?.closest?.('button[data-review-action]');\n      if (!button || !APP.plan || APP.busy) return;\n"""
replace_once(old, new, 'click handler insertion')

# Styling kept compact so the panel does not get taller than necessary.
old = ".tms-preview-filters{display:flex;gap:5px;flex-wrap:wrap}.tms-preview-filter,.tms-preview-pager button{border:1px solid #d8d8d8;background:#fff;border-radius:8px;padding:5px 8px;font:600 10px/1.2 Arial,sans-serif;cursor:pointer}.tms-preview-filter.tms-active{border-color:var(--tms-red);color:var(--tms-red-dark);background:#fff4f4}.tms-preview-query{width:100%;box-sizing:border-box;border:1px solid #d8d8d8;border-radius:9px;padding:7px 9px;font:12px Arial,sans-serif}"
new = ".tms-preview-filters{display:flex;gap:5px;flex-wrap:wrap}.tms-preview-package{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:7px 8px;border:1px solid #e6e6e6;border-radius:9px;background:#fff}.tms-preview-package strong{font-size:10px;color:#555;margin-right:auto}.tms-preview-package select,.tms-preview-package button{border:1px solid #d8d8d8;background:#fff;border-radius:8px;padding:5px 7px;font:600 10px/1.2 Arial,sans-serif}.tms-preview-package button{cursor:pointer}.tms-preview-package button:hover{border-color:#aaa;background:#fafafa}.tms-preview-package button:disabled{opacity:.4;cursor:not-allowed}.tms-preview-package span{flex-basis:100%;font-size:9px;color:#777}.tms-preview-filter,.tms-preview-pager button{border:1px solid #d8d8d8;background:#fff;border-radius:8px;padding:5px 8px;font:600 10px/1.2 Arial,sans-serif;cursor:pointer}.tms-preview-filter.tms-active{border-color:var(--tms-red);color:var(--tms-red-dark);background:#fff4f4}.tms-preview-query{width:100%;box-sizing:border-box;border:1px solid #d8d8d8;border-radius:9px;padding:7px 9px;font:12px Arial,sans-serif}"
replace_once(old, new, 'style insertion')

# Test export.
old = "createPlanReviewState, planReviewActionKey, setPlanReviewChange, setPlanReviewRow, buildReviewedPlan, createPreviewViewState, selectPreviewItems,"
new = "createPlanReviewState, keepReviewedPackage, planReviewActionKey, setPlanReviewChange, setPlanReviewRow, buildReviewedPlan, createPreviewViewState, selectPreviewItems,"
replace_once(old, new, 'test export')

path.write_text(text, encoding='utf-8')
print('bulk package review patch applied')
