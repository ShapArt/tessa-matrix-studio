import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = {
  body: { innerText: 'Завершить редактирование и разблокировать' },
  querySelector: () => null,
  querySelectorAll: () => [],
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;

const structure = {
  templateId: 'typed-dependent-delete-template',
  conditions: [{
    criterionRowId: 'criterion-archive',
    criterionName: 'Архивный ОРД',
    operandTypeId: O.Boolean,
  }],
  functions: [{ id: 'function-reg', name: 'Регистрация', typeName: 'Регистрация' }],
};

function row(index, card, version, boolRaw, roleId, roleName) {
  const flat = {
    'criterion:criterion-archive': [boolRaw],
    'function:function-reg': [roleName],
  };
  return {
    index,
    rowCardId: card,
    versionId: version,
    fingerprint: E.fingerprintFlat(flat),
    values: { 'criterion-archive': [{ value: boolRaw, display: boolRaw }] },
    roles: { 'function-reg': [{ id: roleId, display: roleName, roleTypeId: 'role-type' }] },
    flat,
  };
}

const snapshot = {
  matrixId: 'typed-dependent-delete-matrix',
  templateId: structure.templateId,
  rows: [
    row(0, 'card-a', 'version-a', 'false', 'role-reg', 'Делопроизводитель (бэк-офис)'),
    row(1, 'card-b', 'version-b', 'true', 'role-reg', 'Делопроизводитель (бэк-офис)'),
  ],
  criterionIdCache: new Map(),
  roleIdByFunctionCache: new Map(),
  roleIdCache: new Map(),
};

const matrixInfo = {
  matrixId: snapshot.matrixId,
  TemplateID: snapshot.templateId,
  TemplateName: 'TYPED DEPENDENT DELETE QA',
  StateName: 'Черновик',
};

const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, matrixInfo, catalog);
const workbook = await E.readXlsxArrayBuffer(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  'typed-dependent-delete.xlsx'
);
const edited = {
  ...workbook,
  rows: workbook.rows.map(item => ({ excelRow: item.excelRow, values: [...item.values] })),
};

const archiveIndex = workbook.headers.indexOf('Архивный ОРД');
assert(archiveIndex >= 0, `Boolean column unavailable: ${JSON.stringify(workbook.headers)}`);

// Real UAT shape: current TESSA stores Boolean as raw "true", while Excel shows/edit uses "Да".
// Final intent is UPDATE A -> semantic state of B, then physical DELETE B.
edited.rows[0].values[archiveIndex] = 'Да';
edited.rows.splice(1, 1);

const plan = E.buildPlan(edited, structure, snapshot);
const update = plan.actions.find(action => action.type === 'update' && action.currentRow?.versionId === 'version-a');
const deletion = plan.actions.find(action => action.type === 'delete' && action.currentRow?.versionId === 'version-b');
assert(update, `UPDATE A missing: ${JSON.stringify(plan.counts)}`);
assert(deletion, `DELETE B missing: ${JSON.stringify(plan.counts)}`);
assert(update.excelRow.flat['criterion:criterion-archive']?.[0] === 'Да',
  `Excel Boolean representation must stay user-facing: ${JSON.stringify(update.excelRow.flat)}`);
assert(deletion.currentRow.flat['criterion:criterion-archive']?.[0] === 'true',
  `TESSA Boolean reproduction must use raw true: ${JSON.stringify(deletion.currentRow.flat)}`);
assert(E.booleanSemantic(update.excelRow.flat['criterion:criterion-archive'][0]) === true,
  'Excel Да must be semantically true');
assert(E.booleanSemantic(deletion.currentRow.flat['criterion:criterion-archive'][0]) === true,
  'TESSA true must be semantically true');
assert(E.fingerprintFlat(update.excelRow.flat) !== deletion.currentRow.fingerprint,
  'Regression setup requires the old raw fingerprint mismatch (Да vs true)');

const bridge = {
  matrixInfo: () => matrixInfo,
  templateId: () => structure.templateId,
  requestStructure: async () => structure,
  loadSnapshot: async () => snapshot,
  resolveCriterion: () => ({ value: true, display: 'Да' }),
  resolveRole: (fn, display, id) => ({ id, display }),
  getCard: async () => ({}),
  rebuildRowCard: () => {},
  validateDuplicate: async () => { throw new Error('duplicate row still exists before planned DELETE'); },
};

const originalCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => bridge;
try {
  const preflight = await E.preflightPlan(plan);
  assert(preflight.preparedUpdates.size === 0,
    `duplicate-dependent UPDATE must be skipped: ${preflight.preparedUpdates.size}`);
  assert(preflight.readyDeletes.length === 0,
    `DELETE B must be blocked when semantically equivalent UPDATE A failed: ${preflight.readyDeletes.length}`);
  assert(preflight.runtimeSkips.some(item => item.actionType === 'update'),
    `UPDATE runtime SKIP missing: ${JSON.stringify(preflight.runtimeSkips)}`);
  assert(preflight.runtimeSkips.some(item => item.actionType === 'delete'),
    `semantic dependent DELETE runtime SKIP missing: ${JSON.stringify(preflight.runtimeSkips)}`);
} finally {
  E.TessaBridge.create = originalCreate;
}

console.log('TESSA Matrix Studio typed-semantic dependent DELETE regression: OK');
