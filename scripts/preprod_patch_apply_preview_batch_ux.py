from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')

# 1) Add one pure availability helper immediately after evaluateApplyBatch.
old = '''    return { count, warning, blocked, reason };\n  }\n\n  function previewPreflightPolicy(actions) {'''
new = '''    return { count, warning, blocked, reason };\n  }\n\n  function applyAvailability(plan, review = null) {\n    const reviewed = buildReviewedPlan(plan, review);\n    const safety = reviewed?.safety || plan?.safety || { blocked: false, blockedReasons: [] };\n    const batch = evaluateApplyBatch(reviewed?.actions || []);\n    const safetyReasons = safety.blocked ? [...(safety.blockedReasons || [])] : [];\n    const blockedReasons = batch.blocked ? [...safetyReasons, batch.reason].filter(Boolean) : safetyReasons;\n    const blocked = Boolean(safety.blocked || batch.blocked);\n    const canApply = Boolean(batch.count > 0 && !blocked);\n    const label = batch.blocked\n      ? `Пакет слишком большой · ${batch.count} / 2000`\n      : batch.count\n        ? `Применить к TESSA · ${batch.count}`\n        : 'Применить к TESSA';\n    return {\n      count: batch.count,\n      warning: batch.warning,\n      blocked,\n      batchBlocked: batch.blocked,\n      canApply,\n      reason: batch.blocked ? batch.reason : (blockedReasons[0] || null),\n      blockedReasons,\n      label,\n    };\n  }\n\n  function previewPreflightPolicy(actions) {'''
if text.count(old) != 1:
    raise SystemExit(f'applyAvailability insertion marker count={text.count(old)}')
text = text.replace(old, new, 1)

# 2) Compute availability once in renderPlan and show the batch blocker inline.
old = '''    const reviewed = buildReviewedPlan(plan, APP.review);\n    const c = reviewed.counts;'''
new = '''    const reviewed = buildReviewedPlan(plan, APP.review);\n    const applyState = applyAvailability(plan, APP.review);\n    const c = reviewed.counts;'''
if text.count(old) != 1:
    raise SystemExit(f'render applyState marker count={text.count(old)}')
text = text.replace(old, new, 1)

# Insert the inline blocked-batch card immediately before the skipped-row details.
skip_anchor = '      ${skipped.length ? `<details class=\\"tms-skipped-box\\">'
if text.count(skip_anchor) != 1:
    raise SystemExit(f'skip anchor count={text.count(skip_anchor)}')
batch_card = '      ${applyState.batchBlocked ? `<div class=\\"tms-fatal\\"><b>Пакет слишком большой для одного Apply</b><br>${escapeHtml(applyState.reason || \'\')}<br><span class=\\"tms-review-state\\">Preview остаётся доступен: можно проверить все строки и подготовить меньший контролируемый пакет.</span></div>` : \'\'}\n'
text = text.replace(skip_anchor, batch_card + skip_anchor, 1)

old = '${skipped.length}</b> · корректные изменения можно применить</summary>'
new = "${skipped.length}</b> · ${applyState.blocked ? 'корректные строки проверены, но Apply сейчас заблокирован' : 'корректные изменения можно применить'}</summary>"
if text.count(old) != 1:
    raise SystemExit(f'skipped summary marker count={text.count(old)}')
text = text.replace(old, new, 1)

# 3) Replace the render-time Apply button state with the shared availability helper.
old = '''    const executableCount = reviewed.actions.filter(action => action.type !== 'noop').length;\n    const apply = document.querySelector('#tms-apply');\n    if (apply) {\n      apply.disabled = !executableCount || Boolean(reviewedSafety.blocked);\n      apply.textContent = executableCount ? `Применить к TESSA · ${executableCount}` : 'Применить к TESSA';\n    }'''
new = '''    const apply = document.querySelector('#tms-apply');\n    if (apply) {\n      apply.disabled = !applyState.canApply;\n      apply.textContent = applyState.label;\n      apply.title = applyState.blocked ? (applyState.reason || 'Применение заблокировано') : '';\n    }\n    const applyNote = document.querySelector('#tms-apply-note');\n    if (applyNote) {\n      applyNote.textContent = applyState.batchBlocked\n        ? `Нужно уменьшить пакет: сейчас ${applyState.count}, максимум 2000 операций за один Apply.`\n        : applyState.warning\n          ? `Большой пакет: ${applyState.count} операций. Перед записью потребуется дополнительное подтверждение.`\n          : '';\n    }'''
if text.count(old) != 1:
    raise SystemExit(f'render apply button marker count={text.count(old)}')
