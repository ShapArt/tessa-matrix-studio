from pathlib import Path

p = Path('tessa-matrix-studio.user.js')
s = p.read_text(encoding='utf-8')

def replace_once(old, new, label):
    global s
    if old not in s:
        raise RuntimeError(f'missing anchor: {label}')
    s = s.replace(old, new, 1)

replace_once(
"""    Format: 'TESSA_MATRIX_ROUNDTRIP_V5',
    AcceptedFormats: ['TESSA_MATRIX_ROUNDTRIP_V1', 'TESSA_MATRIX_ROUNDTRIP_V2', 'TESSA_MATRIX_ROUNDTRIP_V3', 'TESSA_MATRIX_ROUNDTRIP_V4', 'TESSA_MATRIX_ROUNDTRIP_V5'],
    DictionarySheet: 'Словари',
    StructureSheet: 'Структура',
    SchemaChangesSheet: 'Изменения структуры',
""",
"""    Format: 'TESSA_MATRIX_ROUNDTRIP_V6',
    AcceptedFormats: ['TESSA_MATRIX_ROUNDTRIP_V1', 'TESSA_MATRIX_ROUNDTRIP_V2', 'TESSA_MATRIX_ROUNDTRIP_V3', 'TESSA_MATRIX_ROUNDTRIP_V4', 'TESSA_MATRIX_ROUNDTRIP_V5', 'TESSA_MATRIX_ROUNDTRIP_V6'],
    DictionarySheet: 'Словари',
    StructureSheet: 'Структура',
    SchemaChangesSheet: 'Изменения структуры',
    BaselineSheet: '__TESSA_BASELINE',
""",
'roundtrip v6 constants')

replace_once(
"""  function parseEmbeddedDictionaryCatalog(parsedSheets) {
""",
"""  function parseBaselineRows(parsedSheets) {
    const baselineSheet = parsedSheets.get(ROUNDTRIP.BaselineSheet);
    if (!baselineSheet) return [];
    const rows = rowsToObjects(baselineSheet).map(row => ({
      rowCardId: normalizeSpace(row['MatrixRowID']),
      versionId: normalizeSpace(row['MatrixVersionID']),
      baseFingerprint: normalizeSpace(row['BaseFingerprint']),
    })).filter(row => row.rowCardId || row.versionId);
    const seen = new Set();
    for (const row of rows) {
      const key = `v:${canonicalValue(row.versionId)}|c:${canonicalValue(row.rowCardId)}`;
      if (seen.has(key)) throw new Error('Повреждён baseline-ledger Excel: обнаружена повторяющаяся исходная identity. Скачайте свежую выгрузку.');
      if (!row.baseFingerprint) throw new Error('Повреждён baseline-ledger Excel: отсутствует fingerprint исходной строки. Скачайте свежую выгрузку.');
      seen.add(key);
    }
    return rows;
  }

  function parseEmbeddedDictionaryCatalog(parsedSheets) {
""",
'baseline parser')

replace_once(
"""        previousVersionId: metadata[ROUNDTRIP.PreviousVersionIdKey] || null,
        templateMode: metadata[ROUNDTRIP.TemplateModeKey] || null,
      },
""",
"""        previousVersionId: metadata[ROUNDTRIP.PreviousVersionIdKey] || null,
        templateMode: metadata[ROUNDTRIP.TemplateModeKey] || null,
        baselineRows: parseBaselineRows(parsedSheets),
      },
""",
'roundtrip baseline property')

replace_once(
"""    const instructionSheet = instructionSheetXml();
    const dictionarySheet = genericSheetXml(dictionaryRows, [28, 42, 56, 48, 40, 14, 28, 72]);
    const structureSheet = genericSheetXml(structureRows, [46, 14, 38, 42, 38, 28, 24, 70]);
    const schemaChangesSheet = genericSheetXml(changeRows, [32, 16, 40, 44, 72, 12, 40, 72]);

    const styles = `""",
"""    const baselineRows = [['MatrixRowID', 'MatrixVersionID', 'BaseFingerprint']];
    for (const row of snapshot.rows || []) {
      baselineRows.push([row.rowCardId || '', row.versionId || '', row.fingerprint || fingerprintFlat(row.flat || {})]);
    }

    const instructionSheet = instructionSheetXml();
    const dictionarySheet = genericSheetXml(dictionaryRows, [28, 42, 56, 48, 40, 14, 28, 72]);
    const structureSheet = genericSheetXml(structureRows, [46, 14, 38, 42, 38, 28, 24, 70]);
    const schemaChangesSheet = genericSheetXml(changeRows, [32, 16, 40, 44, 72, 12, 40, 72]);
    const baselineSheet = genericSheetXml(baselineRows, [40, 40, 48], { autoFilter: false });

    const styles = `""",
'baseline sheet build')

