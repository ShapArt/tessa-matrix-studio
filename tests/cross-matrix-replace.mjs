import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'), { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert.equal(typeof E.buildCrossMatrixReplacementPlan, 'function', 'buildCrossMatrixReplacementPlan must be exported');

const structure = {
  templateId: 'template-1',
  conditions: [{ criterionRowId: 'criterion-n', criterionName: 'Номер', operandTypeId: E.constants.OPERAND.Int }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};

function row(index, rowCardId, versionId, n, roleId, roleName) {
  const flat = {
    'criterion:criterion-n': [String(n)],
    'function:function-sign': [roleName],
  };
  return {
    index,
    rowCardId,
    versionId,
    values: { 'criterion-n': [{ kind: 'Int', value: n, display: String(n) }] },
    roles: { 'function-sign': [{ id: roleId, display: roleName, roleTypeId: 1 }] },
    flat,
    fingerprint: E.fingerprintFlat(flat),
  };
}

const sourceSnapshot = {
  matrixId: 'matrix-source',
  templateId: structure.templateId,
  rows: [
    row(0, 'source-card-1', 'source-version-1', 10, 'source-person-1', 'Источник Один'),
    row(1, 'source-card-2', 'source-version-2', 20, 'source-person-2', 'Источник Два'),
  ],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const sourceInfo = {
  matrixId: sourceSnapshot.matrixId,
  TemplateID: structure.templateId,
  TemplateName: 'Матрица ОРД',
  StateName: 'Черновик',
};
const bytes = await E.createRoundtripXlsxBytes(structure, sourceSnapshot, sourceInfo, null, { includeActions: true });
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const workbook = await E.readXlsxArrayBuffer(buffer, 'source-matrix.xlsx');
assert.equal(workbook.roundtrip.matrixId, 'matrix-source');

const targetSnapshot = {
  matrixId: 'matrix-target',
  templateId: structure.templateId,
  rows: [
    row(0, 'target-card-1', 'target-version-1', 100, 'target-person-1', 'Цель Один'),
    row(1, 'target-card-2', 'target-version-2', 200, 'target-person-2', 'Цель Два'),
  ],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const targetInfo = {
  matrixId: targetSnapshot.matrixId,
  TemplateID: structure.templateId,
  TemplateName: 'Матрица ОРД',
  StateName: 'Черновик',
};

const plan = E.buildPlan(workbook, structure, targetSnapshot, targetInfo);
assert.equal(plan.crossMatrixReplacement?.enabled, true, JSON.stringify(plan.crossMatrixReplacement));
assert.equal(plan.counts.update, 0, JSON.stringify(plan.counts));
assert.equal(plan.counts.add, 2, JSON.stringify(plan.counts));
assert.equal(plan.counts.delete, 2, JSON.stringify(plan.counts));
assert.equal(plan.counts.skip, 0, JSON.stringify(plan.skippedRows));

const additions = plan.actions.filter(action => action.type === 'add');
for (const action of additions) {
  assert.equal(action.currentRow, null, 'foreign source identity must never target an existing target row');
  assert.equal(action.excelRow.system.rowCardId, '', 'foreign RowID must be stripped');
  assert.equal(action.excelRow.system.versionId, '', 'foreign VersionID must be stripped');
  assert.equal(action.excelRow.system.baseFingerprint, '', 'foreign baseline fingerprint must be stripped');
  assert.equal(action.match?.matchedBy, 'cross-matrix-replace-add');
}
const deletionCards = new Set(plan.actions.filter(action => action.type === 'delete').map(action => action.currentRow?.rowCardId));
assert.deepEqual(deletionCards, new Set(['target-card-1', 'target-card-2']), 'only target-matrix identities may be DELETE targets');
assert(![...deletionCards].some(id => String(id).startsWith('source-')), 'source identities leaked into DELETE targets');

const bridge = {
  matrixInfo: () => targetInfo,
  localizeValue: value => value,
};
const safety = E.evaluatePlanSafety(plan, bridge);
assert.equal(safety.blocked, false, JSON.stringify(safety.blockedReasons));
assert.equal(safety.crossMatrixReplacement, true);

// A semantically identical target row is retained instead of delete+re-add.
const partiallySatisfied = {
  ...targetSnapshot,
  rows: [
    row(0, 'target-card-same', 'target-version-same', 10, 'source-person-1', 'Источник Один'),
    row(1, 'target-card-extra', 'target-version-extra', 999, 'target-person-x', 'Лишняя строка'),
  ],
};
const keepPlan = E.buildPlan(workbook, structure, partiallySatisfied, { ...targetInfo, matrixId: partiallySatisfied.matrixId });
assert.equal(keepPlan.crossMatrixReplacement?.enabled, true);
assert.equal(keepPlan.counts.noop, 1, JSON.stringify(keepPlan.counts));
assert.equal(keepPlan.counts.add, 1, JSON.stringify(keepPlan.counts));
assert.equal(keepPlan.counts.delete, 1, JSON.stringify(keepPlan.counts));
const kept = keepPlan.actions.find(action => action.type === 'noop');
assert.equal(kept.currentRow.rowCardId, 'target-card-same');
assert.equal(kept.match?.matchedBy, 'cross-matrix-replace-keep');

// Different template remains fail-closed.
const foreignTemplateWorkbook = {
  ...workbook,
  roundtrip: { ...workbook.roundtrip, templateId: 'other-template' },
};
const wrongPlan = E.buildPlan(foreignTemplateWorkbook, structure, targetSnapshot, targetInfo);
const wrongSafety = E.evaluatePlanSafety(wrongPlan, bridge);
assert.equal(wrongSafety.blocked, true, 'foreign template must remain blocked');
assert(wrongSafety.blockedReasons.some(reason => /другого шаблона/i.test(reason)), JSON.stringify(wrongSafety.blockedReasons));

console.log('TESSA Matrix Studio same-template cross-matrix replacement planner: OK');
