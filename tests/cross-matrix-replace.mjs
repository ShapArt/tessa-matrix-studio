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
const structure = {
  templateId: 'template-same',
  conditions: [{ criterionRowId: 'c', criterionName: 'Число', operandTypeId: E.constants.OPERAND.Int }],
  functions: [{ id: 'f', name: 'Исполнитель', typeName: 'Исполнитель' }],
};

function matrixRow(index, prefix, number, person) {
  const flat = { 'criterion:c': [String(number)], 'function:f': [person] };
  return {
    index,
    rowCardId: `${prefix}-card-${index}`,
    versionId: `${prefix}-version-${index}`,
    values: { c: [{ kind: 'Int', value: number, display: String(number) }] },
    roles: { f: [{ id: `${prefix}-person-${index}`, display: person, roleTypeId: 1 }] },
    flat,
    fingerprint: E.fingerprintFlat(flat),
  };
}

const sourceSnapshot = {
  matrixId: 'source-matrix',
  templateId: structure.templateId,
  previousVersionId: 'source-previous',
  rows: [
    matrixRow(0, 'source', 11, 'Источник А'),
    matrixRow(1, 'source', 22, 'Источник Б'),
  ],
};
const targetSnapshot = {
  matrixId: 'target-matrix',
  templateId: structure.templateId,
  previousVersionId: 'target-previous',
  rows: [
    matrixRow(0, 'target', 101, 'Цель А'),
    matrixRow(1, 'target', 202, 'Цель Б'),
  ],
};

const bytes = await E.createRoundtripXlsxBytes(
  structure,
  sourceSnapshot,
  { matrixId: sourceSnapshot.matrixId, TemplateID: structure.templateId, TemplateName: 'QA', StateName: 'Черновик' },
  null,
  { includeActions: true },
);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const workbook = await E.readXlsxArrayBuffer(buffer, 'source-matrix.xlsx');
assert.equal(workbook.roundtrip.matrixId, sourceSnapshot.matrixId, 'fixture must really belong to the source matrix');

const plan = E.buildPlan(workbook, structure, targetSnapshot);
assert.equal(plan.crossMatrixReplacement?.enabled, true, `foreign same-template workbook must enter replacement mode: ${JSON.stringify({ counts: plan.counts, skipped: plan.skippedRows, issues: plan.issues })}`);
assert.deepEqual(plan.counts, { noop: 0, update: 0, add: 2, delete: 2, skip: 0 }, `cross-matrix import must replace the target contents: ${JSON.stringify(plan.counts)}`);

const adds = plan.actions.filter(action => action.type === 'add');
assert.equal(adds.length, sourceSnapshot.rows.length);
for (const action of adds) {
  assert.equal(action.currentRow, null, 'source identity must never target a row in another matrix');
  assert.equal(action.excelRow.system.rowCardId, '', 'foreign MatrixRowID must be cleared before ADD');
  assert.equal(action.excelRow.system.versionId, '', 'foreign MatrixVersionID must be cleared before ADD');
  assert.equal(action.excelRow.system.baseFingerprint, '', 'foreign baseline fingerprint must be cleared before ADD');
  assert.equal(action.match?.matchedBy, 'cross-matrix-replace-add');
}

const deletes = plan.actions.filter(action => action.type === 'delete');
assert.deepEqual(
  deletes.map(action => action.currentRow.rowCardId).sort(),
  targetSnapshot.rows.map(row => row.rowCardId).sort(),
  'every current target row must be part of replacement DELETE set',
);
assert(deletes.every(action => action.match?.matchedBy === 'cross-matrix-replace-delete'));

const bridge = {
  matrixInfo: () => ({
    matrixId: targetSnapshot.matrixId,
    TemplateID: structure.templateId,
    PreviousVersionID: targetSnapshot.previousVersionId,
    TemplateName: 'QA',
    StateName: 'Черновик',
  }),
  localizeValue: value => value,
};
const safety = E.evaluatePlanSafety(plan, bridge);
assert.equal(safety.blocked, false, `same-template cross-matrix replacement must be reviewable/applicable: ${JSON.stringify(safety)}`);
assert.equal(safety.crossMatrixReplacement, true);
assert(plan.warnings.some(text => /режим замены/i.test(text)), `replacement must be explicit in Preview warnings: ${JSON.stringify(plan.warnings)}`);

// A workbook from a different template must remain fail-closed. Cross-matrix replacement
// is only a card-to-card transfer inside the same TESSA matrix template.
const wrongTemplateWorkbook = {
  ...workbook,
  roundtrip: { ...workbook.roundtrip, templateId: 'another-template' },
};
const wrongTemplatePlan = E.buildPlan(wrongTemplateWorkbook, structure, targetSnapshot);
const wrongTemplateSafety = E.evaluatePlanSafety(wrongTemplatePlan, bridge);
assert.equal(wrongTemplateSafety.blocked, true, 'different-template workbook must stay blocked');
assert(wrongTemplateSafety.blockedReasons.some(text => /другого шаблона/i.test(text)));

console.log('TESSA Matrix Studio cross-matrix same-template replacement: OK');
