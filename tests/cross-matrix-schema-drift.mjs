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

const sourceStructure = {
  templateId: 'template-drift',
  conditions: [{ criterionRowId: 'old-condition', criterionName: 'Старая колонка', operandTypeId: E.constants.OPERAND.String }],
  functions: [{ id: 'fn', name: 'Подписание', typeName: 'Подписание' }],
};
const flat = { 'criterion:old-condition': ['старое'], 'function:fn': ['Иванов И.И.'] };
const sourceSnapshot = {
  matrixId: 'source-drift', templateId: sourceStructure.templateId,
  rows: [{ index: 0, rowCardId: 'source-row', versionId: 'source-version', values: { 'old-condition': [{ kind: 'String', value: 'старое', display: 'старое' }] }, roles: { fn: [{ id: 'person-1', display: 'Иванов И.И.', roleTypeId: 1 }] }, flat, fingerprint: E.fingerprintFlat(flat) }],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const bytes = await E.createRoundtripXlsxBytes(sourceStructure, sourceSnapshot, { matrixId: 'source-drift', TemplateID: 'template-drift', TemplateName: 'ОРД', StateName: 'Черновик' }, null, { includeActions: true });
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const workbook = await E.readXlsxArrayBuffer(buffer, 'source-drift.xlsx');

const targetStructure = {
  templateId: 'template-drift',
  conditions: [{ criterionRowId: 'new-condition', criterionName: 'Новая колонка', operandTypeId: E.constants.OPERAND.String }],
  functions: [{ id: 'fn', name: 'Подписание', typeName: 'Подписание' }],
};
const targetSnapshot = {
  matrixId: 'target-drift', templateId: targetStructure.templateId, rows: [],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const targetInfo = { matrixId: 'target-drift', TemplateID: 'template-drift', TemplateName: 'ОРД', StateName: 'Черновик' };
const plan = E.buildPlan(workbook, targetStructure, targetSnapshot, targetInfo);
assert.equal(plan.crossMatrixReplacement?.enabled, true, JSON.stringify(plan.crossMatrixReplacement));
assert.equal(plan.counts.add, 1, JSON.stringify(plan.counts));
assert(plan.warnings.some(text => /удалён|больше отсутств|не применя/i.test(text)), JSON.stringify(plan.warnings));
assert(plan.warnings.some(text => /новые|пропущенные|отсутствуют в Excel/i.test(text)), JSON.stringify(plan.warnings));
assert(!plan.warnings.some(text => /сохранят текущие значения/i.test(text)), `replacement warning must not promise preservation: ${JSON.stringify(plan.warnings)}`);
assert(plan.warnings.some(text => /пуст|по умолчанию|новых строк/i.test(text)), `replacement warning must explain target-only fields: ${JSON.stringify(plan.warnings)}`);

console.log('TESSA Matrix Studio cross-matrix schema drift semantics: OK');