text = text.replace(old, new, 1)

# 4) Add an inline caption under the button.
old = '''<div class=\\"tms-step tms-step-apply\\"><div class=\\"tms-step-label\\">4 · Применить корректные строки</div><button id=\\"tms-apply\\" class=\\"tms-primary\\" disabled>Применить к TESSA</button></div>'''
new = '''<div class=\\"tms-step tms-step-apply\\"><div class=\\"tms-step-label\\">4 · Применить корректные строки</div><button id=\\"tms-apply\\" class=\\"tms-primary\\" disabled>Применить к TESSA</button><div id=\\"tms-apply-note\\" class=\\"tms-step-caption\\"></div></div>'''
if text.count(old) != 1:
    raise SystemExit(f'apply caption marker count={text.count(old)}')
text = text.replace(old, new, 1)

# 5) setBusy(false) must restore the exact same blocked state, not re-enable >2000.
old = '''      const apply = document.querySelector('#tms-apply');\n      if (apply) { const reviewedPlan = buildReviewedPlan(APP.plan, APP.review); const executableCount = reviewedPlan?.actions?.filter(a => a.type !== 'noop').length || 0; apply.disabled = !executableCount || Boolean(reviewedPlan?.safety?.blocked); apply.textContent = executableCount ? `Применить к TESSA · ${executableCount}` : 'Применить к TESSA'; }'''
new = '''      const apply = document.querySelector('#tms-apply');\n      if (apply) { const availability = applyAvailability(APP.plan, APP.review); apply.disabled = !availability.canApply; apply.textContent = availability.label; apply.title = availability.blocked ? (availability.reason || 'Применение заблокировано') : ''; }\n      const applyNote = document.querySelector('#tms-apply-note');\n      if (applyNote) { const availability = applyAvailability(APP.plan, APP.review); applyNote.textContent = availability.batchBlocked ? `Нужно уменьшить пакет: сейчас ${availability.count}, максимум 2000 операций за один Apply.` : availability.warning ? `Большой пакет: ${availability.count} операций. Перед записью потребуется дополнительное подтверждение.` : ''; }'''
if text.count(old) != 1:
    raise SystemExit(f'setBusy apply marker count={text.count(old)}')
text = text.replace(old, new, 1)

# 6) Defense in depth in click handler: predictable Preview blockers are not error reports.
old = '''    panel.querySelector('#tms-apply').addEventListener('click', async () => {\n      if (APP.busy) return; setBusy(true);\n      try { const reviewedPlan = buildReviewedPlan(APP.plan, APP.review); const result = await applyPlan(reviewedPlan); if (result) alert(applyResultMessage(result)); }'''
new = '''    panel.querySelector('#tms-apply').addEventListener('click', async () => {\n      if (APP.busy) return;\n      const availability = applyAvailability(APP.plan, APP.review);\n      if (!availability.canApply) {\n        setProgress(100, 'Apply недоступен', availability.reason || 'Нет операций для применения.');\n        return;\n      }\n      setBusy(true);\n      try { const reviewedPlan = buildReviewedPlan(APP.plan, APP.review); const result = await applyPlan(reviewedPlan); if (result) alert(applyResultMessage(result)); }'''
if text.count(old) != 1:
    raise SystemExit(f'click guard marker count={text.count(old)}')
text = text.replace(old, new, 1)

# 7) Export the helper for regression tests.
old = '''typedScalarSemantic, typedRangeSemantic, deletionGuard, evaluateApplyBatch, previewPreflightPolicy, finalizeApplyResult'''
new = '''typedScalarSemantic, typedRangeSemantic, deletionGuard, evaluateApplyBatch, applyAvailability, previewPreflightPolicy, finalizeApplyResult'''
if text.count(old) != 1:
    raise SystemExit(f'export marker count={text.count(old)}')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
