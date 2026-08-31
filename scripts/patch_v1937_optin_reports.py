from pathlib import Path

p = Path('tessa-matrix-studio.user.js')
s = p.read_text(encoding='utf-8')

def once(old, new, label):
    global s
    if old not in s:
        raise SystemExit(f'{label} missing')
    s = s.replace(old, new, 1)

once("    logs: [],\n    dictionaryCatalog: null,\n",
     "    logs: [],\n    lastReport: null,\n    dictionaryCatalog: null,\n", 'APP report state')

apply_download = "downloadJson(result, `TESSA_Matrix_Apply_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);"
count = s.count(apply_download)
if count < 1:
    raise SystemExit('Apply auto-download call missing')
s = s.replace(apply_download,
              "rememberReport(result, `TESSA_Matrix_Apply_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);")
if apply_download in s:
    raise SystemExit('automatic Apply report download remains')

old_download = """  function downloadJson(value, name) {\n    const blob = new Blob([JSON.stringify(value, jsonReplacer, 2)], { type: 'application/json;charset=utf-8' });\n    const url = URL.createObjectURL(blob);\n    const a = document.createElement('a');\n    a.href = url; a.download = name; a.click();\n    setTimeout(() => URL.revokeObjectURL(url), 1000);\n  }\n"""
new_download = old_download + """\n  // Отчёты храним в памяти вкладки. Файл создаётся только по явному клику пользователя.\n  function rememberReport(value, name) {\n    APP.lastReport = { value, name };\n    const button = document.querySelector?.('#tms-download-report');\n    if (button) {\n      button.hidden = false;\n      button.disabled = false;\n      button.title = name || 'Скачать последний диагностический отчёт';\n    }\n    return APP.lastReport;\n  }\n\n  function downloadLastReport() {\n    if (!APP.lastReport?.value) return false;\n    downloadJson(APP.lastReport.value, APP.lastReport.name || `TESSA_Matrix_Report_${Date.now()}.json`);\n    return true;\n  }\n"""
once(old_download, new_download, 'download helper')

once('<button id="tms-apply" class="tms-primary" disabled>Применить к TESSA</button><div id="tms-apply-note" class="tms-step-caption"></div>',
     '<button id="tms-apply" class="tms-primary" disabled>Применить к TESSA</button><button id="tms-download-report" class="tms-ghost" hidden disabled>Скачать отчёт</button><div id="tms-apply-note" class="tms-step-caption"></div>', 'manual report button')

once("    panel.querySelector('#tms-apply').addEventListener('click', async () => {\n",
     "    panel.querySelector('#tms-download-report').addEventListener('click', () => { downloadLastReport(); });\n    panel.querySelector('#tms-apply').addEventListener('click', async () => {\n", 'manual report listener')

error_download = "downloadJson({ app: { name: APP.name, version: APP.version }, planId: APP.plan?.id, failedAt: nowIso(), error: message, technicalError: error?.message || String(error), matrixId: APP.plan?.matrixId || null, logs: APP.logs.slice(-120) }, `TESSA_Matrix_ErrorReport_${Date.now()}.json`);"
once(error_download,
     "rememberReport({ app: { name: APP.name, version: APP.version }, planId: APP.plan?.id, failedAt: nowIso(), error: message, technicalError: error?.message || String(error), matrixId: APP.plan?.matrixId || null, logs: APP.logs.slice(-120) }, `TESSA_Matrix_ErrorReport_${Date.now()}.json`);", 'error report auto-download')

once('Если понадобится разбор ошибки, приложите автоматически скачанный файл TESSA_Matrix_ErrorReport_*.json.',
     'Если понадобится разбор ошибки, нажмите «Скачать отчёт» в Studio.', 'error report hint')

once("    normalizeSpace, isOverwriteMatch, stripFormulaMarker, canonicalHeader, canonicalValue, definitionKey, splitCell, mapConcurrent, yieldToMain, estimateRemainingMs, formatEtaMs, workProgressDetail,\n",
     "    normalizeSpace, isOverwriteMatch, stripFormulaMarker, canonicalHeader, canonicalValue, definitionKey, splitCell, mapConcurrent, yieldToMain, estimateRemainingMs, formatEtaMs, workProgressDetail, rememberReport, downloadLastReport,\n", 'test exports')

p.write_text(s, encoding='utf-8')
