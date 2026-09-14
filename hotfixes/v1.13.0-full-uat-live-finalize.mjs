import fs from 'node:fs';

const target = process.argv[2] || 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(target, 'utf8');

function replaceExact(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  source = source.replace(before, after);
}

// The copied-ID merge path lives in a different function scope from buildPlan(). The
// lifecycle overlay reuses the same policy, but the scorer itself must also exist locally.
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

// Full UAT already asks for one explicit consent before entering the destructive phase.
// Bypass nested per-operation dialogs only for this runner; ordinary Apply keeps UI.
replaceExact(
`      const result = await E.applyPlan(plan);`,
`      const result = await E.applyPlan(plan, { confirm: () => true, source: 'full-uat' });`,
  'pre-approved Full UAT Apply',
);

// A truthy Apply object may still represent partial/cancelled work. Full UAT accepts
// exactly one completed mutation and rejects any skip/unstarted/write failure.
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

// Task9 introduced a cleanup-obligation ledger before the temporary ADD starts. Bind that
// obligation to the exact RowCardID returned by the successful ADD receipt *before* doing
// post-write read-back. If read-back itself fails, cleanup can therefore target the exact
// accepted row rather than guessing from a row-count diff.
replaceExact(
`      const after = await freshSnapshot();
      const created = after.snapshot.rows.filter(row => !beforeIds.has(canon(row.rowCardId)));
      if (created.length !== 1) {
        resolveCleanupObligation(rowObligation.id, { status: 'pending', discoveredRowIds: created.map(row => row.rowCardId) });
        throw new Error(\`После ADD ожидалась 1 новая строка, найдено ${'${created.length}'}.\`);
      }
      resolveCleanupObligation(rowObligation.id, { status: 'pending', rowCardId: created[0].rowCardId, identifiedAt: now() });
      return { created: created[0], after: after.snapshot, bridge: after.bridge, catalog: currentCatalog, candidate, result, cleanupObligationId: rowObligation.id };`,
`      // FULL_UAT_ADD_RECEIPT_RECOVERY_V2
      const addReceipt = (result.rows || []).find(row => row?.type === 'add' && row?.status === 'ok' && row?.rowCardId);
      const receiptRowCardId = String(addReceipt?.rowCardId || '');
      if (!receiptRowCardId) throw new Error(\`${'${scenarioId}'}: успешный ADD не вернул RowCardID для cleanup.\`);
      resolveCleanupObligation(rowObligation.id, { status: 'pending', rowCardId: receiptRowCardId, identifiedAt: now(), identifiedBy: 'apply-receipt' });
      let after;
      try {
        after = await freshSnapshot();
      } catch (error) {
        const cleanupOk = await cleanupCreatedRow(receiptRowCardId, \`${'${scenarioId}'}-add-readback-recovery\`);
        if (!cleanupOk) throw new Error(\`${'${scenarioId}'}: ADD принят, read-back не завершён и cleanup по receipt RowCardID не подтверждён: ${'${String(error?.message || error)}'}\`);
        throw error;
      }
      const created = after.snapshot.rows.find(row => canon(row.rowCardId) === canon(receiptRowCardId));
      if (!created) {
        const cleanupOk = await cleanupCreatedRow(receiptRowCardId, \`${'${scenarioId}'}-add-receipt-mismatch-recovery\`);
        if (!cleanupOk) throw new Error(\`${'${scenarioId}'}: ADD receipt RowCardID отсутствует в read-back и cleanup не подтверждён.\`);
        throw new Error(\`Добавленная временная строка не найдена по receipt RowCardID ${'${receiptRowCardId}'}.\`);
      }
      return { created, after: after.snapshot, bridge: after.bridge, catalog: currentCatalog, candidate, result, cleanupObligationId: rowObligation.id };`,
  'Full UAT ADD receipt recovery v2',
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
  'FULL_UAT_ADD_RECEIPT_RECOVERY_V2',
  'FULL_UAT_CLEAR_NOT_RUN_CLEANUP_V1',
]) {
  if (!source.includes(marker)) throw new Error(`Full UAT live finalizer verification failed: ${marker}`);
}

fs.writeFileSync(target, source, 'utf8');
console.log('TESSA Matrix Studio v1.14 Full UAT artifact finalize: OK');
