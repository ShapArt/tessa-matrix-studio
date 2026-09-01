from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')

if 'function indexSnapshotForReconciliation(' in text:
    raise SystemExit('Task 4 reconciliation helpers already exist; refusing duplicate patch.')

marker = '  function deletionGuard(plan) {'
if text.count(marker) != 1:
    raise SystemExit(f'Expected one deletionGuard marker, found {text.count(marker)}')

helpers = r'''
  function indexSnapshotForReconciliation(snapshot) {
    const byCard = new Map();
    const byVersion = new Map();
    for (const row of snapshot?.rows || []) {
      const card = canonicalValue(row?.rowCardId || '');
      const version = canonicalValue(row?.versionId || '');
      if (card) byCard.set(card, row);
      if (version) byVersion.set(version, row);
    }
    return { byCard, byVersion, rowCount: (snapshot?.rows || []).length };
  }

  function reconcileMutationReceipts(receipts, snapshot, structure) {
    const index = indexSnapshotForReconciliation(snapshot);
    const rows = [];
    for (const receipt of receipts || []) {
      const byCard = receipt?.rowCardId ? index.byCard.get(canonicalValue(receipt.rowCardId)) : null;
      const byVersion = receipt?.versionId ? index.byVersion.get(canonicalValue(receipt.versionId)) : null;
      if (receipt?.type === 'delete') {
        rows.push(byCard || byVersion
          ? { type: 'delete', excelRow: receipt.excelRow ?? null, status: 'divergent', reasonCode: 'reconcile-delete-still-member' }
          : { type: 'delete', excelRow: receipt.excelRow ?? null, status: 'verified', reasonCode: 'reconcile-delete-absent' });
        continue;
      }
      if (!receipt?.rowCardId && !receipt?.versionId) {
        rows.push({ type: receipt?.type || null, excelRow: receipt?.excelRow ?? null, status: 'unknown', reasonCode: 'reconcile-identity-unknown' });
        continue;
      }
      const current = byCard || byVersion;
      if (!current) {
        rows.push({ type: receipt?.type || null, excelRow: receipt?.excelRow ?? null, status: 'missing', reasonCode: 'reconcile-target-missing' });
        continue;
      }
      const matches = reconciliationSemanticKey(current, structure) === receipt.expectedSemanticKey;
      rows.push(matches
        ? { type: receipt.type, excelRow: receipt.excelRow ?? null, status: 'verified', reasonCode: 'reconcile-match' }
        : { type: receipt.type, excelRow: receipt.excelRow ?? null, status: 'divergent', reasonCode: 'reconcile-semantic-divergence' });
    }
    const counts = { verified: 0, divergent: 0, missing: 0, unknown: 0 };
    for (const row of rows) {
      if (Object.prototype.hasOwnProperty.call(counts, row.status)) counts[row.status] += 1;
    }
    return {
      status: counts.divergent || counts.missing ? 'divergent' : counts.unknown ? 'incomplete' : 'verified',
      checkedCount: rows.length,
      verifiedCount: counts.verified,
      divergentCount: counts.divergent,
      missingCount: counts.missing,
      unknownCount: counts.unknown,
      rows,
    };
  }

  async function runReconciliationRead(bridgeFactory, receiptContext, options = {}) {
    const maxAttempts = Math.max(1, Math.min(5, Number(options.attempts) || 3));
    const baseDelayMs = Math.max(0, Number(options.baseDelayMs ?? 450));
    const startedAt = nowIso();
    let lastError = null;
    let usedAttempts = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      usedAttempts = attempt;
      if (attempt > 1 && baseDelayMs) await sleep(baseDelayMs * (2 ** (attempt - 2)));
      try {
        const bridge = await bridgeFactory();
        const structure = await bridge.requestStructure(receiptContext.templateId);
        const snapshot = await bridge.loadSnapshot(structure);
        if (canonicalValue(snapshot?.matrixId || '') !== canonicalValue(receiptContext?.matrixId || '')) {
          throw new Error('reconcile-matrix-changed');
        }
        return {
          ...reconcileMutationReceipts(receiptContext?.receipts || [], snapshot, structure),
          attempts: attempt,
          retryable: false,
          startedAt,
          finishedAt: nowIso(),
        };
      } catch (error) {
        lastError = error;
        if (!isWriterLockError(error) || attempt === maxAttempts) break;
      }
    }
    const retryable = isWriterLockError(lastError);
    return {
      status: 'incomplete',
      checkedCount: 0,
      verifiedCount: 0,
      divergentCount: 0,
      missingCount: 0,
      unknownCount: receiptContext?.receipts?.length || 0,
      rows: [],
      attempts: usedAttempts,
      retryable,
      reasonCode: retryable ? 'reconcile-writer-lock' : 'reconcile-read-failed',
      startedAt,
      finishedAt: nowIso(),
    };
  }

'''
text = text.replace(marker, helpers + marker, 1)

export_old = 'typedScalarSemantic, typedRangeSemantic, reconciliationSemanticKey, createMutationReceipt, deletionGuard'
export_new = 'typedScalarSemantic, typedRangeSemantic, reconciliationSemanticKey, createMutationReceipt, indexSnapshotForReconciliation, reconcileMutationReceipts, runReconciliationRead, deletionGuard'
if text.count(export_old) != 1:
    raise SystemExit(f'Expected one reconciliation export marker, found {text.count(export_old)}')
text = text.replace(export_old, export_new, 1)

path.write_text(text, encoding='utf-8')
