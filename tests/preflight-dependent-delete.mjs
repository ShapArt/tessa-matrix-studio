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
  templateId: 'dependent-delete-template',
  conditions: [{
    criterionRowId: 'criterion-org',
    criterionName: 'Организация',
    operandTypeId: O.ReferenceGuid,
    autocompleteViewName: 'Organizations',
    refSection: 'Organizations',
  }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};

function row(index, card, version, orgId, org, personId, person) {
  const flat = {
    'criterion:criterion-org': [org],
    'function:function-sign': [person],
  };
  return {
    index,
    rowCardId: card,
    versionId: version,
    fingerprint: E.fingerprintFlat(flat),
    values: { 'criterion-org': [{ id: orgId, display: org }] },
    roles: { 'function-sign': [{ id: personId, display: person, roleTypeId: 'role-type' }] },
    flat,
  };
}

const snapshot = {
  matrixId: 'dependent-delete-matrix',
  templateId: structure.templateId,
  rows: [
    row(0, 'card-a', 'version-a', 'org-a', 'Компания А', 'person-a', 'Иванов И.И.'),
    row(1, 'card-b', 'version-b', 'org-b', 'Компания Б', 'person-b', 'Петров П.П.'),
  ],
  criterionIdCache: new Map(),
  roleIdByFunctionCache: new Map(),
  roleIdCache: new Map(),
};

const matrixInfo = {
  matrixId: snapshot.matrixId,
  TemplateID: snapshot.templateId,
  TemplateName: 'DEPENDENT DELETE QA',
  StateName: 'Черновик',
};

const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, matrixInfo, catalog);
const workbook = await E.readXlsxArrayBuffer(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  'dependent-delete.xlsx'
);
const edited = {
  ...workbook,
  rows: workbook.rows.map(item => ({ excelRow: item.excelRow, values: [...item.values] })),
};

const orgIndex = workbook.headers.indexOf('Организация');
const orgIdIndex = workbook.headers.indexOf('Организация__ID');
const signerIndex = workbook.headers.indexOf('Подписание');
const signerIdIndex = workbook.headers.indexOf('Подписание__ID');
assert([orgIndex, orgIdIndex, signerIndex, signerIdIndex].every(index => index >= 0), 'matrix columns unavailable');

// Final desired state is valid: row A becomes semantically identical to B, while B is physically removed.
// Preview therefore contains UPDATE A + DELETE B and no duplicate in the final matrix.
edited.rows[0].values[orgIndex] = workbook.rows[1].values[orgIndex];
edited.rows[0].values[orgIdIndex] = workbook.rows[1].values[orgIdIndex];
edited.rows[0].values[signerIndex] = workbook.rows[1].values[signerIndex];
edited.rows[0].values[signerIdIndex] = workbook.rows[1].values[signerIdIndex];
edited.rows.splice(1, 1);

const plan = E.buildPlan(edited, structure, snapshot);
const update = plan.actions.find(action => action.type === 'update' && action.currentRow?.versionId === 'version-a');
const deletion = plan.actions.find(action => action.type === 'delete' && action.currentRow?.versionId === 'version-b');
assert(update, `UPDATE A missing: ${JSON.stringify(plan.counts)}`);
assert(deletion, `DELETE B missing: ${JSON.stringify(plan.counts)}`);
assert(E.fingerprintFlat(update.excelRow.flat) === snapshot.rows[1].fingerprint,
  'UPDATE A must depend on removing B to avoid a temporary duplicate');
assert(!plan.safety?.blocked, `preview unexpectedly blocked: ${JSON.stringify(plan.safety)}`);

// Fresh TESSA is unchanged since Preview. During current preflight UPDATE is validated before DELETE,
// so duplicate validation still sees B and rejects A. Safety contract: B must then NOT remain ready to
// delete, otherwise Apply would skip UPDATE A and still delete B, producing a destructive partial state.
const bridge = {
  matrixInfo: () => matrixInfo,
  templateId: () => structure.templateId,
  requestStructure: async () => structure,
  loadSnapshot: async () => snapshot,
  resolveReferenceOnline: async () => null,
  resolveCriterion: (condition, display, id) => ({ id, display }),
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
    `duplicate-dependent UPDATE must be skipped in this reproduction: ${preflight.preparedUpdates.size}`);
  assert(preflight.readyDeletes.length === 0,
    `dependent DELETE must not remain ready after its replacement UPDATE was skipped: ${preflight.readyDeletes.length}`);
  assert(preflight.runtimeSkips.some(item => item.actionType === 'update'),
    `UPDATE runtime SKIP missing: ${JSON.stringify(preflight.runtimeSkips)}`);
  assert(preflight.runtimeSkips.some(item => item.actionType === 'delete'),
    `dependent DELETE runtime SKIP missing: ${JSON.stringify(preflight.runtimeSkips)}`);
} finally {
  E.TessaBridge.create = originalCreate;
}

console.log('TESSA Matrix Studio dependent DELETE preflight regression: OK');
