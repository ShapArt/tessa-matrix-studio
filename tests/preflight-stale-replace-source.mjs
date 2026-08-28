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
  templateId: 'replace-template',
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
  matrixId: 'replace-matrix',
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
  TemplateName: 'REPLACE QA',
  StateName: 'Черновик',
};
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, matrixInfo, catalog);
const workbook = await E.readXlsxArrayBuffer(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  'replace.xlsx'
);
const cloneWorkbook = source => ({
  ...source,
  rows: source.rows.map(item => ({ excelRow: item.excelRow, values: [...item.values] })),
});

const signerIndex = workbook.headers.indexOf('Подписание');
const signerIdIndex = workbook.headers.indexOf('Подписание__ID');
assert(signerIndex >= 0 && signerIdIndex >= 0, 'signer columns unavailable');

// REPLACE: copy row A over physical row B while preserving B signer so target changes only in organization.
const replace = cloneWorkbook(workbook);
replace.rows[1].values = [...replace.rows[0].values];
replace.rows[1].values[signerIndex] = workbook.rows[1].values[signerIndex];
replace.rows[1].values[signerIdIndex] = workbook.rows[1].values[signerIdIndex];
const plan = E.buildPlan(replace, structure, snapshot);
const action = plan.actions.find(item => item.type === 'update' && E.isOverwriteMatch(item.match));
assert(action, `REPLACE action missing: ${JSON.stringify(plan.counts)}`);
assert(action.currentRow.versionId === 'version-b', 'REPLACE target must be B');
assert(action.match.sourceIdentity?.includes('version-a'), `REPLACE source identity missing: ${JSON.stringify(action.match)}`);

// After preview only source A changes in TESSA. Target B stays exactly as previewed.
// Safety contract: Apply must not copy stale pre-change A into B; preflight must SKIP and ask for re-check.
const fresh = {
  ...snapshot,
  rows: [
    row(0, 'card-a', 'version-a', 'org-a2', 'Компания А — изменена после preview', 'person-a', 'Иванов И.И.'),
    snapshot.rows[1],
  ],
  criterionIdCache: new Map(),
  roleIdByFunctionCache: new Map(),
  roleIdCache: new Map(),
};

const bridge = {
  matrixInfo: () => matrixInfo,
  templateId: () => structure.templateId,
  requestStructure: async () => structure,
  loadSnapshot: async () => fresh,
  resolveReferenceOnline: async () => null,
  resolveCriterion: (condition, display, id) => ({ id, display }),
  resolveRole: (fn, display, id) => ({ id, display }),
  getCard: async () => ({}),
  rebuildRowCard: () => {},
  validateDuplicate: async () => {},
};

const originalCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => bridge;
try {
  const preflight = await E.preflightPlan(plan);
  assert(preflight.preparedUpdates.size === 0,
    `stale REPLACE source must not reach preparedUpdates: ${preflight.preparedUpdates.size}`);
  assert(preflight.runtimeSkips.length === 1,
    `stale REPLACE source must become one runtime SKIP: ${preflight.runtimeSkips.length}`);
  assert(/проверить изменения/i.test(preflight.runtimeSkips[0].reason),
    `stale REPLACE source message must require re-check: ${preflight.runtimeSkips[0].reason}`);
} finally {
  E.TessaBridge.create = originalCreate;
}

console.log('TESSA Matrix Studio stale REPLACE source preflight regression: OK');
