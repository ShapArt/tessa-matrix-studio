import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = { body: { innerText: 'Завершить редактирование и разблокировать' }, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}) };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;

assert(typeof E.collectTouchedIdentities === 'function', 'collectTouchedIdentities export missing');
assert(typeof E.incrementalSafetyMode === 'function', 'incrementalSafetyMode export missing');
assert(typeof E.buildTargetedPreflightSnapshot === 'function', 'buildTargetedPreflightSnapshot export missing');

const structure = {
  templateId: 'touch-template',
  conditions: [{ criterionRowId: 'org', criterionName: 'Организация', operandTypeId: O.ReferenceGuid, refSection: 'GchPartners' }],
  functions: [{ id: 'sign', name: 'Подписание', typeName: 'Подписание' }],
};
function currentRow() {
  const flat = { 'criterion:org': ['Орг 1'], 'function:sign': ['Иванов И.И.'] };
  return {
    index: 0, rowCardId: 'card-1', versionId: 'version-1', fingerprint: E.fingerprintFlat(flat), flat,
    values: { org: [{ id: 'org-1', display: 'Орг 1', kind: 'ReferenceGuid' }] },
    roles: { sign: [{ id: 'person-1', display: 'Иванов И.И.', roleTypeId: 1 }] },
  };
}
const current = currentRow();
const updateDesired = {
  excelRow: 15,
  flat: { 'criterion:org': ['Орг 1'], 'function:sign': ['Петров П.П.'] },
  ids: { 'criterion:org': ['org-1'], 'function:sign': ['person-2|1'] },
  columns: new Map([
    ['org', { id: 'org', key: 'criterion:org', kind: 'criterion', operandTypeId: O.ReferenceGuid, idIndex: 2, excelHeader: 'Организация' }],
    ['sign', { id: 'sign', key: 'function:sign', kind: 'function', idIndex: 4, excelHeader: 'Подписание' }],
  ]),
  system: { action: 'keep', rowCardId: current.rowCardId, versionId: current.versionId, baseFingerprint: current.fingerprint },
  issues: [], fieldIssues: [], resolutions: [], hasData: true,
};
const updatePlan = {
  matrixId: 'matrix-touch', templateId: structure.templateId, safety: { blocked: false, blockedReasons: [] },
  actions: [{ type: 'update', excelRow: updateDesired, currentRow: current, expectedFingerprint: current.fingerprint, match: { matchedBy: 'identity' }, changes: [] }],
  skippedRows: [], skippedFields: [], warnings: [],
};
assert(E.incrementalSafetyMode(updatePlan) === 'update', E.incrementalSafetyMode(updatePlan));
const touched = E.collectTouchedIdentities(updatePlan);
assert(touched.rowCardIds.includes('card-1') && touched.versionIds.includes('version-1'), JSON.stringify(touched));

let fullSnapshotReads = 0;
let targetedCardGets = 0;
const bridge = {
  mainCard: { id: 'matrix-touch' },
  matrixInfo: () => ({ matrixId: 'matrix-touch', TemplateID: structure.templateId, StateName: 'Черновик' }),
  templateId: () => structure.templateId,
  requestStructure: async () => structure,
  loadSnapshot: async () => { fullSnapshotReads += 1; return { matrixId: 'matrix-touch', templateId: structure.templateId, rows: [current] }; },
  getCard: async cardId => { targetedCardGets += 1; assert(cardId === 'card-1', cardId); return { id: cardId }; },
  readMatrixRowFromCard: (_card, link) => ({ ...current, rowCardId: link.rowCardId, versionId: link.versionId }),
  resolveCriterion: (_def, display, id) => ({ id, display }),
  resolveRole: (_def, display, id) => ({ id, display, roleTypeId: 1 }),
  rebuildRowCard: () => {},
  validateDuplicate: async () => {},
};
const preflight = await E.preflightPlan(updatePlan, { bridge, structure, previewOnly: true });
assert(preflight.preparedUpdates.size === 1, `preparedUpdates=${preflight.preparedUpdates.size}`);
assert(fullSnapshotReads === 0, `update-only preflight performed ${fullSnapshotReads} full snapshot reads`);
assert(targetedCardGets >= 1, `update-only preflight did not target the touched card: ${targetedCardGets}`);
assert(preflight.incremental?.mode === 'update', JSON.stringify(preflight.incremental));
assert(preflight.incremental?.preflightRows === 1, JSON.stringify(preflight.incremental));

// Pure ADD must not read all existing matrix rows either.
const addDesired = {
  excelRow: 20,
  flat: { 'criterion:org': ['Орг 1'], 'function:sign': ['Петров П.П.'] },
  ids: { 'criterion:org': ['org-1'], 'function:sign': ['person-2|1'] },
  columns: updateDesired.columns,
  system: { action: 'add', rowCardId: '', versionId: '', baseFingerprint: '' },
  issues: [], fieldIssues: [], resolutions: [], hasData: true,
};
const addPlan = {
  matrixId: 'matrix-touch', templateId: structure.templateId, safety: { blocked: false, blockedReasons: [] },
  actions: [{ type: 'add', excelRow: addDesired, currentRow: null, expectedFingerprint: null, match: { matchedBy: 'new-row' }, changes: [] }],
  skippedRows: [], skippedFields: [], warnings: [],
};
const liveCatalog = {
  columnCatalogIds: { 'function:sign': 'roles' },
  catalogs: { roles: { sourceView: 'MtxRoles', entries: [{ id: 'person-2', display: 'Петров П.П.', roleTypeId: 1, source: 'MtxRoles' }] } },
};
fullSnapshotReads = 0;
const addBridge = {
  ...bridge,
  assertCanCreateRows: () => {},
  getCard: async () => { throw new Error('ADD-only must not CardGet unrelated rows'); },
  createRowCard: async () => ({ card: {}, cardId: 'new-card', versionId: 'new-version', newMethod: 'test' }),
};
const addPreflight = await E.preflightPlan(addPlan, { bridge: addBridge, structure, previewOnly: true, liveAddRoleCatalog: liveCatalog });
assert(addPreflight.preparedAdds.size === 1, `preparedAdds=${addPreflight.preparedAdds.size}`);
assert(fullSnapshotReads === 0, `add-only preflight performed ${fullSnapshotReads} full snapshot reads`);
assert(addPreflight.incremental?.mode === 'add-only', JSON.stringify(addPreflight.incremental));
assert(addPreflight.incremental?.preflightRows === 1, JSON.stringify(addPreflight.incremental));

console.log('TESSA Matrix Studio touched-only preflight: OK');
