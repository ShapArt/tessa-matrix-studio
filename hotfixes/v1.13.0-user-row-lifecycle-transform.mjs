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

// Live UAT 2026-09-11 produced a legitimate Studio-generated dictionary worksheet of
// 139,568,463 bytes. Keep the archive bounded, but do not reject our own workbook at
// the old 128 MiB single-entry ceiling. Total uncompressed size and ratio guards remain.
replaceExact(
`    MaxEntryUncompressedBytes: 128 * 1024 * 1024,`,
`    MaxEntryUncompressedBytes: 192 * 1024 * 1024, // LIVE_UAT_2026_09_11: valid dictionary sheet exceeded 128 MiB`,
  'XLSX self-generated dictionary ceiling',
);

// Full UAT obtains one explicit consent before its write phase. Let internal callers
// provide a scoped confirmer so temporary ADD/UPDATE/DELETE scenarios do not present a
// second browser confirm for every mutation. Normal UI calls still use window.confirm.
replaceExact(
`  async function applyPlan(plan) {
    if (!plan) throw new Error('Сначала проверьте Excel.');`,
`  async function applyPlan(plan, options = {}) {
    if (!plan) throw new Error('Сначала проверьте Excel.');
    const confirmApply = typeof options.confirm === 'function' ? options.confirm : message => window.confirm(message);`,
  'inject Apply confirmer',
);
replaceExact(
`      const okBatch = window.confirm(\`${'${batch.reason}'}

Продолжить?\`);`,
`      const okBatch = confirmApply(\`${'${batch.reason}'}

Продолжить?\`);`,
  'batch confirmation policy',
);
replaceExact(
`      const okLow = window.confirm('Есть строки с низкой уверенностью сопоставления. Продолжить после проверки предпросмотра?');`,
`      const okLow = confirmApply('Есть строки с низкой уверенностью сопоставления. Продолжить после проверки предпросмотра?');`,
  'low-confidence confirmation policy',
);
replaceExact(
`      const ok = window.confirm(\`Применить корректные изменения к TESSA?\\n\\nИзменить: ${'${c.update}'}\\nДобавить: ${'${c.add}'}\\nУдалить: ${'${c.delete}'}\\nПропустить: ${'${c.skip || 0}'}${'${plan.skippedFields?.length ? `\\nОставить без изменения отдельных полей: ${plan.skippedFields.length}` : \'\'}'}\\n\\nОшибочные строки и указанные в Preview поля не будут применены.\`);`,
`      const ok = confirmApply(\`Применить корректные изменения к TESSA?\\n\\nИзменить: ${'${c.update}'}\\nДобавить: ${'${c.add}'}\\nУдалить: ${'${c.delete}'}\\nПропустить: ${'${c.skip || 0}'}${'${plan.skippedFields?.length ? `\\nОставить без изменения отдельных полей: ${plan.skippedFields.length}` : \'\'}'}\\n\\nОшибочные строки и указанные в Preview поля не будут применены.\`);`,
  'standard confirmation policy',
);

// Snapshot rows intentionally cross a DTO boundary and no longer retain native Card
// instances. Diagnostics must hydrate the native row card on demand, just as the later
// server-validation checks already do, otherwise every per-field rebuild is NOT RUN.
replaceExact(
`    if (generated && columns) for (const column of columns.values()) {`,
`    const diagnosticNativeCardCache = new Map();
    const getDiagnosticNativeCard = async row => {
      const key = canonicalValue(row?.rowCardId);
      if (!key) throw new Error('У контрольной строки отсутствует CardID.');
      if (!diagnosticNativeCardCache.has(key)) diagnosticNativeCardCache.set(key, await bridge.getCard(row.rowCardId));
      return diagnosticNativeCardCache.get(key);
    };
    if (generated && columns) for (const column of columns.values()) {`,
  'diagnostic native-card cache',
);
replaceExact(
`      await run(\`field-${'${column.key}'}\`, \`Поле: ${'${column.name || column.excelHeader}'}\`, async () => {`,
`      await run(\`field-${'${column.key}'}\`, \`Поле «${'${column.name || column.excelHeader}'}»\`, async () => {`,
  'diagnostic field title clarity',
);
replaceExact(
`        if (!controlRow.card?.clone) return { status: 'not-run', detail: 'Карточка для проверки перестройки недоступна.' };`,
`        const nativeCard = await getDiagnosticNativeCard(controlRow);
        if (typeof nativeCard?.clone !== 'function') return { status: 'not-run', detail: 'Нативная карточка строки не поддерживает clone().' };`,
  'diagnostic field card hydration',
);
replaceExact(
`        const cloned = controlRow.card.clone();`,
`        const cloned = nativeCard.clone();`,
  'diagnostic field card clone',
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
for (const marker of ['tms-picker-import-block', 'TessaBridge, makeZip,', 'LIVE_UAT_2026_09_11', 'const confirmApply =', 'diagnosticNativeCardCache']) {
  if (!source.includes(marker)) throw new Error(`v1.13.0 transform verification failed: ${marker}`);
}

fs.writeFileSync(target, source, 'utf8');
console.log('TESSA Matrix Studio v1.13.0 row lifecycle + live UAT hardening transform: OK');
