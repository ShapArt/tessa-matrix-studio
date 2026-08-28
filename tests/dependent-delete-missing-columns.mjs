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
  templateId: 'missing-column-dependent-delete-template',
  conditions: [
    {
      criterionRowId: 'criterion-org',
      criterionName: 'Организация',
      operandTypeId: O.ReferenceGuid,
      autocompleteViewName: 'Organizations',
      refSection: 'Organizations',
    },
    {
      criterionRowId: 'criterion-region',
      criterionName: 'Регион',
      operandTypeId: O.ReferenceGuid,
      autocompleteViewName: 'Regions',
      refSection: 'Regions',
    },
  ],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};

function row(index, card, version, orgId, org, regionId, region, personId, person) {
  const flat = {
    'criterion:criterion-org': [org],
    'criterion:criterion-region': [region],
    'function:function-sign': [person],
  };
  return {
    index,
    rowCardId: card,
    versionId: version,
    fingerprint: E.fingerprintFlat(flat),
    values: {
      'criterion-org': [{ id: orgId, display: org }],
      'criterion-region': [{ id: regionId, display: region }],
    },
    roles: {
      'function-sign': [{ id: personId, display: person, roleTypeId: 'role-type' }],
    },
    flat,
  };
}

// Region is intentionally identical in A and B. A stale Excel exported before the Region
// column existed will not contain it, but Studio promises that missing current TESSA columns
// retain their current values. Therefore A -> B on the visible columns really does produce B.
const snapshot = {
  matrixId: 'missing-column-dependent-delete-matrix',
  templateId: structure.templateId,
  rows: [
    row(0, 'card-a', 'version-a', 'org-a', 'Компания А', 'region-1', 'Центр', 'person-a', 'Иванов И.И.'),
    row(1, 'card-b', 'version-b', 'org-b', 'Компания Б', 'region-1', 'Центр', 'person-b', 'Петров П.П.'),
  ],
  criterionIdCache: new Map(),
  roleIdByFunctionCache: new Map(),
  roleIdCache: new Map(),
};

const matrixInfo = {
  matrixId: snapshot.matrixId,
  TemplateID: snapshot.templateId,
  TemplateName: 'MISSING COLUMN DEPENDENCY QA',
  StateName: 'Черновик',
};

const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, matrixInfo, catalog);
const workbook = await E.readXlsxArrayBuffer(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  'missing-column-dependent-delete.xlsx'
);

const staleWorkbook = {
  ...workbook,
  headers: [...workbook.headers],
  schemaTokens: [...workbook.schemaTokens],
  rows: workbook.rows.map(item => ({ excelRow: item.excelRow, values: [...item.values] })),
};

// Simulate a legitimate stale roundtrip schema by removing one current TESSA definition and
// its companion ID column from the user-visible workbook. This is explicitly supported by
// buildColumnMap(): missing current columns must preserve their TESSA values.
const regionIndexes = [
  staleWorkbook.headers.indexOf('Регион'),
  staleWorkbook.headers.indexOf('Регион__ID'),
].filter(index => index >= 0).sort((a, b) => b - a);
assert(regionIndexes.length === 2, `Region columns unavailable: ${JSON.stringify(staleWorkbook.headers)}`);
for (const index of regionIndexes) {
  staleWorkbook.headers.splice(index, 1);
  staleWorkbook.schemaTokens.splice(index, 1);
  for (const item of staleWorkbook.rows) item.values.splice(index, 1);
}
assert(!staleWorkbook.schemaTokens.some(token => String(token || '').includes('criterion-region')),
  `stale workbook still exposes Region schema token: ${JSON.stringify(staleWorkbook.schemaTokens)}`);

const orgIndex = staleWorkbook.headers.indexOf('Организация');
const orgIdIndex = staleWorkbook.headers.indexOf('Организация__ID');
const signerIndex = staleWorkbook.headers.indexOf('Подписание');
const signerIdIndex = staleWorkbook.headers.indexOf('Подписание__ID');
assert([orgIndex, orgIdIndex, signerIndex, signerIdIndex].every(index => index >= 0),
  'visible matrix columns unavailable after stale-schema simulation');

// Final intent: UPDATE A to B on all visible columns and physically DELETE B.
// Omitted Region is preserved from current A and already equals B, so the true final A equals B.
staleWorkbook.rows[0].values[orgIndex] = staleWorkbook.rows[1].values[orgIndex];
staleWorkbook.rows[0].values[orgIdIndex] = staleWorkbook.rows[1].values[orgIdIndex];
staleWorkbook.rows[0].values[signerIndex] = staleWorkbook.rows[1].values[signerIndex];
staleWorkbook.rows[0].values[signerIdIndex] = staleWorkbook.rows[1].values[signerIdIndex];
staleWorkbook.rows.splice(1, 1);

const plan = E.buildPlan(staleWorkbook, structure, snapshot);
const update = plan.actions.find(action => action.type === 'update' && action.currentRow?.versionId === 'version-a');
const deletion = plan.actions.find(action => action.type === 'delete' && action.currentRow?.versionId === 'version-b');
assert(update, `UPDATE A missing: ${JSON.stringify(plan.counts)}`);
assert(deletion, `DELETE B missing: ${JSON.stringify(plan.counts)}`);
assert(!plan.safety?.blocked, `supported stale schema unexpectedly blocked: ${JSON.stringify(plan.safety)}`);
assert(plan.warnings.some(warning => /новые|пропущенные.*колон/i.test(String(warning))),
  `missing-column warning absent: ${JSON.stringify(plan.warnings)}`);
assert(update.excelRow.flat['criterion:criterion-region'] === undefined,
  `stale Excel unexpectedly contains omitted Region: ${JSON.stringify(update.excelRow.flat)}`);
assert(update.currentRow.flat['criterion:criterion-region']?.[0] === 'Центр',
  'current TESSA Region required for preserved-field dependency is missing');

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
    `dependent DELETE with omitted preserved columns must not remain ready: ${preflight.readyDeletes.length}`);
  assert(preflight.runtimeSkips.some(item => item.actionType === 'update'),
    `UPDATE runtime SKIP missing: ${JSON.stringify(preflight.runtimeSkips)}`);
  assert(preflight.runtimeSkips.some(item => item.actionType === 'delete'),
    `dependent DELETE runtime SKIP missing: ${JSON.stringify(preflight.runtimeSkips)}`);
} finally {
  E.TessaBridge.create = originalCreate;
}

console.log('TESSA Matrix Studio stale-schema dependent DELETE regression: OK');
