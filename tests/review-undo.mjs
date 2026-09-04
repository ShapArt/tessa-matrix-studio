import fs from 'node:fs';
import vm from 'node:vm';

const scriptPath = new URL('../tessa-matrix-studio.user.js', import.meta.url);
const code = fs.readFileSync(scriptPath, 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.createPlanReviewState === 'function', 'createPlanReviewState is missing');
assert(typeof E.setPlanReviewChange === 'function', 'setPlanReviewChange is missing');
assert(typeof E.setPlanReviewRow === 'function', 'setPlanReviewRow is missing');
assert(typeof E.buildReviewedPlan === 'function', 'buildReviewedPlan is missing');

const orgColumn = {
  id: 'criterion-org',
  criterionRowId: 'criterion-org',
  criterionName: 'Организация ГЧ',
  kind: 'criterion',
  key: 'criterion:criterion-org',
  operandTypeId: E.constants.OPERAND.ReferenceGuid,
  excelHeader: 'Организация ГЧ',
};
const signerColumn = {
  id: 'function-sign',
  name: 'Подписание',
  kind: 'function',
  key: 'function:function-sign',
  excelHeader: 'Подписание',
};

function currentRow(index, rowCardId, versionId, orgId, org, signerId, signer, roleTypeId = 'role-type') {
  const flat = {
    [orgColumn.key]: [org],
    [signerColumn.key]: [signer],
  };
  return {
    index,
    rowCardId,
    versionId,
    fingerprint: E.fingerprintFlat(flat),
    flat,
    values: { 'criterion-org': [{ id: orgId, display: org }] },
    roles: { 'function-sign': [{ id: signerId, display: signer, roleTypeId }] },
  };
}

const current = currentRow(0, 'card-45', 'version-45', 'org-old', 'УРАЛЬСКАЯ МЯСНАЯ КОМПАНИЯ ООО', 'signer-old', 'Иванов И.И.');
const excelRow = {
  excelRow: 45,
  flat: {
    [orgColumn.key]: ['ООО "Черкизово-ИнфоТех"'],
    [signerColumn.key]: ['Петров П.П.'],
  },
  ids: {
    [orgColumn.key]: ['org-new'],
    [signerColumn.key]: ['signer-new|role-type'],
  },
  compare: {
    [orgColumn.key]: ['id:org-new'],
    [signerColumn.key]: ['id:signer-new|role-type'],
  },
  columns: new Map([
    ['criterion-org', orgColumn],
    ['function-sign', signerColumn],
  ]),
  system: { action: 'keep', rowCardId: current.rowCardId, versionId: current.versionId, baseFingerprint: current.fingerprint },
  hasData: true,
};
const update = {
  type: 'update',
  excelRow,
  currentRow: current,
  expectedFingerprint: current.fingerprint,
  match: { matchedBy: 'identity', lowConfidence: false },
  changes: [
    { key: orgColumn.key, label: 'Организация ГЧ', before: current.flat[orgColumn.key], after: excelRow.flat[orgColumn.key] },
    { key: signerColumn.key, label: 'Подписание', before: current.flat[signerColumn.key], after: excelRow.flat[signerColumn.key] },
  ],
};
const existingNoop = { type: 'noop', excelRow: { excelRow: 46 }, currentRow: null, changes: [] };
const plan = {
  id: 'review-qa',
  actions: [update, existingNoop],
  skippedRows: [],
  snapshot: { rows: [current] },
  counts: { update: 1, add: 0, delete: 0, noop: 1, skip: 0 },
  safety: { blocked: false, blockedReasons: [] },
};

// 1. Можно убрать только одно поле, оставив остальные изменения строки активными.
const review = E.createPlanReviewState();
E.setPlanReviewChange(review, update, orgColumn.key, true);
let reviewed = E.buildReviewedPlan(plan, review);
let effective = reviewed.actions[0];
assert(effective.type === 'update', `one remaining field must keep UPDATE, got ${effective.type}`);
assert(effective.changes.length === 1 && effective.changes[0].key === signerColumn.key,
  `only signer change should remain: ${JSON.stringify(effective.changes)}`);
