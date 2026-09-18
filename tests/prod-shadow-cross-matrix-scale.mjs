import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;

// Production-shadow dimensions observed in the colleague workbook:
// 488 source rows, 103 target rows, 14 criteria + 9 functions in the source shape,
// plus schema drift (2 retired source criteria / 4 target-only criteria).
const TEMPLATE = 'prod-shadow-template';
const commonConditions = Array.from({ length: 12 }, (_, index) => ({
  criterionRowId: `common-${index}`,
  criterionName: `Общее поле ${index + 1}`,
  operandTypeId: O.String,
}));
const retiredConditions = Array.from({ length: 2 }, (_, index) => ({
  criterionRowId: `retired-${index}`,
  criterionName: `Старое поле ${index + 1}`,
  operandTypeId: O.String,
}));
const targetOnlyConditions = Array.from({ length: 4 }, (_, index) => ({
  criterionRowId: `target-only-${index}`,
  criterionName: `Новое поле ${index + 1}`,
  operandTypeId: O.String,
}));
const functions = Array.from({ length: 9 }, (_, index) => ({
  id: `fn-${index}`,
  name: `Функция ${index + 1}`,
  typeName: 'Исполнитель',
}));

const sourceStructure = {
  templateId: TEMPLATE,
  conditions: [...commonConditions, ...retiredConditions],
  functions,
};
const targetStructure = {
  templateId: TEMPLATE,
  conditions: [...commonConditions, ...targetOnlyConditions],
  functions,
};

function makeRow(prefix, index, structure) {
  const flat = {};
  const values = {};
  const roles = {};

  for (const condition of structure.conditions) {
    const display = `${prefix}-${index}-${condition.criterionRowId}`;
    flat[`criterion:${condition.criterionRowId}`] = [display];
    values[condition.criterionRowId] = [{ kind: 'String', value: display, display }];
  }
  for (let fnIndex = 0; fnIndex < structure.functions.length; fnIndex += 1) {
    const fn = structure.functions[fnIndex];
    const roleIndex = index % 40;
    const roleId = `${prefix}-role-${fnIndex}-${roleIndex}`;
    const display = `${prefix} сотрудник ${fnIndex}-${roleIndex}`;
    flat[`function:${fn.id}`] = [display];
    roles[fn.id] = [{ id: roleId, display, roleTypeId: 1 }];
  }

  return {
    index,
    rowCardId: `${prefix}-card-${index}`,
    versionId: `${prefix}-version-${index}`,
    fingerprint: E.fingerprintFlat(flat),
    values,
    roles,
    flat,
  };
}

function makeSnapshot(prefix, size, structure) {
  return {
    matrixId: `${prefix}-matrix`,
    templateId: TEMPLATE,
    rows: Array.from({ length: size }, (_, index) => makeRow(prefix, index, structure)),
    criterionIdCache: new Map(),
    roleIdByFunctionCache: new Map(),
    roleIdCache: new Map(),
  };
}

const source = makeSnapshot('source', 488, sourceStructure);
const target = makeSnapshot('target', 103, targetStructure);
const sourceInfo = {
  matrixId: source.matrixId,
  TemplateID: TEMPLATE,
  TemplateName: 'PROD SHADOW',
  StateName: 'Черновик',
};
const targetInfo = {
  matrixId: target.matrixId,
  TemplateID: TEMPLATE,
  TemplateName: 'PROD SHADOW',
  StateName: 'Черновик',
};

const started = performance.now();
const sourceCatalog = E.mergeSnapshotIntoDictionaryCatalog(null, sourceStructure, source);
const bytes = await E.createRoundtripXlsxBytes(sourceStructure, source, sourceInfo, sourceCatalog, { includeActions: true });
assert(bytes.byteLength < 32 * 1024 * 1024, `production-shadow workbook exceeded XLSX ceiling: ${bytes.byteLength}`);

const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const workbook = await E.readXlsxArrayBuffer(buffer, 'prod-shadow-source.xlsx');
assert.equal(workbook.rows.length, 488, 'source row cardinality drifted');

const plan = E.buildPlan(workbook, targetStructure, target, targetInfo);
assert.equal(plan.crossMatrixReplacement?.enabled, true, JSON.stringify(plan.crossMatrixReplacement));
assert.deepEqual(plan.counts, { noop: 0, update: 0, add: 488, delete: 103, skip: 0 },
  `production-shadow cross-matrix counts drifted: ${JSON.stringify(plan.counts)}`);
assert(plan.warnings.some(text => /удалён|больше отсутств|не применя/i.test(text)),
  `retired-column warning missing: ${JSON.stringify(plan.warnings)}`);
assert(plan.warnings.some(text => /новые|пропущенные|отсутствуют в Excel/i.test(text)),
  `target-only-column warning missing: ${JSON.stringify(plan.warnings)}`);

const additions = plan.actions.filter(action => action.type === 'add');
assert.equal(additions.length, 488);
for (const action of additions) {
  assert.equal(action.match?.matchedBy, 'cross-matrix-replace-add');
  assert.equal(action.excelRow?.system?.rowCardId, '', 'foreign RowID leaked into ADD');
  assert.equal(action.excelRow?.system?.versionId, '', 'foreign VersionID leaked into ADD');
  assert.equal(action.excelRow?.system?.baseFingerprint, '', 'foreign fingerprint leaked into ADD');
}
const deletions = plan.actions.filter(action => action.type === 'delete');
assert.equal(deletions.length, 103);
assert(deletions.every(action => String(action.currentRow?.rowCardId || '').startsWith('target-card-')),
  'DELETE target escaped the target matrix');

const bridge = { matrixInfo: () => targetInfo, localizeValue: value => value };
const safety = E.evaluatePlanSafety(plan, bridge);
assert.equal(safety.blocked, false, `valid complete replacement blocked: ${JSON.stringify(safety.blockedReasons)}`);
assert.equal(safety.deleteGuard?.blocked, false, `complete cross-matrix replacement hit delete guard: ${JSON.stringify(safety.deleteGuard)}`);
assert.equal(E.evaluateApplyBatch(plan.actions).blocked, false, '591-operation production-shadow package must stay below Apply ceiling');

const profile = E.productionShadowProfile({ ...plan, safety });
assert.equal(profile.sourceRows, 488);
assert.equal(profile.targetRows, 103);
assert.equal(profile.context.kind, 'same-template-foreign-matrix');
assert.equal(profile.context.crossMatrixReplacement, true);
assert.equal(profile.structure.retiredColumns, 2);
assert.equal(profile.structure.targetOnlyColumns, 4);

console.log(`TESSA Matrix Studio production-shadow cross-matrix scale: OK rows=488->103 ops=591 bytes=${bytes.byteLength} ms=${Math.round(performance.now()-started)}`);
