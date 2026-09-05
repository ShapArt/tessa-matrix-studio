import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(code);
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;
const { S, F, OPERAND: O } = E.constants;

const structure = {
  templateId: 'template',
  conditions: [{ criterionRowId: 'pages', criterionName: 'Листы', operandTypeId: O.Int }],
  functions: [{ id: 'sign', name: 'Подписание' }],
};
const original = {
  rowCardId: 'saved-card', versionId: 'saved-version', index: 0,
  values: { pages: [{ kind: 'Int', value: 801, to: 809, display: '801 - 809' }] },
  roles: { sign: [{ id: 'person', roleTypeId: 1, display: 'Исполнитель' }] },
  flat: { 'criterion:pages': ['801 - 809'], 'function:sign': ['Исполнитель'] },
};
const snapshot = {
  matrixId: 'matrix', templateId: 'template', rows: [original],
  criterionIdCache: new Map(), roleIdCache: new Map(), roleIdByFunctionCache: new Map(),
};
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, { matrixId: 'matrix', TemplateID: 'template' });
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const values = Array(workbook.headers.length).fill('');
values[workbook.headers.indexOf('Листы')] = '810..819';
values[workbook.headers.indexOf('Подписание')] = 'Исполнитель';
values[workbook.headers.indexOf('Подписание__ID')] = 'person|1';
workbook.rows.push({ excelRow: 16, values });
const failedRows = [{ excelRow: 16, code: 'duplicate-interval-extractor' }];

// One rejected candidate is enough to prove the live path and keeps the diagnostic
// budget explicit: 2 controls + 1 proposed-add + exactly 3 detached marker probes.
function fixture() {
  const row = (data, rowId = 'row', state = 0) => ({ data, rowId, state, set(key, value) { this.data[key] = value; } });
  const card = (id, version, filled) => ({
    id,
    sections: {
      [S.Versions]: { rows: [row({}, version)] },
      [S.Values]: { rows: filled ? [row({ [F.OwnerRowID]: version, [F.CriterionRowID]: 'pages', [F.IntValue]: 801, [F.IntToValue]: 809 })] : [] },
      [S.Roles]: { rows: filled ? [row({ [F.OwnerRowID]: version, [F.FunctionID]: 'sign', [F.RoleID]: 'person', [F.RoleName]: 'Исполнитель', [F.RoleTypeID]: 1 })] : [] },
    },
    getStorage() { return { id: this.id, sections: this.sections }; },
    clone() {
      const copy = card(this.id, version, false);
      for (const [name, section] of Object.entries(this.sections)) {
        copy.sections[name].rows = section.rows.map(r => row(structuredClone(r.data), r.rowId, r.state));
      }
      return copy;
    },
  });
  const stored = card('saved-card', 'saved-version', true);
  const calls = [];
  const bridge = Object.create(E.TessaBridge.prototype);
  let serial = 0;
  Object.defineProperties(bridge, {
    FieldType: { value: { Guid: 'Guid', String: 'String', Int: 'Int' } },
    CardRowState: { value: { Inserted: 1, Deleted: 2 } },
    Guid: { value: { newGuid: () => `guid-${++serial}` } },
  });
  Object.assign(bridge, {
    core: { TypedField: { createGuid: value => ({ type: 'Guid', value }) }, StorageHelper: { tryGet: (info, key) => info[key] } },
    cards: { CardRequest: class { constructor() { this.info = {}; } } },
    mainCard: { id: 'matrix' }, templateId: () => 'template',
    section: (source, name) => source.sections[name], rowValue: (r, key) => r.data[key], isDeleted: r => r.state === 2,
    addRow: section => { const r = row({}); section.rows.push(r); return r; },
    getCard: async id => { calls.push(['get', id]); return stored; },
    createRowCard: async () => { calls.push(['new']); const versionId = `new-${++serial}`; return { card: card(`card-${serial}`, versionId, false), versionId }; },
    cardService: {
      request: async request => {
        calls.push(['request', request.requestType]);
        const requestNumber = calls.filter(call => call[0] === 'request').length;
        if (requestNumber <= 2) return { info: { ok: true }, validationResult: { isSuccessful: true } };
        return { info: {}, validationResult: { isSuccessful: false, build: () => 'LeftOperandExtractor is null' } };
      },
      store: () => { throw new Error('Store must never run'); },
      delete: () => { throw new Error('Delete must never run'); },
    },
    storeRowCard: () => { throw new Error('Store must never run'); },
    deleteMatrixRow: () => { throw new Error('Delete must never run'); },
  });
  return { bridge, calls };
}

const f = fixture();
const result = await E.collectIntervalDiagnostics({
  ...f, workbook, structure, snapshot, failedRows, assertContext: async () => {},
});

assert.deepEqual(result.samples.map(sample => sample.kind), [
  'saved-original',
  'saved-rebuilt',
  'proposed-add',
  'proposed-add-clear-interval-changed',
  'proposed-add-clear-interval-state',
  'proposed-add-clear-interval-markers',
], 'rejected CardNew interval must get the three bounded structural probes even when saved-rebuilt is allowed');
assert.equal(result.samples[0].outcome, 'allowed');
assert.equal(result.samples[1].outcome, 'allowed');
assert.equal(result.samples[2].code, 'duplicate-interval-extractor');
assert.deepEqual(result.samples.slice(3).map(sample => sample.structuralMode), [
  'clear-interval-changed',
  'clear-interval-state',
  'clear-interval-markers',
]);
assert.equal(f.calls.filter(call => call[0] === 'request').length, 6, 'one candidate must stay bounded to 2 controls + 1 proposed-add + 3 structural probes');
assert.equal(f.calls.filter(call => call[0] === 'new').length, 1, 'structural probes must reuse the captured proposed-add payload, not create more CardNew cards');
assert.equal(result.writesAttempted, 0);
assert.equal(result.samples.every(sample => sample.request?.info?.card), true);

console.log('TESSA interval diagnosis: rejected proposed-add gets bounded read-only interval marker probes: OK');
