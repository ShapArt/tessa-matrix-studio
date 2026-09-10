import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.example.test' };
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source);
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

function makePlan(templateId = 'template-a') {
  return {
    mode: 'roundtrip',
    workbook: {
      roundtrip: {
        enabled: true,
        format: E.constants.ROUNDTRIP.Format,
        matrixId: 'source-matrix',
        templateId,
      },
      matrixName: 'ОРД-основная',
    },
    columnMap: {
      dataHeaderCount: 1,
      columns: new Map([['field', { key: 'criterion:field', kind: 'criterion' }]]),
    },
    fatalIssues: [],
    counts: { noop: 0, update: 0, add: 476, delete: 19, skip: 0 },
    actions: [{ type: 'add', excelRow: { excelRow: 15 } }, { type: 'delete', current: { versionId: 'v1' } }],
    skippedRows: [],
  };
}

const activeBridge = {
  matrixInfo: () => ({
    matrixId: 'target-matrix',
    TemplateID: 'template-a',
    TemplateName: 'ОРД-основная',
    StateName: 'Активная',
    PreviousVersionID: 'previous-matrix',
  }),
  localizeValue: value => value,
};

{
  const plan = makePlan();
  const safety = E.evaluatePlanSafety(plan, activeBridge);
  assert.equal(safety.blocked, true, 'Active matrix must remain write-blocked');
  assert.match(safety.blockedReasons.join('\n'), /Активная/);
  assert.equal(safety.suppressUnsafePreview, false, 'Read-only preview must remain visible when the only blocker is matrix state');
}

{
  const plan = makePlan('foreign-template');
  const safety = E.evaluatePlanSafety(plan, activeBridge);
  assert.equal(safety.blocked, true);
  assert.equal(safety.suppressUnsafePreview, true, 'Foreign template must still suppress unsafe candidate actions');
}

console.log('TESSA Matrix Studio Active matrix: visible read-only preview + blocked Apply contract: OK');
