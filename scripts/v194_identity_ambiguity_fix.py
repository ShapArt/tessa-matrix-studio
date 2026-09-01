from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')

old_index = '''  function indexSnapshotForReconciliation(snapshot) {
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
'''
new_index = '''  function indexSnapshotForReconciliation(snapshot) {
    const byCard = new Map();
    const byVersion = new Map();
    const ambiguousCards = new Set();
    const ambiguousVersions = new Set();
    for (const row of snapshot?.rows || []) {
      const card = canonicalValue(row?.rowCardId || '');
      const version = canonicalValue(row?.versionId || '');
      if (card) {
        if (byCard.has(card)) ambiguousCards.add(card);
        else byCard.set(card, row);
      }
      if (version) {
        if (byVersion.has(version)) ambiguousVersions.add(version);
        else byVersion.set(version, row);
      }
    }
    return { byCard, byVersion, ambiguousCards, ambiguousVersions, rowCount: (snapshot?.rows || []).length };
  }
'''
if old_index not in text:
    raise SystemExit('indexSnapshotForReconciliation marker not found')
text = text.replace(old_index, new_index, 1)

old_loop = '''    for (const receipt of receipts || []) {
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
'''
new_loop = '''    for (const receipt of receipts || []) {
      const cardKey = receipt?.rowCardId ? canonicalValue(receipt.rowCardId) : '';
      const versionKey = receipt?.versionId ? canonicalValue(receipt.versionId) : '';
      const byCard = cardKey ? index.byCard.get(cardKey) : null;
      const byVersion = versionKey ? index.byVersion.get(versionKey) : null;
      const cardAmbiguous = Boolean(cardKey && index.ambiguousCards.has(cardKey));
      const versionAmbiguous = Boolean(versionKey && index.ambiguousVersions.has(versionKey));
      if (receipt?.type === 'delete') {
        rows.push(byCard || byVersion || cardAmbiguous || versionAmbiguous
          ? { type: 'delete', excelRow: receipt.excelRow ?? null, status: 'divergent', reasonCode: 'reconcile-delete-still-member' }
          : { type: 'delete', excelRow: receipt.excelRow ?? null, status: 'verified', reasonCode: 'reconcile-delete-absent' });
        continue;
      }
      if (!cardKey && !versionKey) {
        rows.push({ type: receipt?.type || null, excelRow: receipt?.excelRow ?? null, status: 'unknown', reasonCode: 'reconcile-identity-unknown' });
        continue;
      }
      if (cardAmbiguous || versionAmbiguous) {
        rows.push({ type: receipt?.type || null, excelRow: receipt?.excelRow ?? null, status: 'unknown', reasonCode: 'reconcile-identity-ambiguous' });
        continue;
      }
      if (byCard && byVersion && byCard !== byVersion) {
        rows.push({ type: receipt?.type || null, excelRow: receipt?.excelRow ?? null, status: 'unknown', reasonCode: 'reconcile-identity-conflict' });
        continue;
      }
      const current = byCard || byVersion;
      if (!current) {
        rows.push({ type: receipt?.type || null, excelRow: receipt?.excelRow ?? null, status: 'missing', reasonCode: 'reconcile-target-missing' });
        continue;
      }
'''
if old_loop not in text:
    raise SystemExit('reconcile loop marker not found')
text = text.replace(old_loop, new_loop, 1)

old_context = '''        const structure = await bridge.requestStructure(receiptContext.templateId);
        const snapshot = await bridge.loadSnapshot(structure);
        if (canonicalValue(snapshot?.matrixId || '') !== canonicalValue(receiptContext?.matrixId || '')) {
          throw new Error('reconcile-matrix-changed');
        }
        return {
'''
new_context = '''        const structure = await bridge.requestStructure(receiptContext.templateId);
        const snapshot = await bridge.loadSnapshot(structure);
        const expectedMatrixId = canonicalValue(receiptContext?.matrixId || '');
        const actualMatrixId = canonicalValue(snapshot?.matrixId || '');
        const expectedTemplateId = canonicalValue(receiptContext?.templateId || '');
        const actualTemplateId = canonicalValue(snapshot?.templateId || structure?.templateId || '');
        if (!expectedMatrixId || actualMatrixId !== expectedMatrixId
          || !expectedTemplateId || actualTemplateId !== expectedTemplateId) {
          return {
            status: 'incomplete',
            checkedCount: 0,
            verifiedCount: 0,
            divergentCount: 0,
            missingCount: 0,
            unknownCount: receiptContext?.receipts?.length || 0,
            rows: [],
            attempts: attempt,
            retryable: false,
            reasonCode: 'reconcile-context-mismatch',
            startedAt,
            finishedAt: nowIso(),
          };
        }
        return {
'''
if old_context not in text:
    raise SystemExit('reconciliation context marker not found')
text = text.replace(old_context, new_context, 1)

path.write_text(text, encoding='utf-8')
print('v1.9.40 reconciliation identity ambiguity fix applied')
