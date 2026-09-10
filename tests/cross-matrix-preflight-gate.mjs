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
  templateId: 'cross-matrix-preflight-template',
  conditions: [{ criterionRowId: 'criterion-org', criterionName: 'Организация', operandTypeId: O.ReferenceGuid, autocompleteViewName: 'Organizations', refSection: 'Organizations' }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};
function row(index, card, version, orgId, org, personId, person) {
  const flat = { 'criterion:criterion-org': [org], 'function:function-sign': [person] };
  return {
    index, rowCardId: card, versionId: version, fingerprint: E.fingerprintFlat(flat), flat,
    values: { 'criterion-org': [{ id: orgId, display: org }] },
    roles: { 'function-sign': [{ id: personId, display: person, roleTypeId: 'role-type' }] },
  };
}
const source = {
  matrixId: 'matrix-source-preflight', templateId: structure.templateId,
  rows: [row(0, 'source-card', 'source-version', 'org-a', 'Компания А', 'person-a', 'Иванов И.И.')],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const targetRow = row(0, 'target-card', 'target-version', 'org-b', 'Компания Б', 'person-b', 'Петров П.П.');
const target = {
  matrixId: 'matrix-target-preflight', templateId: structure.templateId, rows: [targetRow],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const sourceInfo = { matrixId: source.matrixId, TemplateID: structure.templateId, TemplateName: 'PREFLIGHT QA', Name: 'Источник', StateName: 'Черновик' };
const targetInfo = { matrixId: target.matrixId, TemplateID: structure.templateId, TemplateName: 'PREFLIGHT QA', Name: 'Цель', StateName: 'Черновик' };
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, source);
const bytes = await E.createRoundtripXlsxBytes(structure, source, sourceInfo, catalog);
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'source-preflight.xlsx');
const plan = E.buildPlan(workbook, structure, target, targetInfo);
assert(plan.crossMatrixReplacement?.enabled && plan.counts.add === 1 && plan.counts.delete === 1,
  `expected transfer plan 1 ADD + 1 DELETE: ${JSON.stringify(plan.counts)}`);

let stores = 0;
const deletes = [];
const bridge = {
  matrixInfo: () => targetInfo,
  templateId: () => structure.templateId,
  requestStructure: async () => structure,
  loadSnapshot: async () => target,
  resolveReferenceOnline: async () => null,
  resolveCriterion: (condition, display, id) => ({ id, display }),
  resolveRole: (fn, display, id) => ({ id, display, roleTypeId: 'role-type' }),
  assertCanCreateRows: () => {},
  createRowCard: async () => ({ card: { id: 'new-card', version: 0 }, cardId: 'new-card', versionId: 'new-version', newMethod: 'CardNew' }),
  rebuildRowCard: () => {},
  validateDuplicate: async () => { throw new Error('simulated ADD preflight rejection'); },
  storeRowCard: async () => { stores += 1; return { cardId: 'new-card', cardVersion: 1 }; },
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
  assert(stores === 0, `preflight rejection must prevent all Store calls, got ${stores}`);
  assert(deletes.length === 0, `preflight rejection must prevent all DeleteRow calls, got ${JSON.stringify(deletes)}`);
  assert(result.crossMatrixTransfer?.status === 'preflight-blocked',
    `preflight rejection must be explicit: ${JSON.stringify(result.crossMatrixTransfer)}`);
  assert(result.startedCount === 0 && result.appliedCount === 0,
    `preflight-blocked transfer must have zero started/applied writes: ${JSON.stringify({ started: result.startedCount, applied: result.appliedCount })}`);

  // Live 1.13.0 regression: Preview preflight removed 470 rejected ADDs from the
  // replacement plan but left 5 ADD + 19 DELETE executable. A replacement is a
  // desired-final-state operation; any source-row/preflight rejection must make the
  // whole transfer non-applicable instead of silently shrinking the desired state.
  const addAction = plan.actions.find(action => action.type === 'add');
  const sourceSkip = E.makeSkippedRow(488, 'Excel 488: после изменений не останется исполнителей.', 'role-validation', 'add');
  const runtimeSkip = E.makeSkippedRow(addAction.excelRow.excelRow,
    'Роль «Иванов И.И.» недоступна в актуальном MtxRoles текущей TESSA.', 'preflight-add', 'add');
  const previewSource = {
    ...plan,
    safety: { blocked: false, blockedReasons: [], suppressUnsafePreview: false },
    skippedRows: [sourceSkip],
  };
  previewSource.counts = E.countActions(previewSource.actions, previewSource.skippedRows);
  const preview = E.applyPreflightPreview(previewSource, {
    runtimeSkippedActions: new Set([addAction]),
    runtimeSkips: [runtimeSkip],
    previewPolicy: { applyBlocked: false, skipServerAddValidation: false, reason: null },
  });
  assert(preview.crossMatrixReplacement?.enabled, 'fixture must remain a cross-matrix replacement');
  assert(preview.safety?.blocked === true,
    `incomplete replacement preview must be blocked: ${JSON.stringify(preview.safety)}`);
  assert(preview.preflightPreview?.atomicReplacementBlocked === true,
    `preview must expose atomic replacement blocker: ${JSON.stringify(preview.preflightPreview)}`);
  assert(E.applyAvailability(preview).canApply === false,
    `blocked replacement must not expose Apply: ${JSON.stringify(E.applyAvailability(preview))}`);
  assert((preview.safety?.blockedReasons || []).some(reason => /перенос.*непол|строк.*не.*перенес/i.test(reason)),
    `blocker must explain incomplete transfer: ${JSON.stringify(preview.safety?.blockedReasons)}`);

  // Defense in depth: even if a caller bypasses Preview and sends a replacement plan
  // that already contains source skips, applyPlan itself must refuse before CardStore
  // or DeleteRow. This prevents future UI refactors from reopening the same class of bug.
  stores = 0;
  deletes.length = 0;
  bridge.validateDuplicate = async () => {};
  const incompleteDirectPlan = {
    ...plan,
    safety: { blocked: false, blockedReasons: [], suppressUnsafePreview: false },
    skippedRows: [sourceSkip],
  };
  incompleteDirectPlan.counts = E.countActions(incompleteDirectPlan.actions, incompleteDirectPlan.skippedRows);
  let directError = null;
  try {
    await E.applyPlan(incompleteDirectPlan);
  } catch (error) {
    directError = error;
  }
  assert(directError, 'incomplete replacement must be rejected before write');
  assert(/перенос|замен/i.test(String(directError?.message || directError)),
    `direct blocker must explain replacement integrity: ${directError?.message || directError}`);
  assert(stores === 0, `source skip must prevent all Store calls, got ${stores}`);
  assert(deletes.length === 0, `source skip must prevent all DeleteRow calls, got ${JSON.stringify(deletes)}`);
} finally {
  E.TessaBridge.create = originalCreate;
}

console.log('TESSA Matrix Studio cross-matrix preflight all-or-nothing gate: OK');
