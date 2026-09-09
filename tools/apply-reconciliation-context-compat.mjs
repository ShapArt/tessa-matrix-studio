import fs from 'node:fs';

const file = new URL('../tessa-matrix-studio.user.js', import.meta.url);
let code = fs.readFileSync(file, 'utf8');

function replaceOnce(before, after) {
  const index = code.indexOf(before);
  if (index < 0) throw new Error(`pattern not found:\n${before.slice(0, 240)}`);
  if (code.indexOf(before, index + before.length) >= 0) throw new Error('pattern is not unique');
  code = code.slice(0, index) + after + code.slice(index + before.length);
}

replaceOnce(
`        const expectedMatrixId = canonicalValue(receiptContext?.matrixId || '');
        const actualMatrixId = canonicalValue(bridge?.mainCard?.id || '');
        const expectedTemplateId = canonicalValue(receiptContext?.templateId || '');
        const actualTemplateId = canonicalValue(bridge?.templateId?.() || structure?.templateId || '');
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

        try {
          const snapshot = await bridge.loadSnapshot(structure);
          return {`,
`        const expectedMatrixId = canonicalValue(receiptContext?.matrixId || '');
        const directMatrixId = canonicalValue(bridge?.mainCard?.id || '');
        const expectedTemplateId = canonicalValue(receiptContext?.templateId || '');
        const directTemplateId = canonicalValue(bridge?.templateId?.() || structure?.templateId || '');
        if (!expectedMatrixId || !expectedTemplateId
          || (directMatrixId && directMatrixId !== expectedMatrixId)
          || (directTemplateId && directTemplateId !== expectedTemplateId)) {
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

        try {
          const snapshot = await bridge.loadSnapshot(structure);
          const snapshotMatrixId = canonicalValue(snapshot?.matrixId || directMatrixId || '');
          const snapshotTemplateId = canonicalValue(snapshot?.templateId || directTemplateId || structure?.templateId || '');
          if (snapshotMatrixId !== expectedMatrixId || snapshotTemplateId !== expectedTemplateId) {
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
          return {`);

replaceOnce(
`          if (isWriterLockError(error) || !isNativeIdentitySnapshotError(error)) throw error;
          log(`,
`          if (isWriterLockError(error) || !isNativeIdentitySnapshotError(error)) throw error;
          // Targeted fallback may bypass full snapshot identity, so the open card itself
          // must prove the matrix/template context first. Legacy/fake bridges without
          // direct context keep the old fail-closed full-snapshot behavior.
          if (!directMatrixId || !directTemplateId) throw error;
          log(`);

fs.writeFileSync(file, code);
console.log('Applied reconciliation context compatibility patch');
