import fs from 'node:fs';

const target = process.argv[2] || 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(target, 'utf8');

function replaceExact(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  source = source.replace(before, after);
}

replaceExact(
`        const currentFingerprint = canonicalValue(current.fingerprint || fingerprintFlat(current.flat || {}));
        const exact = group.filter(row => canonicalValue(fingerprintFlat(row.flat || {})) === currentFingerprint);
        if (exact.length) primaryExcelRowByIdentity.set(sourceIdentity, exact[0]);
        else ambiguousDuplicateIdentities.add(sourceIdentity);`,
`        const currentFingerprint = canonicalValue(current.fingerprint || fingerprintFlat(current.flat || {}));
        const exact = group.filter(row => canonicalValue(fingerprintFlat(row.flat || {})) === currentFingerprint);
        if (exact.length) primaryExcelRowByIdentity.set(sourceIdentity, exact[0]);
        else {
          // DUPLICATE_IDENTITY_COPY_AS_ADD_V1
          // Excel copies hidden source IDs together with visible cells. If every copy was
          // edited, there is no semantic reason to discard the whole group: exactly one
          // row still owns the existing TESSA identity, the rest are new rows. Pick the
          // least changed row deterministically; ties use Excel row only as a tie-breaker.
          const ranked = group.map(row => ({ row, changes: semanticChangeCount(row, current) }))
            .sort((a, b) => a.changes - b.changes || Number(a.row.excelRow || Number.MAX_SAFE_INTEGER) - Number(b.row.excelRow || Number.MAX_SAFE_INTEGER));
          const primary = ranked[0]?.row || null;
          if (primary) primaryExcelRowByIdentity.set(sourceIdentity, primary);
          else ambiguousDuplicateIdentities.add(sourceIdentity);
        }`,
  'merge copied identity policy',
);

replaceExact(
`      const scored = group.map(row => ({ row, changes: semanticChangeCount(row, currentRow) }));
      const exact = scored.filter(item => item.changes === 0);
      if (exact.length) primaryExcelRowByIdentity.set(sourceIdentity, exact[0].row);
      else ambiguousDuplicateIdentities.add(sourceIdentity);`,
`      const scored = group.map(row => ({ row, changes: semanticChangeCount(row, currentRow) }));
      const exact = scored.filter(item => item.changes === 0);
      if (exact.length) primaryExcelRowByIdentity.set(sourceIdentity, exact[0].row);
      else {
        // DUPLICATE_IDENTITY_COPY_AS_ADD_V1
        // One edited copy keeps the current identity; the remaining edited copies are
        // legitimate ADD candidates. True duplicate final rows are still rejected by the
        // ordinary local/server duplicate validation path.
        const primary = [...scored]
          .sort((a, b) => a.changes - b.changes || Number(a.row.excelRow || Number.MAX_SAFE_INTEGER) - Number(b.row.excelRow || Number.MAX_SAFE_INTEGER))[0]?.row || null;
        if (primary) primaryExcelRowByIdentity.set(sourceIdentity, primary);
        else ambiguousDuplicateIdentities.add(sourceIdentity);
      }`,
  'planner copied identity policy',
);

replaceExact(
`      <details><summary>Продолжить набор из ячейки Excel</summary><textarea id="tms-picker-paste" rows="2" aria-label="Значения из Excel"></textarea><button id="tms-picker-import" type="button">Добавить в набор</button></details>`,
`      <details class="tms-picker-import-block"><summary>Добавить значения из Excel</summary><p class="tms-picker-import-hint">Вставьте значения по одному на строку или через точку с запятой. Уже выбранные значения сохранятся.</p><textarea id="tms-picker-paste" rows="4" aria-label="Значения из Excel" placeholder="Например:\nИванов И.И.\nПетров П.П."></textarea><div class="tms-row tms-picker-import-actions"><button id="tms-picker-import" type="button">Добавить значения</button></div></details>`,
  'picker paste UX',
);

// Full UAT packages use the same audited ZIP writer as XLSX/diagnostics instead of
// introducing another archive implementation in the runtime hotfix.
replaceExact(
`    TessaBridge,
    constants: { OPERAND, REQUEST, S, F, ROUNDTRIP, DICTIONARY_CACHE, PERFORMANCE },`,
`    TessaBridge, makeZip,
    constants: { OPERAND, REQUEST, S, F, ROUNDTRIP, DICTIONARY_CACHE, PERFORMANCE },`,
  'export makeZip for Full UAT',
);

if ((source.match(/DUPLICATE_IDENTITY_COPY_AS_ADD_V1/g) || []).length !== 2) {
  throw new Error('Copied identity patch marker count mismatch.');
}
if (!source.includes('tms-picker-import-block') || !source.includes('TessaBridge, makeZip,')) {
  throw new Error('UX/UAT export patch verification failed.');
}

fs.writeFileSync(target, source, 'utf8');
console.log('TESSA Matrix Studio v1.13.0 row lifecycle + picker UX transform: OK');