assert(effective.excelRow.flat[orgColumn.key]?.[0] === current.flat[orgColumn.key][0],
  'excluded organization must be restored to current TESSA value in effective Apply row');
assert(effective.excelRow.ids[orgColumn.key]?.[0] === 'org-old',
  `excluded reference ID must be restored too: ${JSON.stringify(effective.excelRow.ids[orgColumn.key])}`);
assert(effective.excelRow.flat[signerColumn.key]?.[0] === 'Петров П.П.', 'non-excluded signer must remain edited');
assert(reviewed.counts.update === 1 && reviewed.counts.noop === 1,
  `counters after one field exclusion are wrong: ${JSON.stringify(reviewed.counts)}`);
assert(update.excelRow.flat[orgColumn.key][0] === 'ООО "Черкизово-ИнфоТех"', 'base plan must stay immutable');
assert(update.changes.length === 2, 'base action changes must stay immutable');

// 2. Если исключить все изменения строки, она становится NOOP и счётчики пересчитываются.
E.setPlanReviewChange(review, update, signerColumn.key, true);
reviewed = E.buildReviewedPlan(plan, review);
effective = reviewed.actions[0];
assert(effective.type === 'noop', `all excluded fields must turn row into NOOP, got ${effective.type}`);
assert(reviewed.counts.update === 0 && reviewed.counts.noop === 2,
  `counters after all field exclusions are wrong: ${JSON.stringify(reviewed.counts)}`);

// 3. Отмена всей строки и «Вернуть все» — полностью обратимы.
E.setPlanReviewRow(review, update, true);
reviewed = E.buildReviewedPlan(plan, review);
assert(reviewed.actions[0].type === 'noop', 'row-level exclusion must suppress the whole UPDATE');
E.setPlanReviewRow(review, update, false);
reviewed = E.buildReviewedPlan(plan, review);
assert(reviewed.actions[0].type === 'update' && reviewed.actions[0].changes.length === 2,
  'restore-all must restore every original change in the row');
assert(reviewed.counts.update === 1 && reviewed.counts.noop === 1,
  `restore-all counters are wrong: ${JSON.stringify(reviewed.counts)}`);

// 4. Частичная отмена, которая собирает дубль, должна локально пропустить эту строку,
// а не превращать весь пакет в глобально небезопасный. Если других операций нет,
// Apply просто нечего выполнять; возврат review-состояния снова делает UPDATE доступным.
const duplicateTarget = currentRow(1, 'card-46', 'version-46', 'org-old', 'УРАЛЬСКАЯ МЯСНАЯ КОМПАНИЯ ООО', 'signer-new', 'Петров П.П.');
const duplicatePlan = {
  ...plan,
  snapshot: { rows: [current, duplicateTarget] },
  actions: [update],
  counts: { update: 1, add: 0, delete: 0, noop: 0, skip: 0 },
};
const duplicateReview = E.createPlanReviewState();
E.setPlanReviewChange(duplicateReview, update, orgColumn.key, true);
const duplicateReviewed = E.buildReviewedPlan(duplicatePlan, duplicateReview);
assert(duplicateReviewed.safety?.blocked === false,
  `review-created duplicate must stay row-local: ${JSON.stringify(duplicateReviewed.safety)}`);
assert(duplicateReviewed.actions.length === 0,
  `review-created duplicate must remove the conflicting mutation: ${JSON.stringify(duplicateReviewed.actions)}`);
assert(duplicateReviewed.skippedRows.some(item => item.excelRow === 45 && item.source === 'duplicate-validation'),
  `review-created duplicate needs a row-local skip reason: ${JSON.stringify(duplicateReviewed.skippedRows)}`);
assert(duplicateReviewed.counts.update === 0 && duplicateReviewed.counts.skip === 1,
  `review-created duplicate counters are wrong: ${JSON.stringify(duplicateReviewed.counts)}`);

console.log('TESSA Matrix Studio selective review undo tests: OK');
