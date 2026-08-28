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
edited.rows.push({ excelRow: edited.rows.at(-1).excelRow + 1, values: [...edited.rows[0].values] });
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
