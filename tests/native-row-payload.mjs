import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;
const virtualNames = [
  'MtxRouteMatrixVirtual',
  'MtxRouteMatrixRowVersionRolesGroupsVirtual',
  'MtxRouteMatrixRowVersionValuesGroupsVirtual',
  'MtxRouteMatrixRowVersionRolesGroupsValuesVirtual',
  'MtxRouteMatrixRowVersionValuesGroupsValuesVirtual',
];
const typed = (type, value) => ({ $__type: type, $__value: value });
const makeCard = storage => ({
  getStorage: () => storage,
  clone: () => makeCard(structuredClone(storage)),
  sections: { remove: name => { delete storage.Sections[name]; } },
});
let request;
let storeRequest;
let calls = 0;
let response = { info: { ok: true }, validationResult: { isSuccessful: true } };
const bridge = Object.create(E.TessaBridge.prototype);
Object.assign(bridge, {
  cards: {
    CardRequest: class { constructor() { this.info = {}; } },
    CardStoreRequest: class { constructor() { this.info = {}; } },
  },
  core: { TypedField: { createGuid: value => typed('uid', value) }, StorageHelper: { tryGet: (info, key) => info?.[key] } },
  mainCard: { id: 'test-matrix' }, templateId: () => 'test-template',
  cardService: {
    request: async req => { calls++; request = req; return response; },
    store: async req => { calls++; storeRequest = req; return response; },
  },
});

// CardGet uses Rows:null; CardNew uses Rows:[]. Both must have the same
// transport shape as native restoreActualValues: no editing-only sections.
// Keep this synthetic: never commit a user's private diagnostic/card data.
for (const emptyRows of [null, []]) {
  const storage = {
    ID: typed('uid', 'test-card'), Version: typed('int', emptyRows ? 0 : 3),
    Sections: {
      MtxRouteMatrixRow: { Fields: { TemplateID: typed('uid', 'test-template') } },
      MtxRouteMatrixRowVersions: { Rows: [{ RowID: typed('uid', 'test-version') }] },
      MtxRouteMatrixRowVersionValues: { Rows: [{
        RowID: typed('uid', 'value'), OwnerRowID: typed('uid', 'test-version'),
        CriterionRowID: typed('uid', 'pages'), IntValue: typed('int', 810), IntToValue: typed('int', 819),
        '.state': typed('int', 2), '.changed': [typed('str', 'IntValue'), typed('str', 'IntToValue')],
      }] },
      MtxRouteMatrixRowVersionRoles: { Rows: [{ RoleID: typed('uid', 'role'), RoleTypeID: typed('int', 1) }] },
      CustomVirtualAudit: { Fields: { Keep: typed('bln', true) } },
      ...Object.fromEntries(virtualNames.map(name => [name, { Rows: emptyRows, '.table': typed('int', 1) }])),
    },
  };
  const card = makeCard(storage);
  const before = structuredClone(storage);
  const expected = structuredClone(storage);
  virtualNames.forEach(name => delete expected.Sections[name]);
  await bridge.validateDuplicate(card, 'test-version');
  assert.deepEqual(request.info.card, expected, 'temporary editor sections leaked to duplicate validation');
  assert.deepEqual(storage, before, 'validation mutated the source card');
  assert.deepEqual(request.info.versionId, typed('uid', 'test-version'));
  await bridge.storeRowCard(card);
  assert.notEqual(storeRequest.card, card);
  assert.deepEqual(storeRequest.card.getStorage(), expected, 'Store and validation used different card payloads');
  assert.equal(storeRequest.affectVersion, true);
  assert.deepEqual(storage, before, 'Store preparation mutated the source card');
}

// An unexpected native editing buffer must never be silently discarded.
// Stop before either request rather than deleting somebody else's edits.
for (const contents of [{ Rows: [{ RowID: typed('uid', 'pending-edit') }] }, { Fields: { Draft: typed('bln', false) } }, { Rows: {} }]) {
  const card = makeCard({ Sections: { [virtualNames[1]]: contents } });
  const before = JSON.stringify(card.getStorage());
  const count = calls;
  await assert.rejects(() => bridge.validateDuplicate(card, 'test-version'), /временн/i);
  await assert.rejects(() => bridge.storeRowCard(card), /временн/i);
  assert.equal(calls, count);
  assert.equal(JSON.stringify(card.getStorage()), before);
}
const noBuffer = makeCard({ Sections: { MtxRouteMatrixRowVersionValues: { Rows: [] } } });
assert.equal(bridge.prepareRowCardForServer(noBuffer), noBuffer);
const badClone = makeCard({ Sections: { [virtualNames[1]]: { Rows: [] } } });
badClone.clone = () => badClone;
assert.throws(() => bridge.prepareRowCardForServer(badClone), /копи/i);
assert.ok(badClone.getStorage().Sections[virtualNames[1]]);

// Normalizing the request must not reinterpret an interval or turn a server
// exception into permission to write. No retries and no fallback to Store.
response = { info: { ok: true }, validationResult: { isSuccessful: false, build: () => 'LeftOperandExtractor is null' } };
const count = calls;
await assert.rejects(() => bridge.validateDuplicate(noBuffer, 'test-version'), error => error.code === 'duplicate-interval-extractor');
assert.equal(calls, count + 1);
console.log('TESSA native row payload: null/empty buffers, identical check/Store data, immutable source, pending-edit guard: OK');
