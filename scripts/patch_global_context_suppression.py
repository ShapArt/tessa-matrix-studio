from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')

insert_marker = "  function evaluatePlanSafety(plan, bridge) {"
helper = """  function suppressPlanForUnsafeContext(plan) {\n    plan.candidateCounts = { ...plan.counts };\n    plan.candidateActions = plan.actions;\n    plan.candidateSkippedRows = plan.skippedRows;\n    plan.actions = [];\n    plan.skippedRows = [];\n    plan.counts = countActions([], []);\n    plan.previewSuppressed = true;\n    return plan;\n  }\n\n"""
if 'function suppressPlanForUnsafeContext(plan)' not in text:
    if text.count(insert_marker) != 1:
        raise SystemExit(f'expected one evaluatePlanSafety marker, got {text.count(insert_marker)}')
    text = text.replace(insert_marker, helper + insert_marker, 1)

old_block = """      if (plan.safety.suppressUnsafePreview) {\n        plan.candidateCounts = { ...plan.counts };\n        plan.candidateActions = plan.actions;\n        plan.actions = [];\n        plan.counts = countActions([], plan.skippedRows);\n        plan.previewSuppressed = true;\n"""
new_block = """      if (plan.safety.suppressUnsafePreview) {\n        suppressPlanForUnsafeContext(plan);\n"""
if old_block in text:
    text = text.replace(old_block, new_block, 1)
elif new_block not in text:
    raise SystemExit('preview suppression block marker not found')

old_export = 'safePlain, evaluatePlanSafety, resultingRoleCountForAction'
new_export = 'safePlain, suppressPlanForUnsafeContext, evaluatePlanSafety, resultingRoleCountForAction'
if old_export in text:
    text = text.replace(old_export, new_export, 1)
elif new_export not in text:
    raise SystemExit('test export marker not found')

path.write_text(text, encoding='utf-8')
print('patched global context suppression')
