from pathlib import Path

p = Path('tessa-matrix-studio.user.js')
s = p.read_text(encoding='utf-8')

def replace_once(old, new, label):
    global s
    if old not in s:
        raise RuntimeError(f'missing anchor: {label}')
    s = s.replace(old, new, 1)

# Planner: baseline map next to snapshot maps.
replace_once(
"""    const byVersion = new Map(snapshot.rows.map(row => [canonicalValue(row.versionId), row]));
    const byCard = new Map(snapshot.rows.map(row => [canonicalValue(row.rowCardId), row]));
    const byKey = new Map([...columnMap.columns.values()].map(column => [column.key, column]));
""",
"""    const byVersion = new Map(snapshot.rows.map(row => [canonicalValue(row.versionId), row]));
    const byCard = new Map(snapshot.rows.map(row => [canonicalValue(row.rowCardId), row]));
    const baselineRows = Array.isArray(workbook.roundtrip?.baselineRows) ? workbook.roundtrip.baselineRows : [];
    const baselineByIdentity = new Map(baselineRows.map(row => {
      const versionId = canonicalValue(row.versionId || '');
      const rowCardId = canonicalValue(row.rowCardId || '');
      return [`v:${versionId}|c:${rowCardId}`, row];
    }));
    const byKey = new Map([...columnMap.columns.values()].map(column => [column.key, column]));
""",
'planner baseline map')

anchor = """    for (const excelRow of desired) {
      const action = excelRow.system.action;
"""
insert = """    const baselineIntegrityRows = new Set();
    if (canonicalValue(workbook.roundtrip?.format) === canonicalValue('TESSA_MATRIX_ROUNDTRIP_V6') && baselineRows.length) {
      // Скрытый fingerprint основной строки не является источником истины: V6 хранит
      // отдельный baseline-ledger. Любая потеря/подмена fingerprint блокирует строку.
      for (const excelRow of desired) {
        const identity = excelIdentityKey(excelRow);
        if (!identity) continue;
        const base = baselineByIdentity.get(identity);
        if (!base) continue;
        if (canonicalValue(excelRow.system.baseFingerprint || '') !== canonicalValue(base.baseFingerprint || '')) {
          baselineIntegrityRows.add(excelRow);
          identityMappingAnomaly = true;
          const current = findCurrent(excelRow);
          if (current) usedCurrent.add(canonicalValue(current.versionId || current.rowCardId));
          issues.push(`Строка Excel ${excelRow.excelRow}: повреждён служебный BaseFingerprint. Скрытые ID/fingerprint нельзя очищать или менять; скачайте свежую выгрузку.`);
        }
      }

      // Если baseline identity пропала, но число строк не уменьшилось настолько же,
      // это не доказанное физическое удаление. Чаще всего так выглядит потеря hidden ID
      // или смешение DELETE+ADD в одном файле. Нельзя превращать это в ADD + implicit DELETE.
      const desiredIdentities = new Set(desired.map(excelIdentityKey).filter(Boolean));
      const overwriteTargetIdentities = new Set([...positionalOverwriteTargets.values()].map(currentIdentityKey).filter(Boolean));
      const missingBaseline = baselineRows.filter(base => {
        const identity = `v:${canonicalValue(base.versionId || '')}|c:${canonicalValue(base.rowCardId || '')}`;
        return identity !== 'v:|c:' && !desiredIdentities.has(identity) && !overwriteTargetIdentities.has(identity);
      });
      const rowDeficit = Math.max(0, baselineRows.length - desired.length);
      if (missingBaseline.length > rowDeficit) {
        const noIdentityRows = desired.filter(row => row.hasData && !excelIdentityKey(row));
        for (const excelRow of noIdentityRows) {
          baselineIntegrityRows.add(excelRow);
          issues.push(`Строка Excel ${excelRow.excelRow}: потеряны скрытые MatrixRowID/MatrixVersionID. Строка не будет считаться новой, а автоматическое удаление отключено. Скачайте свежую выгрузку или выполните DELETE и ADD отдельно.`);
        }
        identityMappingAnomaly = true;
      }
    }

    for (const excelRow of desired) {
      const action = excelRow.system.action;
      if (baselineIntegrityRows.has(excelRow)) continue;
"""
replace_once(anchor, insert, 'planner integrity preflight')

# Schema refresh: baseline map after identity helpers.
replace_once(
"""    const currentIdentityKey = current => {
      const versionId = canonicalValue(current?.versionId || '');
      const rowCardId = canonicalValue(current?.rowCardId || '');
      return versionId || rowCardId ? `v:${versionId}|c:${rowCardId}` : '';
    };
    // Schema refresh должен сопоставлять overwrite по тем же identity-правилам,
""",
"""    const currentIdentityKey = current => {
      const versionId = canonicalValue(current?.versionId || '');
      const rowCardId = canonicalValue(current?.rowCardId || '');
      return versionId || rowCardId ? `v:${versionId}|c:${rowCardId}` : '';
    };
    const baselineByIdentity = new Map(baselineRows.map(row => {
      const versionId = canonicalValue(row.versionId || '');
      const rowCardId = canonicalValue(row.rowCardId || '');
      return [`v:${versionId}|c:${rowCardId}`, row];
    }));
    // Schema refresh должен сопоставлять overwrite по тем же identity-правилам,
""",
'merge baseline map')

# Validate present-row hidden fingerprint before physical-delete inference.
needle = """    // V6 хранит baseline identity/fingerprint на отдельном veryHidden-листе.
"""
replacement = """    if (canonicalValue(workbook.roundtrip?.format) === canonicalValue('TESSA_MATRIX_ROUNDTRIP_V6') && baselineRows.length) {
      for (const desired of desiredRows) {
        const identity = excelIdentityKey(desired);
        if (!identity) continue;
        const base = baselineByIdentity.get(identity);
        if (!base) continue;
        if (canonicalValue(desired.system.baseFingerprint || '') !== canonicalValue(base.baseFingerprint || '')) {
          throw new Error(`Строка Excel ${desired.excelRow}: повреждён служебный BaseFingerprint. Скрытые ID/fingerprint нельзя очищать или менять. Скачайте свежую выгрузку.`);
        }
      }
    }

    // V6 хранит baseline identity/fingerprint на отдельном veryHidden-листе.
"""
replace_once(needle, replacement, 'merge fingerprint integrity')

p.write_text(s, encoding='utf-8')
