import fs from 'node:fs';

const target = process.argv[2] || 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(target, 'utf8');

function replaceExact(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  source = source.replace(before, after);
}

// The copied-ID merge path lives in a different function scope from buildPlan(). The
// initial lifecycle patch intentionally reuses the same policy, but the scorer itself
// must also exist locally. Without this block schema refresh throws ReferenceError for
// an all-edited copied-identity group.
replaceExact(
`    const findCurrentByIdentity = desired => {
      if (desired?.system?.versionId) {
        const row = byVersion.get(canonicalValue(desired.system.versionId));
        if (row) return row;
      }
      if (desired?.system?.rowCardId) {
        const row = byCard.get(canonicalValue(desired.system.rowCardId));
        if (row) return row;
      }
      return null;
    };
    for (const desired of desiredRows) {`,
`    const findCurrentByIdentity = desired => {
      if (desired?.system?.versionId) {
        const row = byVersion.get(canonicalValue(desired.system.versionId));
        if (row) return row;
      }
      if (desired?.system?.rowCardId) {
        const row = byCard.get(canonicalValue(desired.system.rowCardId));
        if (row) return row;
      }
      return null;
    };
    // MERGE_COPY_IDENTITY_SCORING_V1
    const mergeByKey = new Map([...columnMap.columns.values()].map(column => [column.key, column]));
    const mergeKeys = [...mergeByKey.keys()];
    const semanticChangeCount = (excelRow, currentRow) => {
      let count = 0;
      for (const key of mergeKeys) {
        const column = mergeByKey.get(key);
        if (!arraysEqual(currentCompareValues(currentRow, column), excelRow.compare?.[key] || [])) count += 1;
      }
      return count;
    };
    for (const desired of desiredRows) {`,
  'merge copied-identity scorer scope',
);

// The Full UAT button already asks for explicit consent once before any write. The live
// 2026-09-11 run proved that routing each temporary operation through the normal Apply
// dialog makes automation nondeterministic: two scenarios returned null while cleanup
// remained safe. Scope confirmation bypass to this runner only; ordinary Apply keeps UI.
replaceExact(
`      const result = await E.applyPlan(plan);`,
`      const result = await E.applyPlan(plan, { confirm: () => true, source: 'full-uat' });`,
  'pre-approved Full UAT Apply',
);

// A truthy Apply result is not sufficient: partial/cancelled results are intentionally
// returned by the production writer. UAT must count a write only when exactly one
// mutation completed with no skipped or unstarted work. Read-back still verifies the
// domain result immediately afterwards.
replaceExact(
`      const result = await E.applyPlan(plan, { confirm: () => true, source: 'full-uat' });
      if (!result) throw new Error(\`${'${label}'}: применение отменено.\`);
      report.writesCompleted += 1;
      return result;`,
`      const result = await E.applyPlan(plan, { confirm: () => true, source: 'full-uat' });
      if (!result) throw new Error(\`${'${label}'}: применение отменено.\`);
      // FULL_UAT_STRICT_APPLY_RESULT_V1
      if (result.success !== true || result.status !== 'completed'
        || Number(result.appliedCount || 0) !== 1
        || Number(result.failedCount || 0) !== 0
        || Number(result.notStartedCount || 0) !== 0
        || Number(result.preflightSkippedCount || 0) !== 0
        || Number(result.storeSkippedCount || 0) !== 0) {
        throw new Error(\`${'${label}'}: запись завершилась не полностью (status=${'${result.status}'}, applied=${'${result.appliedCount}'}, skipped=${'${result.skippedCount}'}, notStarted=${'${result.notStartedCount}'}).\`);
      }
      report.writesCompleted += 1;
      return result;`,
  'strict Full UAT Apply result',
);

// Use the exact RowCardID returned by the successful ADD receipt. This is stronger than
// diffing row counts when another user writes concurrently, and it gives us a safe cleanup
// target even if the immediate read-back fails.
replaceExact(
`      const result = await applySingle(plan, \`${'${scenarioId}'}: ADD\`); const after = await freshSnapshot();
      const created = after.snapshot.rows.filter(row => !beforeIds.has(canon(row.rowCardId)));
      if (created.length !== 1) throw new Error(\`После ADD ожидалась 1 новая строка, найдено ${'${created.length}'}.\`);
      return { created: created[0], after: after.snapshot, bridge: after.bridge, catalog: currentCatalog, candidate, result };`,
`      const result = await applySingle(plan, \`${'${scenarioId}'}: ADD\`);
      const addReceipt = (result.rows || []).find(row => row?.type === 'add' && row?.status === 'ok' && row?.rowCardId);
      const receiptRowCardId = String(addReceipt?.rowCardId || '');
      if (!receiptRowCardId) throw new Error(\`${'${scenarioId}'}: успешный ADD не вернул RowCardID для cleanup.\`);
      try {
        const after = await freshSnapshot();
        const created = after.snapshot.rows.find(row => canon(row.rowCardId) === canon(receiptRowCardId));
        if (!created) throw new Error('Добавленная временная строка не найдена по RowCardID после read-back.');
        return { created, after: after.snapshot, bridge: after.bridge, catalog: currentCatalog, candidate, result };
      } catch (error) {
        // FULL_UAT_ADD_RECEIPT_RECOVERY_V1
        const cleanupOk = await cleanupCreatedRow(receiptRowCardId, \`${'${scenarioId}'}-add-readback-recovery\`);
        if (!cleanupOk) throw new Error(\`${'${scenarioId}'}: ADD был принят, read-back не завершён, cleanup по receipt RowCardID не подтверждён: ${'${String(error?.message || error)}'}\`);
        throw error;
      }`,
  'Full UAT ADD receipt recovery',
);

// A NOT_RUN branch occurs after a real temporary ADD. Cleanup before returning rather
// than relying on the final baseline detector to merely report UNSAFE.
replaceExact(
`          if (!clearPlan) return { status: 'NOT_RUN', detail: 'Не найдено доказанно необязательное заполненное поле временной строки.' };`,
`          if (!clearPlan) {
            // FULL_UAT_CLEAR_NOT_RUN_CLEANUP_V1
            const cleanupOk = await cleanupCreatedRow(rowCardId, 'write-clear-delete-not-run');
            if (!cleanupOk) throw new Error('Cleanup временной строки перед NOT_RUN не подтверждён.');
            const final = await freshSnapshot();
            if (!sameArray(snapshotSignature(final.snapshot), baselineSignature)) throw new Error('После NOT_RUN cleanup baseline не восстановлен.');
            return { status: 'NOT_RUN', detail: 'Не найдено доказанно необязательное заполненное поле временной строки; временная строка удалена и baseline восстановлен.' };
          }`,
  'Full UAT NOT_RUN cleanup',
);

for (const marker of [
  "E.applyPlan(plan, { confirm: () => true, source: 'full-uat' })",
  'MERGE_COPY_IDENTITY_SCORING_V1',
  'FULL_UAT_STRICT_APPLY_RESULT_V1',
  'FULL_UAT_ADD_RECEIPT_RECOVERY_V1',
  'FULL_UAT_CLEAR_NOT_RUN_CLEANUP_V1',
]) {
  if (!source.includes(marker)) throw new Error(`Full UAT live finalizer verification failed: ${marker}`);
}

fs.writeFileSync(target, source, 'utf8');
console.log('TESSA Matrix Studio v1.13.0 Full UAT live/review finalize: OK');