replace_once(
"""    const sheetNames = ['Матрица', ROUNDTRIP.InstructionSheet, ROUNDTRIP.DictionarySheet, ROUNDTRIP.StructureSheet, ROUNDTRIP.SchemaChangesSheet];
    const sheetXml = [worksheet, instructionSheet, dictionarySheet, structureSheet, schemaChangesSheet];
""",
"""    const sheetNames = ['Матрица', ROUNDTRIP.InstructionSheet, ROUNDTRIP.DictionarySheet, ROUNDTRIP.StructureSheet, ROUNDTRIP.SchemaChangesSheet, ROUNDTRIP.BaselineSheet];
    const sheetXml = [worksheet, instructionSheet, dictionarySheet, structureSheet, schemaChangesSheet, baselineSheet];
""",
'baseline sheet registry')

replace_once(
"""    const workbookRowByExcelRow = new Map((workbook.rows || []).map(row => [row.excelRow, row]));
    const byVersion = new Map(snapshot.rows.map(row => [canonicalValue(row.versionId), row]));
""",
"""    const workbookRowByExcelRow = new Map((workbook.rows || []).map(row => [row.excelRow, row]));
    const baselineRows = Array.isArray(workbook.roundtrip?.baselineRows) ? workbook.roundtrip.baselineRows : [];
    const byVersion = new Map(snapshot.rows.map(row => [canonicalValue(row.versionId), row]));
""",
'merge baseline source')

replace_once(
"""    }

    for (const desired of desiredRows) {
      if (desired.system.action.startsWith('invalid:')) throw new Error(`Строка Excel ${desired.excelRow}: неизвестное действие.`);
""",
"""    }

    // V6 хранит baseline identity/fingerprint на отдельном veryHidden-листе.
    // Поэтому физическое удаление строки на основном листе не уничтожает доказательство,
    // какую именно версию пользователь собирался удалить. Это позволяет schema refresh
    // сохранить DELETE только если строка в TESSA с момента выгрузки не менялась.
    const physicalDeleteIdentities = new Set();
    if (canonicalValue(workbook.roundtrip?.format) === canonicalValue('TESSA_MATRIX_ROUNDTRIP_V6') && baselineRows.length) {
      const desiredIdentities = new Set(desiredRows.map(excelIdentityKey).filter(Boolean));
      const overwriteTargetIdentities = new Set([...positionalOverwriteTargets.values()].map(currentIdentityKey).filter(Boolean));
      const missingBaseline = baselineRows.filter(base => {
        const identity = `v:${canonicalValue(base.versionId || '')}|c:${canonicalValue(base.rowCardId || '')}`;
        return identity !== 'v:|c:' && !desiredIdentities.has(identity) && !overwriteTargetIdentities.has(identity);
      });
      const rowDeficit = Math.max(0, baselineRows.length - desiredRows.length);
      if (missingBaseline.length && missingBaseline.length !== rowDeficit) {
        throw new Error('Конфликт актуализации: baseline показывает пропавшую исходную identity, но число строк Excel не соответствует чистому физическому удалению. Возможно, повреждены скрытые ID или одновременно выполнены удаление и добавление. Выполните эти операции отдельно в свежей выгрузке.');
      }
      for (const base of missingBaseline) {
        const identity = `v:${canonicalValue(base.versionId || '')}|c:${canonicalValue(base.rowCardId || '')}`;
        const current = base.versionId ? byVersion.get(canonicalValue(base.versionId)) : byCard.get(canonicalValue(base.rowCardId));
        if (current) {
          const freshFingerprint = canonicalValue(current.fingerprint || fingerprintFlat(current.flat || {}));
          const exportedFingerprint = canonicalValue(base.baseFingerprint || '');
          if (!exportedFingerprint || freshFingerprint !== exportedFingerprint) {
            throw new Error(`Конфликт актуализации: физически удалённая строка TESSA ${base.versionId || base.rowCardId} изменилась после выгрузки Excel. Скачайте свежий файл и подтвердите удаление повторно.`);
          }
        }
        physicalDeleteIdentities.add(identity);
      }
    }

    for (const desired of desiredRows) {
      if (desired.system.action.startsWith('invalid:')) throw new Error(`Строка Excel ${desired.excelRow}: неизвестное действие.`);
""",
'physical delete detection')

replace_once(
"""    const rows = snapshot.rows.map(row => mergedByCard.get(canonicalValue(row.rowCardId)) || { ...row, customValues: Array(customColumns.length).fill('') }).concat(added);
""",
"""    const rows = snapshot.rows
      .filter(row => !physicalDeleteIdentities.has(currentIdentityKey(row)))
      .map(row => mergedByCard.get(canonicalValue(row.rowCardId)) || { ...row, customValues: Array(customColumns.length).fill('') })
      .concat(added);
""",
'physical delete final filter')

p.write_text(s, encoding='utf-8')
