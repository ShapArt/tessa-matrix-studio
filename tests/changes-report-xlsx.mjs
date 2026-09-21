import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { applyChangesReportFullRow } from '../hotfixes/v1.14.1-changes-report-full-row.mjs';

const baseCode = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const code = applyChangesReportFullRow(baseCode);
assert.ok(code.includes('REVIEWED_CHANGES_REPORT_V3'), 'v1.14.1 Russian changes-report marker missing');
assert.ok(!code.includes('Детали изменений'), 'changes workbook must contain only one visible report sheet');
assert.equal(applyChangesReportFullRow(code), code, 'changes-report transform must be idempotent for release composition');

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert.equal(typeof E.createChangesReportXlsxBytes, 'function', 'createChangesReportXlsxBytes export missing');
assert.equal(typeof E.buildChangesReportModel, 'function', 'buildChangesReportModel export missing');

const structure = {
  templateId: 'changes-template',
  conditions: [{ criterionRowId: 'org', criterionName: 'Организация', operandTypeId: E.constants.OPERAND.ReferenceGuid }],
  functions: [{ id: 'sign', name: 'Подписание', typeName: 'Подписание' }],
};
const plan = {
  matrixId: 'changes-matrix', templateId: structure.templateId,
  actions: [
    { type: 'noop', excelRow: { excelRow: 14 }, currentRow: { index: 0 }, changes: [] },
    { type: 'update', excelRow: { excelRow: 15 }, currentRow: { index: 1 }, changes: [
      { key: 'criterion:org', label: 'Организация', before: ['Орг А'], after: ['Орг Б'] },
      { key: 'function:sign', label: 'Подписание', before: ['Иванов И.И. — Руководитель'], after: ['Петров П.П. — Директор'] },
    ] },
    { type: 'add', excelRow: {
      excelRow: 16,
      flat: {
        'criterion:org': ['Орг В'],
        'function:sign': ['Сидоров С.С. — Руководитель склада'],
      },
    }, currentRow: null, changes: [
      { key: 'criterion:org', label: 'Организация', before: [], after: ['Орг В'] },
    ] },
    { type: 'delete', excelRow: null, currentRow: {
      index: 3,
      flat: {
        'criterion:org': ['Орг Г'],
        'function:sign': ['Удаляемый У.У. — Специалист'],
      },
    }, changes: [
      { key: 'criterion:org', label: 'Организация', before: ['Орг Г'], after: [] },
    ] },
  ],
  skippedRows: [
    { excelRow: 19, reason: 'Исполнитель не найден в справочнике.', code: 'dictionary-not-found', phase: 'planner', actionType: 'add' },
  ],
  skippedFields: [
    { excelRow: 20, key: 'criterion:org', label: 'Организация', reason: 'Поле оставлено без изменения из-за формулы Excel.' },
  ],
  skippedValues: [
    { excelRow: 21, key: 'function:sign', label: 'Подписание', value: 'НЕИЗВЕСТНЫЙ СОТРУДНИК', reason: 'Значение не найдено в MtxRoles.' },
  ],
  warnings: [], safety: { blocked: false, blockedReasons: [] },
};

const model = E.buildChangesReportModel(plan, structure);
assert.deepEqual(
  model.detailHeaders,
  ['Действие', 'Строка Excel', 'Строка TESSA', 'Поле', 'Было', 'Стало'],
  'the human report must be fully Russian and must not waste a separate reason column'
);
assert.equal(model.detailHeaders.includes('Причина'), false, 'reason must not be a dedicated Excel column');
assert.deepEqual(model.operations.map(row => row.change), ['Изменена', 'Добавлена', 'Удалена', 'Пропущена', 'Пропущено поле', 'Пропущено значение']);
assert.ok(!model.operations.some(row => /^(KEEP|NOOP|UPDATE|ADD|DELETE|SKIP)$/.test(row.change)), 'technical action labels must never appear in the human report');
assert.ok(model.details.some(row => row.change === 'Изменена' && row.field === 'Организация' && row.before === 'Орг А' && row.after === 'Орг Б'));
assert.ok(model.details.some(row => row.change === 'Изменена' && row.field === 'Подписание' && /Иванов/.test(row.before) && /Петров/.test(row.after)));
assert.ok(model.details.some(row => row.change === 'Добавлена' && row.field === 'Организация' && row.before === '—' && row.after === 'Орг В'), JSON.stringify(model.details));
assert.ok(model.details.some(row => row.change === 'Добавлена' && row.field === 'Подписание' && row.before === '—' && /Сидоров/.test(row.after)), 'Добавлена must include the full new row');
assert.ok(model.details.some(row => row.change === 'Удалена' && row.field === 'Организация' && row.before === 'Орг Г' && row.after === '—'), JSON.stringify(model.details));
assert.ok(model.details.some(row => row.change === 'Удалена' && row.field === 'Подписание' && /Удаляемый/.test(row.before) && row.after === '—'), 'Удалена must include the full removed row');
assert.ok(model.details.some(row => row.change === 'Пропущена' && row.field === 'Причина пропуска' && /Исполнитель/.test(row.after)), 'skip reason must stay visible as ordinary report data');
assert.ok(model.details.some(row => row.change === 'Пропущено поле' && row.field === 'Организация' && /формул/i.test(row.after)), 'skipped field must remain visible in the human report');
assert.ok(model.details.some(row => row.change === 'Пропущено значение' && row.field === 'Подписание' && /НЕИЗВЕСТНЫЙ/.test(row.before) && /MtxRoles/.test(row.after)), 'skipped individual value must remain visible in the human report');
assert.equal(model.reportOnly, true);
assert.equal(model.format, 'TESSA_MATRIX_CHANGES_REPORT_V3');

const bytes = await E.createChangesReportXlsxBytes(plan, structure);
assert.ok(bytes instanceof Uint8Array && bytes.length > 1000, `unexpected report XLSX size ${bytes?.length}`);
let rejected = false;
try {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await E.readXlsxArrayBuffer(buffer, 'changes-report.xlsx');
} catch (error) {
  rejected = /отч[её]т|report.?only|только.*просмотр/i.test(String(error?.message || error));
}
assert.equal(rejected, true, 'report-only workbook must be rejected as an Apply source');

console.log('TESSA Matrix Studio Russian self-contained reviewed changes XLSX: OK');
