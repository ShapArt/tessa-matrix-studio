import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ click() {}, style: {}, set href(_) {}, set download(_) {} }) };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;
const structure = {
  templateId: 'reconcile-touch-template',
  conditions: [{ criterionRowId: 'org', criterionName: 'Организация', operandTypeId: O.ReferenceGuid }],
  functions: [{ id: 'sign', name: 'Подписание', typeName: 'Подписание' }],
};
const expected = {
  rowCardId: 'card-u', versionId: 'version-u',
  values: { org: [{ id: 'org-1', display: 'Орг 1', kind: 'ReferenceGuid' }] },
  roles: { sign: [{ id: 'person-1', display: 'Иванов И.И.', roleTypeId: 1 }] },
};
const receipt = {
  type: 'update', excelRow: 15, rowCardId: expected.rowCardId, versionId: expected.versionId,
  expectedSemanticKey: E.reconciliationSemanticKey(expected, structure),
};
let fullSnapshotReads = 0;
let targetedCardGets = 0;
const bridge = {
  mainCard: { id: 'matrix-r' },
  templateId: () => structure.templateId,
  requestStructure: async () => structure,
  loadSnapshot: async () => { fullSnapshotReads += 1; return { matrixId: 'matrix-r', templateId: structure.templateId, rows: [expected] }; },
  rawMatrixSectionLinks: () => [{ index: 0, rowRowID: expected.versionId, rowID: 'section-u', cardRowId: 'section-card-u' }],
  collectNativeMatrixViewLinksAllPages: async () => ({ links: [{ rowCardId: expected.rowCardId, versionId: expected.versionId }] }),
  getCard: async cardId => { targetedCardGets += 1; assert(cardId === expected.rowCardId, cardId); return { current: expected }; },
  readMatrixRowFromCard: (card, link) => ({ ...card.current, ...link }),
};
const result = await E.runReconciliationRead(
  async () => bridge,
  { matrixId: 'matrix-r', templateId: structure.templateId, receipts: [receipt] },
  { attempts: 1, baseDelayMs: 0 },
);
assert(result.status === 'verified', JSON.stringify(result));
assert(result.mode === 'targeted-receipts', JSON.stringify(result));
assert(fullSnapshotReads === 0, `reconciliation performed ${fullSnapshotReads} full snapshot reads before targeted receipts`);
assert(targetedCardGets === 1, `targeted CardGet count=${targetedCardGets}`);
assert(result.checkedCount === 1 && result.verifiedCount === 1, JSON.stringify(result));

console.log('TESSA Matrix Studio touched-only reconciliation: OK');
