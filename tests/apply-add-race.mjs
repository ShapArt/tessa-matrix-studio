import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = {
  body: { innerText: 'Завершить редактирование и разблокировать' },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ click: () => {}, href: '', download: '' }),
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;
const structure = {
  templateId: 'add-race-template',
  conditions: [{
    criterionRowId: 'criterion-org', criterionName: 'Организация',
    operandTypeId: O.ReferenceGuid, autocompleteViewName: 'Organizations', refSection: 'Organizations',
  }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};
const flat = { 'criterion:criterion-org': ['Компания А'], 'function:function-sign': ['Иванов И.И.'] };
const sourceRow = {
  index: 0,
  rowCardId: 'card-a',
  versionId: 'version-a',
  fingerprint: E.fingerprintFlat(flat),
  flat,
  values: { 'criterion-org': [{ id: 'org-a', display: 'Компания А' }] },
  roles: { 'function-sign': [{ id: 'person-a', display: 'Иванов И.И.', roleTypeId: 'role-type' }] },
};
const snapshot = {
  matrixId: 'add-race-matrix', templateId: structure.templateId, rows: [sourceRow],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const matrixInfo = {
  matrixId: snapshot.matrixId, TemplateID: snapshot.templateId,
  TemplateName: 'ADD RACE QA', StateName: 'Черновик', Name: 'ADD RACE QA',
};
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, matrixInfo, catalog);
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'add-race.xlsx');
const edited = { ...workbook, rows: workbook.rows.map(item => ({ excelRow: item.excelRow, values: [...item.values] })) };
const signerIndex = workbook.headers.indexOf('Подписание');
const signerIdIndex = workbook.headers.indexOf('Подписание__ID');
assert(signerIndex >= 0 && signerIdIndex >= 0, 'signer columns unavailable');
const copied = { excelRow: edited.rows.at(-1).excelRow + 1, values: [...edited.rows[0].values] };
copied.values[signerIndex] = 'Петров П.П.';
copied.values[signerIdIndex] = 'person-b';
edited.rows.push(copied);
const plan = E.buildPlan(edited, structure, snapshot);
assert(plan.counts.add === 1, `expected one ADD, got ${JSON.stringify(plan.counts)}`);

let duplicateChecks = 0;
let storeCalls = 0;
const bridge = {
  matrixInfo: () => matrixInfo,
  templateId: () => structure.templateId,
  requestStructure: async () => structure,
  loadSnapshot: async () => snapshot,
  resolveReferenceOnline: async () => null,
  resolveCriterion: (condition, display, id) => ({ id, display }),
  resolveRole: (fn, display, id) => ({ id, display }),
  assertCanCreateRows: () => {},
  createRowCard: async () => ({ card: { id: 'new-card', version: 0 }, cardId: 'new-card', versionId: 'new-version', newMethod: 'CardNew' }),
  rebuildRowCard: () => {},
  // First call is preflight. The second one must happen immediately before Store.
  validateDuplicate: async () => {
    duplicateChecks += 1;
    if (duplicateChecks === 2) throw new Error('TESSA обнаружила дублирующую строку матрицы.');
  },
  storeRowCard: async () => { storeCalls += 1; return { cardId: 'new-card', cardVersion: 1 }; },
  tryGetCard: async () => ({ card: { id: 'new-card', version: 1 } }),
  refresh: async () => {},
};

const originalCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => bridge;
try {
  const result = await E.applyPlan(plan);
  assert(duplicateChecks === 2,
    `ADD must repeat duplicate validation immediately before Store, got ${duplicateChecks} checks`);
  assert(storeCalls === 0,
    `ADD must not Store after the second duplicate validation detects a race, got ${storeCalls} stores`);
  assert(result.rows.some(item => item.type === 'add' && item.status === 'skipped'),
    `race-conflicted ADD must be reported as skipped: ${JSON.stringify(result.rows)}`);
} finally {
  E.TessaBridge.create = originalCreate;
}

console.log('TESSA Matrix Studio ADD store-time race regression: OK');

// Exercise the real response contract inside Apply, not just a throwing stub.
// A malformed response and the live interval-handler failure both stop the
// second check before Store, while leaving diagnostic evidence in the report.
const validator = Object.create(E.TessaBridge.prototype);
Object.assign(validator, {
  cards: { CardRequest: class { constructor() { this.info = {}; } } },
  core: { TypedField: { createGuid: x => x }, StorageHelper: { tryGet: (info, key) => info?.[key] } },
  mainCard: { id: snapshot.matrixId }, templateId: () => structure.templateId,
});
for (const cause of ['invalid-response', 'interval-error']) {
  let checks = 0;
  storeCalls = 0;
  validator.cardService = { request: async () => {
    checks++;
    if (checks === 1) return { validationResult: { isSuccessful: true }, info: { ok: true } };
    return cause === 'invalid-response'
      ? { validationResult: { isSuccessful: true }, info: {} }
      : { validationResult: { isSuccessful: false, build: () => 'LeftOperandExtractor is null' } };
  } };
  bridge.validateDuplicate = (_, versionId) => validator.validateDuplicate({ getStorage: () => ({}) }, versionId);
  E.TessaBridge.create = async () => bridge;
  try {
    const result = await E.applyPlan(E.buildPlan(edited, structure, snapshot));
    assert(checks === 2 && storeCalls === 0, `${cause}: rejected validation reached Store`);
    const failure = result.skipped.find(item => item.source === 'store-add');
    assert(failure?.check === 'duplicate' && failure.writeAttempted === false, `${cause}: missing failure stage`);
    assert(result.appliedCount === 0 && result.failedCount === 1, `${cause}: incorrect accounting`);
  } finally { E.TessaBridge.create = originalCreate; }
}
console.log('TESSA Matrix Studio ADD invalid-response / interval-error guards: OK');
