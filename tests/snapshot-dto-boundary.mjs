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
const { S } = E.constants;

const bridge = Object.create(E.TessaBridge.prototype);
bridge.section = (card, name) => card.sections?.[name] || null;
bridge.isDeleted = () => false;

const card = {
  id: 'row-card-1',
  sections: {
    [S.Versions]: { rows: [{ rowId: 'version-1' }] },
  },
};
// Reproduces the live TESSA EventHandler cycle reported by the user:
// Card -> fieldChanged -> _sender -> Card.
card.fieldChanged = { _sender: card };

const row = bridge.readMatrixRowFromCard(card, {
  index: 0,
  rowCardId: 'row-card-1',
  versionId: 'version-1',
  rowName: 'Строка 1',
  source: 'test',
}, { conditions: [], functions: [] });

assert.equal(Object.prototype.hasOwnProperty.call(row, 'card'), false,
  'snapshot DTO must never retain a live TESSA Card');
assert.doesNotThrow(() => JSON.stringify(row),
  'snapshot DTO must stay serializable even when the source Card is circular');
assert.equal(row.rowCardId, 'row-card-1');
assert.equal(row.versionId, 'version-1');
assert.deepEqual(row.values, {});
assert.deepEqual(row.roles, {});

console.log('TESSA Matrix Studio snapshot DTO boundary: live Card/EventHandler objects never cross into serializable state: OK');
