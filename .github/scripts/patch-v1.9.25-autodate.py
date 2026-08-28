from pathlib import Path

p = Path('tessa-matrix-studio.user.js')
s = p.read_text(encoding='utf-8')

old = """    return null;
  }

  function typedScalarSemantic(kind, value) {
"""
new = """    return null;
  }

  // Excel may silently reinterpret text-like input such as `3 - 18` as a date and
  // persist only the numeric serial. For non-date TESSA criteria that conversion is
  // ambiguous and must never be applied as a legitimate number/string/reference.
  function excelAutoDateIssue(kind, value, meta, label = 'значение') {
    if (!meta || meta.numberFormatKind !== 'date') return null;
    if (kind === 'Date' || kind === 'DateTime') return null;
    const rawType = canonicalValue(meta.rawType || 'n');
    if (rawType && rawType !== 'n') return null;
    const raw = stripFormulaMarker(value);
    const compact = raw.replace(/[\\s\\u00a0]/g, '').replace(',', '.');
    if (!/^-?\\d+(?:\\.\\d+)?$/.test(compact)) return null;
    const date = excelSerialToDate(compact);
    if (!date) return null;
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = date.getUTCFullYear();
    const hasTime = Math.abs(Number(compact) % 1) > 1e-10;
    const time = hasTime
      ? ` ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
      : '';
    return `В столбце «${label}» Excel автоматически преобразовал значение в дату «${dd}.${mm}.${yyyy}${time}» и сохранил серийный номер «${raw}». Верните ячейку в текстовый формат и введите исходное значение повторно.`;
  }

  function typedScalarSemantic(kind, value) {
"""
assert s.count(old) == 1, f'typed helper anchor mismatch: {s.count(old)}'
s = s.replace(old, new)

old = """      for (const [id, column] of columnMap.columns.entries()) {
        const visibleValues = splitCell(row.values[column.index]);
        const explicitValues = column.idIndex === null ? [] : splitCell(row.values[column.idIndex]);
"""
new = """      for (const [id, column] of columnMap.columns.entries()) {
        const cellOperandKind = operandKind(column);
        const autoDateIssue = column.kind === 'criterion'
          ? excelAutoDateIssue(cellOperandKind, row.values[column.index], row.cellMeta?.[column.index], column.excelHeader)
          : null;
        if (autoDateIssue) issues.push(`Excel ${row.excelRow}: ${autoDateIssue}`);
        const visibleValues = splitCell(row.values[column.index]);
        const explicitValues = column.idIndex === null ? [] : splitCell(row.values[column.idIndex]);
"""
assert s.count(old) == 1, f'workbook loop anchor mismatch: {s.count(old)}'
s = s.replace(old, new)

old = """          } else {
            const kind = operandKind(column);
            if (['Boolean','Int','Decimal','Date','DateTime'].includes(kind)) {
"""
new = """          } else {
            const kind = cellOperandKind;
            if (['Boolean','Int','Decimal','Date','DateTime'].includes(kind)) {
"""
assert s.count(old) == 1, f'operand kind reuse anchor mismatch: {s.count(old)}'
s = s.replace(old, new)

p.write_text(s, encoding='utf-8')
