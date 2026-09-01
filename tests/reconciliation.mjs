import fs from 'node:fs';
import vm from 'node:vm';

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
assert(typeof E.indexSnapshotForReconciliation === 'function', 'indexSnapshotForReconciliation is missing');
assert(typeof E.reconcileMutationReceipts === 'function', 'reconcileMutationReceipts is missing');

const O = E.constants.OPERAND;
const structure = {
  templateId: 'reconcile-template',
  conditions: [{ criterionRowId: 'criterion-org', criterionName: 'Организация', operandTypeId: O.ReferenceGuid }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};

function row(card, version, org = 'org-1', person = 'person-1') {
  return {
    rowCardId: card,
    versionId: version,
    values: { 'criterion-org': [{ id: org, display: `Организация ${org}`, kind: 'ReferenceGuid' }] },
    roles: { 'function-sign': [{ id: person, display: `Сотрудник ${person}`, roleTypeId: 'role-type' }] },
  };
}
function receipt(type, current, overrides = {}) {
  const has = key => Object.prototype.hasOwnProperty.call(overrides, key);
  return {
    type,
    excelRow: has('excelRow') ? overrides.excelRow : 15,
    rowCardId: has('rowCardId') ? overrides.rowCardId : (current?.rowCardId ?? null),
    versionId: has('versionId') ? overrides.versionId : (current?.versionId ?? null),
    expectedSemanticKey: type === 'delete' ? null : E.reconciliationSemanticKey(overrides.expectedRow || current, structure),
  };
}
function snap(rows) { return { matrixId: 'matrix-1', templateId: structure.templateId, rows }; }

// 1. UPDATE exact identity + exact semantic state => verified.
{
  const current = row('card-u1', 'version-u1');
  const result = E.reconcileMutationReceipts([receipt('update', current)], snap([current]), structure);
  assert(result.status === 'verified', JSON.stringify(result));
  assert(result.verifiedCount === 1 && result.divergentCount === 0 && result.missingCount === 0 && result.unknownCount === 0, JSON.stringify(result));
  assert(result.rows[0].reasonCode === 'reconcile-match', JSON.stringify(result.rows[0]));
}

// 2. UPDATE identity exists but semantic state changed => divergent.
{
  const expected = row('card-u2', 'version-u2', 'org-1');
  const actual = row('card-u2', 'version-u2', 'org-2');
  const result = E.reconcileMutationReceipts([receipt('update', expected)], snap([actual]), structure);
  assert(result.status === 'divergent' && result.divergentCount === 1, JSON.stringify(result));
  assert(result.rows[0].reasonCode === 'reconcile-semantic-divergence', JSON.stringify(result.rows[0]));
}

// 3. UPDATE target identity disappeared => missing, and missing makes overall divergent.
{
  const expected = row('card-u3', 'version-u3');
  const result = E.reconcileMutationReceipts([receipt('update', expected)], snap([]), structure);
  assert(result.status === 'divergent' && result.missingCount === 1, JSON.stringify(result));
  assert(result.rows[0].status === 'missing' && result.rows[0].reasonCode === 'reconcile-target-missing', JSON.stringify(result.rows[0]));
}

// 4. ADD exact created identity + exact semantic state => verified.
{
  const created = row('card-a1', 'version-a1');
  const result = E.reconcileMutationReceipts([receipt('add', created)], snap([created]), structure);
  assert(result.status === 'verified' && result.verifiedCount === 1, JSON.stringify(result));
}

// 5. ADD without provable identity is unknown. Never nearest-match by semantic contents.
{
  const sameSemantic = row('some-other-card', 'some-other-version');
  const unknown = receipt('add', sameSemantic, { rowCardId: null, versionId: null });
  const result = E.reconcileMutationReceipts([unknown], snap([sameSemantic]), structure);
  assert(result.status === 'incomplete' && result.unknownCount === 1, JSON.stringify(result));
  assert(result.rows[0].reasonCode === 'reconcile-identity-unknown', JSON.stringify(result.rows[0]));
}

// 6. DELETE: both target identities absent from fresh membership => verified.
{
  const deleted = row('card-d1', 'version-d1');
  const result = E.reconcileMutationReceipts([receipt('delete', deleted)], snap([]), structure);
  assert(result.status === 'verified' && result.verifiedCount === 1, JSON.stringify(result));
  assert(result.rows[0].reasonCode === 'reconcile-delete-absent', JSON.stringify(result.rows[0]));
}

// 7. DELETE: old VersionID is gone but same RowCardID is still a member with another version => divergent.
{
  const deleted = row('card-d2', 'version-old');
  const stillMember = row('card-d2', 'version-new');
  const result = E.reconcileMutationReceipts([receipt('delete', deleted)], snap([stillMember]), structure);
  assert(result.status === 'divergent' && result.divergentCount === 1, JSON.stringify(result));
  assert(result.rows[0].reasonCode === 'reconcile-delete-still-member', JSON.stringify(result.rows[0]));
}

// 8. Exact accounting: 99 verified + 1 semantic divergence.
{
  const expectedRows = Array.from({ length: 100 }, (_, i) => row(`card-b${i}`, `version-b${i}`, `org-${i}`));
  const receipts = expectedRows.map((item, i) => receipt('update', item, { excelRow: 15 + i }));
  const actualRows = expectedRows.map((item, i) => i === 73 ? row(item.rowCardId, item.versionId, 'org-changed') : item);
  const result = E.reconcileMutationReceipts(receipts, snap(actualRows), structure);
  assert(result.checkedCount === 100 && result.verifiedCount === 99 && result.divergentCount === 1, JSON.stringify(result));
  assert(result.missingCount === 0 && result.unknownCount === 0 && result.status === 'divergent', JSON.stringify(result));
}

// 9. Unknown without any divergence/missing => incomplete, not falsely verified.
{
  const good = row('card-good', 'version-good');
  const unknown = receipt('add', good, { rowCardId: null, versionId: null, excelRow: 16 });
  const result = E.reconcileMutationReceipts([receipt('update', good), unknown], snap([good]), structure);
  assert(result.status === 'incomplete' && result.verifiedCount === 1 && result.unknownCount === 1, JSON.stringify(result));
}

console.log('TESSA Matrix Studio strict mutation reconciliation matrix: OK');
