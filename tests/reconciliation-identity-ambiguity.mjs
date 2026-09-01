import fs from 'node:fs';
import vm from 'node:vm';

// Pre-release fail-closed regression: identity ambiguity must never become verified.
const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = {
  body: { innerText: '' },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ click() {}, style: {}, set href(_) {}, set download(_) {} }),
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;
const structure = {
  templateId: 'template-1',
  conditions: [{ criterionRowId: 'criterion-org', criterionName: 'Организация', operandTypeId: O.ReferenceGuid }],
  functions: [],
};

function row(card, version, org = 'org-1') {
  return {
    rowCardId: card,
    versionId: version,
    values: { 'criterion-org': [{ id: org, display: org, kind: 'ReferenceGuid' }] },
    roles: {},
  };
}

function receipt(current) {
  return {
    type: 'update',
    excelRow: 15,
    rowCardId: current.rowCardId,
    versionId: current.versionId,
    expectedSemanticKey: E.reconciliationSemanticKey(current, structure),
  };
}

// Same RowCardID appearing twice is an invalid/ambiguous fresh snapshot. Never let
// Map's last-write-wins semantics silently select a row and report verified.
{
  const expected = row('card-dup', 'version-expected', 'org-1');
  const duplicate = row('card-dup', 'version-other', 'org-1');
  const result = E.reconcileMutationReceipts(
    [receipt(expected)],
    { matrixId: 'matrix-1', templateId: structure.templateId, rows: [expected, duplicate] },
    structure,
  );
  assert(result.status === 'incomplete', JSON.stringify(result));
  assert(result.unknownCount === 1 && result.verifiedCount === 0, JSON.stringify(result));
  assert(result.rows[0].reasonCode === 'reconcile-identity-ambiguous', JSON.stringify(result.rows[0]));
}

// Same VersionID collision must fail closed as well.
{
  const expected = row('card-expected', 'version-dup', 'org-1');
  const duplicate = row('card-other', 'version-dup', 'org-1');
  const result = E.reconcileMutationReceipts(
    [receipt(expected)],
    { matrixId: 'matrix-1', templateId: structure.templateId, rows: [expected, duplicate] },
    structure,
  );
  assert(result.status === 'incomplete', JSON.stringify(result));
  assert(result.rows[0].reasonCode === 'reconcile-identity-ambiguous', JSON.stringify(result.rows[0]));
}

// If RowCardID and VersionID resolve to two different rows, the receipt identity is
// internally inconsistent. Do not prefer RowCardID with `byCard || byVersion`.
{
  const expected = row('card-a', 'version-a', 'org-1');
  const byCard = row('card-a', 'version-b', 'org-1');
  const byVersion = row('card-b', 'version-a', 'org-1');
  const result = E.reconcileMutationReceipts(
    [receipt(expected)],
    { matrixId: 'matrix-1', templateId: structure.templateId, rows: [byCard, byVersion] },
    structure,
  );
  assert(result.status === 'incomplete', JSON.stringify(result));
  assert(result.unknownCount === 1 && result.verifiedCount === 0, JSON.stringify(result));
  assert(result.rows[0].reasonCode === 'reconcile-identity-conflict', JSON.stringify(result.rows[0]));
}

// A fresh read of another matrix/template is a context mismatch, not a generic read
// failure and never a retryable writer-lock condition.
{
  let reads = 0;
  const context = { matrixId: 'matrix-1', templateId: structure.templateId, receipts: [] };
  const mismatchFactory = async () => ({
    requestStructure: async () => structure,
    loadSnapshot: async () => {
      reads += 1;
      return { matrixId: 'matrix-2', templateId: 'template-2', rows: [] };
    },
  });
  const result = await E.runReconciliationRead(mismatchFactory, context, { attempts: 5, baseDelayMs: 0 });
  assert(reads === 1, `context mismatch must not retry: ${reads}`);
  assert(result.status === 'incomplete' && result.reasonCode === 'reconcile-context-mismatch', JSON.stringify(result));
  assert(result.retryable === false, JSON.stringify(result));
}

console.log('TESSA Matrix Studio reconciliation identity ambiguity/context fail-closed: OK');
