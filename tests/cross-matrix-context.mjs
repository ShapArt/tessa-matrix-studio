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
assert.equal(typeof E.classifyWorkbookContext, 'function', 'classifyWorkbookContext must be exported');

const same = E.classifyWorkbookContext(
  { roundtrip: { enabled: true, matrixId: 'm-target', templateId: 't' } },
  { matrixId: 'm-target', PreviousVersionID: 'm-prev', TemplateID: 't' },
);
assert.equal(same.kind, 'same-matrix');

const previous = E.classifyWorkbookContext(
  { roundtrip: { enabled: true, matrixId: 'm-prev', templateId: 't' } },
  { matrixId: 'm-target', PreviousVersionID: 'm-prev', TemplateID: 't' },
);
assert.equal(previous.kind, 'previous-version');

const foreignSameTemplate = E.classifyWorkbookContext(
  { roundtrip: { enabled: true, matrixId: 'm-source', templateId: 't' } },
  { matrixId: 'm-target', PreviousVersionID: 'm-prev', TemplateID: 't' },
);
assert.equal(foreignSameTemplate.kind, 'same-template-foreign-matrix');
assert.equal(foreignSameTemplate.workbookMatrixId, 'm-source');
assert.equal(foreignSameTemplate.currentMatrixId, 'm-target');

const foreignTemplate = E.classifyWorkbookContext(
  { roundtrip: { enabled: true, matrixId: 'm-source', templateId: 't-other' } },
  { matrixId: 'm-target', PreviousVersionID: 'm-prev', TemplateID: 't' },
);
assert.equal(foreignTemplate.kind, 'foreign-template');

const invalid = E.classifyWorkbookContext({}, { matrixId: 'm-target', TemplateID: 't' });
assert.equal(invalid.kind, 'invalid-roundtrip');

console.log('TESSA Matrix Studio workbook context classification: OK');
