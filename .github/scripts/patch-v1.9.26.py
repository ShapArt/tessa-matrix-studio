from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
s = path.read_text(encoding='utf-8')

old = """  function excelNumberFormatKind(numFmtId, formatCode = '') {\n    const id = Number(numFmtId);\n    if (id === 49) return 'text';\n    if (BUILTIN_EXCEL_DATE_FORMAT_IDS.has(id)) return 'date';\n    const code = String(formatCode || '').trim();\n    if (!code) return 'general';\n    if (code === '@') return 'text';\n    const semantic = code\n      .replace(/\"(?:[^\"]|\"\")*\"/g, '')\n      .replace(/\\\\./g, '')\n      .replace(/[_*]./g, '')\n      .replace(/\\[(?!h+\\]|m+\\]|s+\\])[^\\]]*\\]/gi, '')\n      .toLowerCase();\n    if (/am\\/pm|a\\/p|\\[h+\\]|\\[m+\\]|\\[s+\\]|y+|d+|h+|s+/.test(semantic)) return 'date';\n    if (/m+/.test(semantic) && /[\\/-]/.test(semantic)) return 'date';\n    return 'general';\n  }\n"""
new = """  function excelNumberFormatKind(numFmtId, formatCode = '') {\n    const id = Number(numFmtId);\n    if (id === 49) return 'text';\n    if (BUILTIN_EXCEL_DATE_FORMAT_IDS.has(id)) return 'date';\n    if (id === 9 || id === 10) return 'percent';\n    if (id === 11 || id === 48) return 'scientific';\n    if (id === 12 || id === 13) return 'fraction';\n    const code = String(formatCode || '').trim();\n    if (!code) return 'general';\n    if (code === '@') return 'text';\n    const semantic = code\n      .replace(/\"(?:[^\"]|\"\")*\"/g, '')\n      .replace(/\\\\./g, '')\n      .replace(/[_*]./g, '')\n      .replace(/\\[(?!h+\\]|m+\\]|s+\\])[^\\]]*\\]/gi, '')\n      .toLowerCase();\n    if (/am\\/pm|a\\/p|\\[h+\\]|\\[m+\\]|\\[s+\\]|y+|d+|h+|s+/.test(semantic)) return 'date';\n    if (/m+/.test(semantic) && /[\\/-]/.test(semantic)) return 'date';\n    if (/%/.test(semantic)) return 'percent';\n    if (/[0#?]+\\s*e[+-]?[0#?]+/i.test(semantic)) return 'scientific';\n    if (/[#0?]+\\s+[#0?]+\\/[#0?]+/.test(semantic)) return 'fraction';\n    return 'general';\n  }\n"""
if old not in s:
    raise SystemExit('excelNumberFormatKind anchor not found')
s = s.replace(old, new, 1)

old = """        metaValues[coordinate.col] = {\n          styleIndex: Number.isInteger(styleIndex) && styleIndex >= 0 ? styleIndex : 0,\n          numFmtId: style?.numFmtId ?? 0,\n          formatCode: style?.formatCode || '',\n          numberFormatKind: style?.numberFormatKind || 'general',\n          rawType: type || 'n',\n        };\n        let value = '';\n"""
new = """        const formulaMatch = cellBody.match(/<(?:[A-Za-z_][\\w.-]*:)?f\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?f>/i);\n        metaValues[coordinate.col] = {\n          styleIndex: Number.isInteger(styleIndex) && styleIndex >= 0 ? styleIndex : 0,\n          numFmtId: style?.numFmtId ?? 0,\n          formatCode: style?.formatCode || '',\n          numberFormatKind: style?.numberFormatKind || 'general',\n          rawType: type || 'n',\n          hasFormula: Boolean(formulaMatch),\n          formula: formulaMatch ? xmlDecode(formulaMatch[1]) : '',\n        };\n        let value = '';\n"""
if old not in s:
    raise SystemExit('cell metadata anchor not found')
s = s.replace(old, new, 1)

anchor = """  function typedScalarSemantic(kind, value) {\n"""
insert = """  function excelCoercionIssue(kind, value, meta, label = 'значение') {\n    if (!meta) return null;\n    if (meta.hasFormula) {\n      return `В столбце «${label}» обнаружена Excel-формула. Формулы в редактируемых ячейках матрицы не применяются: замените формулу обычным значением.`;\n    }\n    if (kind === 'Date' || kind === 'DateTime') return null;\n    const rawType = canonicalValue(meta.rawType || 'n');\n    if (rawType && rawType !== 'n') return null;\n    const raw = stripFormulaMarker(value);\n    if (!raw) return null;\n\n    // Свежие Roundtrip-файлы экспортируют редактируемые значения как Text. Если\n    // строковый критерий вернулся из Excel числовым cell type, исходная запись могла\n    // потерять ведущие нули, перейти в scientific notation, процент или дробь.\n    if (kind === 'String') {\n      return `В столбце «${label}» Excel сохранил текстовый критерий как число «${raw}». Исходное текстовое представление могло измениться (ведущие нули, экспонента, проценты или дробь). Верните ячейку в текстовый формат и введите значение повторно.`;\n    }\n\n    const formatKind = canonicalValue(meta.numberFormatKind || 'general');\n    if (['scientific', 'percent', 'fraction'].includes(formatKind) && !['Int', 'Decimal'].includes(kind)) {\n      return `В столбце «${label}» Excel применил числовой формат «${formatKind}» к значению «${raw}». Для этого типа критерия преобразование неоднозначно; верните ячейку в текстовый формат и повторите ввод.`;\n    }\n    return null;\n  }\n\n"""
if anchor not in s:
    raise SystemExit('typedScalarSemantic anchor not found')
s = s.replace(anchor, insert + anchor, 1)

old = """        const autoDateIssue = column.kind === 'criterion'\n          ? excelAutoDateIssue(cellOperandKind, row.values[column.index], row.cellMeta?.[column.index], column.excelHeader)\n          : null;\n        if (autoDateIssue) issues.push(`Excel ${row.excelRow}: ${autoDateIssue}`);\n"""
new = """        const cellMeta = row.cellMeta?.[column.index];\n        const autoDateIssue = column.kind === 'criterion'\n          ? excelAutoDateIssue(cellOperandKind, row.values[column.index], cellMeta, column.excelHeader)\n          : null;\n        if (autoDateIssue) issues.push(`Excel ${row.excelRow}: ${autoDateIssue}`);\n        const coercionIssue = column.kind === 'criterion'\n          ? excelCoercionIssue(cellOperandKind, row.values[column.index], cellMeta, column.excelHeader)\n          : null;\n        if (coercionIssue) issues.push(`Excel ${row.excelRow}: ${coercionIssue}`);\n"""
if old not in s:
    raise SystemExit('workbookRowsToDesired guard anchor not found')
s = s.replace(old, new, 1)

path.write_text(s, encoding='utf-8')
