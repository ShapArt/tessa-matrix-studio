import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.example.test' };
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const { S } = E.constants;

const bridge = Object.create(E.TessaBridge.prototype);
bridge.section = (card, name) => card.sections?.[name] || null;
bridge.isDeleted = () => false;

const nativeCard = {
  id: 'row-card-1',
  sections: { [S.Versions]: { rows: [{ rowId: 'version-1' }] } },
};
nativeCard.fieldChanged = { _sender: nativeCard };

const structure = { templateId: 'template-1', conditions: [], functions: [] };
const row = bridge.readMatrixRowFromCard(nativeCard, {
  index: 0,
  rowCardId: 'row-card-1',
  versionId: 'version-1',
  rowName: 'Строка 1',
  source: 'native-test',
}, structure);
const snapshot = { matrixId: 'matrix-1', templateId: 'template-1', rows: [row] };
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, { matrixId: 'matrix-1', TemplateID: 'template-1', TemplateName: 'Test' }, null, { includeActions: true });
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

assert.doesNotThrow(() => E.prepareThreeWayMerge(workbook, structure, snapshot),
  'schema refresh merge must not reintroduce a native Card cycle');
const prepared = E.prepareThreeWayMerge(workbook, structure, snapshot);
const merged = E.mergeWorkbookIntoCurrentSnapshot(prepared.workbook, structure, snapshot);
assert.doesNotThrow(() => JSON.stringify(merged.snapshot));
assert.equal(Object.prototype.hasOwnProperty.call(merged.snapshot.rows[0], 'card'), false);

console.log('TESSA Matrix Studio schema refresh with circular native source -> plain DTO roundtrip: OK');
