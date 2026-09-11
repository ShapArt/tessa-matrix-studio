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
assert.equal(typeof E.evaluatePlanSafety, 'function');
assert.equal(typeof E.classifyWorkbookContext, 'function');

function roundtripPlan(matrixId, templateId, matrixName = 'Старое произвольное имя') {
  return {
    mode: 'roundtrip',
    actions: [],
    skippedRows: [],
    fatalIssues: [],
    sourceRowCount: 1,
    counts: { noop: 1, update: 0, add: 0, delete: 0, skip: 0 },
    columnMap: {
      dataHeaderCount: 1,
      columns: new Map([['criterion-a', { kind: 'criterion', id: 'criterion-a', name: 'Критерий' }]]),
    },
    workbook: {
      metadata: { 'Наименование матрицы': matrixName },
      roundtrip: { enabled: true, format: 'TESSA_MATRIX_ROUNDTRIP_V6', matrixId, templateId },
    },
  };
}

function bridge(matrixId, templateId, templateName = 'Совершенно другое отображаемое имя', previousVersionId = '') {
  return {
    matrixInfo: () => ({
      matrixId,
      TemplateID: templateId,
      TemplateName: templateName,
      PreviousVersionID: previousVersionId,
      StateName: 'Черновик',
    }),
  };
}

// Trusted Studio IDs are authoritative. A renamed template/matrix caption must never
// override exact MatrixID/TemplateID evidence.
{
  const plan = roundtripPlan('matrix-a', 'template-a');
  const safety = E.evaluatePlanSafety(plan, bridge('matrix-a', 'template-a'));
  assert.equal(safety.workbookContext.kind, 'same-matrix');
  assert.equal(safety.suppressUnsafePreview, false);
  assert.equal(safety.blocked, false, `trusted same-matrix IDs must beat display-name mismatch: ${safety.blockedReasons.join(' | ')}`);
}

// A deliberate cross-matrix transfer of the same template is also ID-driven. The
// source and target captions are allowed to differ because captions are not identity.
{
  const plan = roundtripPlan('matrix-source', 'template-a', 'Источник со старым названием');
  const safety = E.evaluatePlanSafety(plan, bridge('matrix-target', 'template-a', 'Цель с новым названием'));
  assert.equal(safety.workbookContext.kind, 'same-template-foreign-matrix');
  assert.equal(safety.crossMatrixReplacement, true);
  assert.equal(safety.suppressUnsafePreview, false);
  assert.equal(safety.blocked, false, `trusted same-template transfer must not be blocked by names: ${safety.blockedReasons.join(' | ')}`);
}

// Previous-version relation must remain explicit and must not be guessed by caption.
{
  const context = E.classifyWorkbookContext(
    roundtripPlan('matrix-prev', 'template-a').workbook,
    bridge('matrix-draft', 'template-a', 'Черновик', 'matrix-prev').matrixInfo(),
  );
  assert.equal(context.kind, 'previous-version');
  assert.equal(context.workbookMatrixId, 'matrix-prev');
  assert.equal(context.currentMatrixId, 'matrix-draft');
}

// Legacy files have no trusted MatrixID/TemplateID pair, so conservative name
// similarity remains a legitimate fallback guard there.
{
  const plan = roundtripPlan('', '');
  plan.mode = 'legacy';
  plan.workbook.roundtrip = { enabled: false };
  plan.columnMap.columns.set('function-a', { kind: 'function', id: 'function-a', name: 'Подписание' });
  plan.columnMap.dataHeaderCount = 2;
  const safety = E.evaluatePlanSafety(plan, bridge('matrix-a', 'template-a', 'Договоры'));
  assert.equal(safety.suppressUnsafePreview, true);
  assert.ok(safety.blockedReasons.some(reason => /Excel относится к матрице/.test(reason)), safety.blockedReasons.join(' | '));
}

console.log('TESSA Matrix Studio MatrixID/TemplateID authority over display-name heuristics: OK');
