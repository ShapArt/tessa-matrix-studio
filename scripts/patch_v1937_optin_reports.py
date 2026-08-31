from pathlib import Path

# Trigger after workflow creation.
p = Path('tessa-matrix-studio.user.js')
s = p.read_text(encoding='utf-8')

old = """    logs: [],\n    dictionaryCatalog: null,\n"""
new = """    logs: [],\n    lastReport: null,\n    dictionaryCatalog: null,\n"""
if old not in s: raise SystemExit('APP report state anchor missing')
s = s.replace(old, new, 1)

s = s.replace("downloadJson(result, `TESSA_Matrix_Apply_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);",
              "rememberReport(result, `TESSA_Matrix_Apply_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);")
if 'downloadJson(result, `TESSA_Matrix_Apply_' in s:
    raise SystemExit('automatic Apply report download remains')

old = """  function downloadJson(value, name) {\n    const blob = new Blob([JSON.stringify(value, jsonReplacer, 2)], { type: 'application/json;charset=utf-8' });\n    const url = URL.createObjectURL(blob);\n    const a = document.createElement('a');\n    a.href = url; a.download = name; a.click();\n    setTimeout(() => URL.revokeObjectURL(url), 1000);\n  }\n"""
new = """  function downloadJson(value, name) {\n    const blob = new Blob([JSON.stringify(value, jsonReplacer, 2)], { type: 'application/json;charset=utf-8' });\n    const url = URL.createObjectURL(blob);\n    const a = document.createElement('a');\n    a.href = url; a.download = name; a.click();\n    setTimeout(() => URL.revokeObjectURL(url), 1000);\n  }\n\n  // Диагностический JSON больше не скачивается сам. Для обычного успешного Apply\n  // файл пользователю не нужен; при разборе поддержки его можно получить явно.\n  function rememberReport(value, name) {\n    APP.lastReport = { value, name };\n    const button = document.querySelector?.('#tms-download-report');\n    if (button) {\n      button.hidden = false;\n      button.disabled = false;\n      button.title = name || 'Скачать последний диагностический отчёт';\n    }\n    return APP.lastReport;\n  }\n\n  function downloadLastReport() {\n    if (!APP.lastReport?.value) return false;\n    downloadJson(APP.lastReport.value, APP.lastReport.name || `TESSA_Matrix_Report_${Date.now()}.json`);\n    return true;\n  }\n"""
if old not in s: raise SystemExit('downloadJson block missing')
s = s.replace(old, new, 1)

old = """          <div class=\"tms-step tms-step-apply\"><div class=\"tms-step-label\">4 · Применение</div><button id=\"tms-apply\" class=\"tms-primary\" disabled>Применить к TESSA</button><div id=\"tms-apply-note\" class=\"tms-step-caption\"></div></div>\n"""
new = """          <div class=\"tms-step tms-step-apply\"><div class=\"tms-step-label\">4 · Применение</div><button id=\"tms-apply\" class=\"tms-primary\" disabled>Применить к TESSA</button><button id=\"tms-download-report\" class=\"tms-ghost\" hidden disabled>Скачать отчёт</button><div id=\"tms-apply-note\" class=\"tms-step-caption\"></div></div>\n"""
if old not in s: raise SystemExit('apply UI block missing')
s = s.replace(old, new, 1)

old = """    panel.querySelector('#tms-apply').addEventListener('click', async () => {\n"""
new = """    panel.querySelector('#tms-download-report').addEventListener('click', () => { downloadLastReport(); });\n    panel.querySelector('#tms-apply').addEventListener('click', async () => {\n"""
if old not in s: raise SystemExit('apply listener anchor missing')
s = s.replace(old, new, 1)

old = """        downloadJson({ app: { name: APP.name, version: APP.version }, planId: APP.plan?.id, failedAt: nowIso(), error: message, technicalError: error?.message || String(error), matrixId: APP.plan?.matrixId || null, logs: APP.logs.slice(-120) }, `TESSA_Matrix_ErrorReport_${Date.now()}.json`);\n        alert(`${message}\\\n\\\nЕсли понадобится разбор ошибки, приложите автоматически скачанный файл TESSA_Matrix_ErrorReport_*.json.`);\n"""
new = """        rememberReport({ app: { name: APP.name, version: APP.version }, planId: APP.plan?.id, failedAt: nowIso(), error: message, technicalError: error?.message || String(error), matrixId: APP.plan?.matrixId || null, logs: APP.logs.slice(-120) }, `TESSA_Matrix_ErrorReport_${Date.now()}.json`);\n        alert(`${message}\\\n\\\nЕсли понадобится разбор ошибки, нажмите «Скачать отчёт» в Studio.`);\n"""
if old not in s: raise SystemExit('error auto-download block missing')
s = s.replace(old, new, 1)

old = """    normalizeSpace, isOverwriteMatch, stripFormulaMarker, canonicalHeader, canonicalValue, definitionKey, splitCell, mapConcurrent, yieldToMain, estimateRemainingMs, formatEtaMs, workProgressDetail,\n"""
new = """    normalizeSpace, isOverwriteMatch, stripFormulaMarker, canonicalHeader, canonicalValue, definitionKey, splitCell, mapConcurrent, yieldToMain, estimateRemainingMs, formatEtaMs, workProgressDetail, rememberReport, downloadLastReport,\n"""
if old not in s: raise SystemExit('export anchor missing')
s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')
