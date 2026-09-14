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
// Bypass nested per-operation dialogs and defer the native main-card Save until all
// temporary writes and cleanup have completed. Ordinary Apply keeps both behaviours.
replaceExact(
`      const result = await E.applyPlan(plan);`,
`      const result = await E.applyPlan(plan, { confirm: () => true, source: 'full-uat', deferMainMatrixSave: true });`,
  'pre-approved Full UAT Apply with deferred main Save',
);

// Full UAT owns the authoritative post-write proof: every accepted temporary mutation is
// immediately re-read from TESSA and cleanup is verified against the baseline. Therefore
// do not reject an accepted Store/Delete merely because the nested ordinary Apply path
// reports partial due to its own refresh/reconciliation layer. Mutation accounting must
// still prove exactly one accepted write and zero skipped/failed/unstarted work. Preserve
// the first concrete rejection reason so a live failure is actionable without archaeology.
replaceExact(
`      const result = await E.applyPlan(plan, { confirm: () => true, source: 'full-uat', deferMainMatrixSave: true });
      if (!result) throw new Error(\`${'${label}'}: применение отменено.\`);
      report.writesCompleted += 1;
      return result;`,
`      const result = await E.applyPlan(plan, { confirm: () => true, source: 'full-uat', deferMainMatrixSave: true });
      if (!result) throw new Error(\`${'${label}'}: применение отменено.\`);
      // FULL_UAT_STRICT_APPLY_RESULT_V1
      // FULL_UAT_ACCEPTED_WRITE_RESULT_V2
      // FULL_UAT_APPLY_FAILURE_EVIDENCE_V3
      if (result.cancelled === true
        || Number(result.appliedCount || 0) !== 1
        || Number(result.failedCount || 0) !== 0
        || Number(result.notStartedCount || 0) !== 0
        || Number(result.preflightSkippedCount || 0) !== 0
        || Number(result.storeSkippedCount || 0) !== 0) {
        const firstRejected = (result.skipped || [])[0] || (result.rows || []).find(row => row?.status !== 'ok') || null;
        const firstReason = String(firstRejected?.reason || firstRejected?.error || firstRejected?.reasonCode || '').trim();
        throw new Error(\`${'${label}'}: серверная операция завершилась не полностью (status=${'${result.status}'}, applied=${'${result.appliedCount}'}, skipped=${'${result.skippedCount}'}, notStarted=${'${result.notStartedCount}'}).\` + (firstReason ? ' Причина: ' + firstReason : ''));
      }
      report.writesCompleted += 1;
      return result;`,
  'accepted Full UAT write accounting with evidence',
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

// PR #105 moved the only main-card Save into finally but left the recorder shutdown and
// verdict before finally. That made native-write-trace incapable of proving the Save and
// allowed the visible verdict to become stale. Keep the recorder open and defer both the
// final baseline check and final verdict to the post-cleanup transaction below.
replaceExact(
`      if (typeof E.stopNativeOperationRecorder === 'function') { try { const nativeRecord = await E.stopNativeOperationRecorder(false); if (nativeRecord) packageEntries.push(['native-write-trace.json', utf8(nativeRecord)]); } catch (error) { addCheck('native-recorder-stop', 'Остановка нативной записи', 'WARN', String(error?.message || error), { required: false }); } }
      const final = await freshSnapshot(); if (!sameArray(snapshotSignature(final.snapshot), baselineSignature)) { cleanupUnsafe = true; addCheck('final-baseline', 'Финальное состояние матрицы', 'FAIL', 'После UAT исходные строки/значения отличаются от baseline.', { required: true }); } else addCheck('final-baseline', 'Финальное состояние матрицы', 'PASS', 'Исходная матрица полностью восстановлена.', { required: true });
      report.status = cleanupUnsafe ? 'UNSAFE' : report.checks.some(check => check.required !== false && check.status === 'FAIL') ? 'FAILED' : 'PASSED';
    } catch (error) {
      report.fatalError = String(error?.message || error); report.status = cleanupUnsafe ? 'UNSAFE' : 'INCOMPLETE'; timeline('fatal', report.fatalError); try { if (typeof E.stopNativeOperationRecorder === 'function') await E.stopNativeOperationRecorder(false); } catch (_) { /* best effort */ }
    } finally {`,
`      // FULL_UAT_RECORDER_THROUGH_FINAL_SAVE_V2
      // Recorder remains active: cleanup recovery, the sole main-card Save and its proof
      // still belong to the same native evidence window.
    } catch (error) {
      report.fatalError = String(error?.message || error); report.status = cleanupUnsafe ? 'UNSAFE' : 'INCOMPLETE'; timeline('fatal', report.fatalError);
    } finally {`,
  'defer recorder shutdown and verdict until final proof',
);

// All temporary UAT writes (including recovery cleanup) are already proven by fresh
// server read-back. Flush the main matrix through TESSA's native editor exactly once,
// then prove the final baseline while the recorder is still active. Only after that proof
// may native evidence be closed and packaged.
replaceExact(
`      try {
        await recoverCleanupObligations();
        if (cleanupLedgerController && baselineSignature && structure && report.matrix?.matrixId) {`,
`      try {
        await recoverCleanupObligations();
        // FULL_UAT_SINGLE_MAIN_SAVE_V1
        if (report.writesCompleted > 0) {
          if (!bridge || typeof bridge.saveMainMatrixAfterApply !== 'function') throw new Error('Финальный нативный Save основной карточки матрицы недоступен.');
          const finalMainSave = await bridge.saveMainMatrixAfterApply();
          report.finalMatrixSave = E.safePlain(finalMainSave, { maxDepth: 4, maxKeys: 80, maxArray: 20 });
          if (!finalMainSave || finalMainSave.ok === false) throw new Error(\`Финальный нативный Save основной карточки матрицы не подтверждён: ${'${String(finalMainSave?.reason || finalMainSave?.error || \'unknown\')}'}\`);
          timeline('main-matrix-save', 'Один нативный Save после write/cleanup фазы.', { method: finalMainSave.method || null });
        } else {
          report.finalMatrixSave = { ok: false, skipped: true, reason: 'no-accepted-writes' };
        }

        const final = await freshSnapshot();
        if (!sameArray(snapshotSignature(final.snapshot), baselineSignature)) {
          cleanupUnsafe = true;
          addCheck('final-baseline', 'Финальное состояние матрицы', 'FAIL', 'После cleanup и финального Save исходные строки/значения отличаются от baseline.', { required: true });
        } else {
          addCheck('final-baseline', 'Финальное состояние матрицы', 'PASS', 'После cleanup и финального Save исходная матрица полностью восстановлена.', { required: true });
        }

        if (typeof E.stopNativeOperationRecorder === 'function') {
          try {
            const nativeRecord = await E.stopNativeOperationRecorder(false);
            if (nativeRecord) packageEntries.push(['native-write-trace.json', utf8(nativeRecord)]);
          } catch (error) {
            addCheck('native-recorder-stop', 'Остановка нативной записи', 'WARN', String(error?.message || error), { required: false });
          }
        }
        if (cleanupLedgerController && baselineSignature && structure && report.matrix?.matrixId) {`,
  'single final Full UAT main-card Save inside recorder window',
);

// Compute the verdict only after recovery cleanup, final Save, baseline proof and recorder
// closure. Also persist compact failure evidence in two easy-to-open root-level files.
replaceExact(
`      report.functionalActionAudit = actionCoverageFromChecks(report.checks, E.STUDIO_ACTION_REGISTRY || []);
      if (cleanupUnsafe || report.restoreProof?.status === 'UNSAFE') report.status = 'UNSAFE';
      else if (report.functionalActionAudit.missing.length && report.status === 'PASSED') report.status = 'FAILED';
      report.finishedAt = now(); report.durationMs = new Date(report.finishedAt).getTime() - new Date(startedAt).getTime(); report.summary = { pass: report.checks.filter(x => x.status === 'PASS').length, fail: report.checks.filter(x => x.status === 'FAIL').length, warn: report.checks.filter(x => x.status === 'WARN').length, notRun: report.checks.filter(x => x.status === 'NOT_RUN').length, writesAttempted: report.writesAttempted, writesCompleted: report.writesCompleted, cleanupVerified: report.cleanup.filter(x => x.status === 'verified' || x.status === 'already-absent').length, cleanupFailed: report.cleanup.filter(x => x.status === 'FAILED').length, cleanupLedgerPending: Number(report.cleanupLedger?.pending || 0), cleanupLedgerFailed: Number(report.cleanupLedger?.failed || 0), restoreStatus: report.restoreProof?.status || 'NOT_RUN' };
      const summary = { format: 'TESSA_FULL_UAT_SUMMARY_V1', status: report.status, seed: report.seed, studioVersion: report.studioVersion, runnerVersion: report.runnerVersion, matrix: report.matrix, startedAt: report.startedAt, finishedAt: report.finishedAt, summary: report.summary };`,
`      report.functionalActionAudit = actionCoverageFromChecks(report.checks, E.STUDIO_ACTION_REGISTRY || []);
      // FULL_UAT_FINAL_VERDICT_AFTER_SAVE_V2
      const requiredFailures = report.checks.filter(check => check.required !== false && check.status === 'FAIL');
      if (cleanupUnsafe || report.restoreProof?.status === 'UNSAFE') report.status = 'UNSAFE';
      else if (report.fatalError) report.status = 'INCOMPLETE';
      else if (requiredFailures.length || report.functionalActionAudit.missing.length) report.status = 'FAILED';
      else report.status = 'PASSED';

      // FULL_UAT_FAILURE_SUMMARY_V1
      report.failedChecks = report.checks
        .filter(check => check.status === 'FAIL')
        .map(check => ({ id: check.id, title: check.title, detail: check.detail, required: check.required !== false }));
      if (report.failedChecks.length) {
        const failureText = report.failedChecks.map((check, index) => (index + 1) + '. ' + check.id + ' — ' + (check.title || '') + '\\n' + String(check.detail || '')).join('\\n\\n');
        packageEntries.push(['failed-checks.json', utf8({ seed: report.seed, status: report.status, failures: report.failedChecks })], ['FAILURES.txt', utf8(failureText)]);
      }

      report.finishedAt = now(); report.durationMs = new Date(report.finishedAt).getTime() - new Date(startedAt).getTime(); report.summary = { pass: report.checks.filter(x => x.status === 'PASS').length, fail: report.checks.filter(x => x.status === 'FAIL').length, warn: report.checks.filter(x => x.status === 'WARN').length, notRun: report.checks.filter(x => x.status === 'NOT_RUN').length, writesAttempted: report.writesAttempted, writesCompleted: report.writesCompleted, cleanupVerified: report.cleanup.filter(x => x.status === 'verified' || x.status === 'already-absent').length, cleanupFailed: report.cleanup.filter(x => x.status === 'FAILED').length, cleanupLedgerPending: Number(report.cleanupLedger?.pending || 0), cleanupLedgerFailed: Number(report.cleanupLedger?.failed || 0), restoreStatus: report.restoreProof?.status || 'NOT_RUN' };
      const summary = { format: 'TESSA_FULL_UAT_SUMMARY_V1', status: report.status, seed: report.seed, studioVersion: report.studioVersion, runnerVersion: report.runnerVersion, matrix: report.matrix, startedAt: report.startedAt, finishedAt: report.finishedAt, summary: report.summary, failedChecks: report.failedChecks };`,
  'final verdict and failure evidence after Save',
);

for (const marker of [
  "E.applyPlan(plan, { confirm: () => true, source: 'full-uat', deferMainMatrixSave: true })",
  'MERGE_COPY_IDENTITY_SCORING_V1',
  'FULL_UAT_STRICT_APPLY_RESULT_V1',
  'FULL_UAT_ACCEPTED_WRITE_RESULT_V2',
  'FULL_UAT_APPLY_FAILURE_EVIDENCE_V3',
  'FULL_UAT_ADD_RECEIPT_RECOVERY_V2',
  'FULL_UAT_CLEAR_NOT_RUN_CLEANUP_V1',
  'FULL_UAT_RECORDER_THROUGH_FINAL_SAVE_V2',
  'FULL_UAT_SINGLE_MAIN_SAVE_V1',
  'FULL_UAT_FINAL_VERDICT_AFTER_SAVE_V2',
  'FULL_UAT_FAILURE_SUMMARY_V1',
  'native-write-trace.json',
  'failed-checks.json',
  'FAILURES.txt',
]) {
  if (!source.includes(marker)) throw new Error(`Full UAT live finalizer verification failed: ${marker}`);
}

fs.writeFileSync(target, source, 'utf8');
console.log('TESSA Matrix Studio v1.14 Full UAT final proof artifact finalize: OK');
