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
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;
const structure = {
  templateId: 'cross-matrix-live-role-template',
  conditions: [{
    criterionRowId: 'criterion-org',
    criterionName: 'Организация',
    operandTypeId: O.ReferenceGuid,
    autocompleteViewName: 'Organizations',
    refSection: 'Organizations',
  }],
  functions: [{ id: 'function-info', name: 'Для сведения', typeName: 'Для сведения' }],
};

function row(index, card, version, orgId, org, personId, person) {
  const flat = {
    'criterion:criterion-org': [org],
    'function:function-info': [person],
  };
  return {
    index,
    rowCardId: card,
    versionId: version,
    fingerprint: E.fingerprintFlat(flat),
    flat,
    values: { 'criterion-org': [{ id: orgId, display: org }] },
    roles: { 'function-info': [{ id: personId, display: person, roleTypeId: 1 }] },
  };
}

// Mirrors the live failure: a foreign workbook contains a once-valid employee RoleID,
// while the current target TESSA MtxRoles no longer exposes that identity. The database
// rejects such a new row with FK MtxRouteMatrixRowVersionRoles -> Roles.
const staleRoleId = '987453d3-3824-409c-8ffc-b2cc8dae6889';
const source = {
  matrixId: 'matrix-source-role-preflight',
  templateId: structure.templateId,
  rows: [row(0, 'source-card', 'source-version', 'org-a', 'Компания А', staleRoleId, 'Гребенюк Е.А.')],
  criterionIdCache: new Map(),
  roleIdByFunctionCache: new Map(),
  roleIdCache: new Map(),
};
const targetRow = row(0, 'target-card', 'target-version', 'org-b', 'Компания Б', 'current-person-id', 'Текущий сотрудник');
const target = {
  matrixId: 'matrix-target-role-preflight',
  templateId: structure.templateId,
  rows: [targetRow],
  criterionIdCache: new Map(),
  roleIdByFunctionCache: new Map(),
  roleIdCache: new Map(),
};
const sourceInfo = {
  matrixId: source.matrixId,
  TemplateID: structure.templateId,
  TemplateName: 'ROLE PREFLIGHT QA',
  Name: 'Источник',
  StateName: 'Черновик',
};
const targetInfo = {
  matrixId: target.matrixId,
  TemplateID: structure.templateId,
  TemplateName: 'ROLE PREFLIGHT QA',
  Name: 'Цель',
  StateName: 'Черновик',
};

// The exported source workbook legitimately preserves its historical snapshot identity.
const sourceCatalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, source);
const bytes = await E.createRoundtripXlsxBytes(structure, source, sourceInfo, sourceCatalog);
const workbook = await E.readXlsxArrayBuffer(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  'foreign-role-preflight.xlsx',
);
const plan = E.buildPlan(workbook, structure, target, targetInfo);
assert(plan.crossMatrixReplacement?.enabled && plan.counts.add === 1 && plan.counts.delete === 1,
  `expected 1 ADD + 1 DELETE cross-matrix plan: ${JSON.stringify(plan.counts)}`);

const liveCatalogId = 'roles:MtxRoles:function:function-info';
const liveTargetCatalog = {
  version: 1,
  catalogs: {
    [liveCatalogId]: {
      id: liveCatalogId,
      label: 'Для сведения · роли и пользователи TESSA',
      sourceView: 'MtxRoles',
      entries: [{
        id: 'current-person-id',
        display: 'Текущий сотрудник',
        selector: 'Текущий сотрудник',
        roleTypeId: 1,
        source: 'MtxRoles',
        status: 'Доступно',
      }],
    },
  },
  columnCatalogIds: { 'function:function-info': liveCatalogId },
  stats: { entries: 1, errors: [], warnings: [], cache: {} },
};

let stores = 0;
const deletes = [];
let liveCatalogLoads = 0;
const bridge = {
  matrixInfo: () => targetInfo,
  templateId: () => structure.templateId,
  requestStructure: async () => structure,
  loadSnapshot: async () => target,
  loadDictionaryCatalog: async (_structure, _snapshot, options = {}) => {
    liveCatalogLoads += 1;
    assert(options.forceRefresh === true, 'Apply must validate ADD roles against a freshly loaded target catalog');
    return liveTargetCatalog;
  },
  resolveReferenceOnline: async () => null,
  resolveCriterion: (condition, display, id) => ({ id, display }),
  // Existing resolver behavior deliberately trusts an explicit workbook ID. The new
  // preflight must catch the stale identity before this can reach Store.
  resolveRole: (_fn, display, id) => {
    const [roleId, roleTypeId] = String(id || '').split('|');
    return { id: roleId, display, roleTypeId: Number(roleTypeId || 1) };
  },
  assertCanCreateRows: () => {},
  createRowCard: async () => ({
    card: { id: 'new-card', version: 0 },
    cardId: 'new-card',
    versionId: 'new-version',
    newMethod: 'CardNew',
  }),
  rebuildRowCard: () => {},
  validateDuplicate: async () => {},
  storeRowCard: async () => {
    stores += 1;
    throw new Error('BUG: stale RoleID reached Store and would fail fk_MtxRouteMatrixRowVersionRoles_Roles_Role');
  },
  tryGetCard: async () => ({ card: { id: 'new-card', version: 1 } }),
  getCard: async cardId => ({ id: cardId }),
  readMatrixRowFromCard: (_card, current) => current?.source === 'targeted-delete-recheck' ? targetRow : null,
  deleteMatrixRow: async versionId => { deletes.push(versionId); },
  saveMainMatrixAfterApply: async () => ({ ok: true }),
  refreshNativeMatrixView: async () => ({ ok: true }),
};

const originalCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => bridge;
try {
  const result = await E.applyPlan(plan);
  assert(liveCatalogLoads >= 1, 'cross-matrix ADD preflight must load the current target role catalog');
  assert(stores === 0, `stale foreign RoleID must be rejected before Store, got Store=${stores}`);
  assert(deletes.length === 0, `stale role preflight must prevent all target deletes, got ${JSON.stringify(deletes)}`);
  assert(result.crossMatrixTransfer?.status === 'preflight-blocked',
    `stale role must block the whole transfer before mutation: ${JSON.stringify(result.crossMatrixTransfer)}`);
  const details = JSON.stringify(result);
  assert(details.includes('Гребенюк Е.А.') || details.includes(staleRoleId),
    `result must identify the unavailable role: ${details}`);
} finally {
  E.TessaBridge.create = originalCreate;
}

console.log('TESSA Matrix Studio cross-matrix live RoleID preflight: OK');
