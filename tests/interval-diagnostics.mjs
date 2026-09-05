import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
const controls = new Map();
const downloads = [];
globalThis.document = {
  body: { innerText: '' }, querySelector: key => controls.get(key) || null, querySelectorAll: () => [],
  createElement: () => ({ click() { downloads.push({ name: this.download, url: this.href }); } }),
};
const code = fs.readFileSync(process.env.TMS_DIAGNOSTIC_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(code.replace('  bootstrap();', '  window.__intervalTest = { APP, resetFilePreview, runIntervalDiagnostics, downloadJson }; bootstrap();'));
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;
assert.equal(typeof E.collectIntervalDiagnostics, 'function', 'read-only interval collector missing');
const { APP, resetFilePreview, runIntervalDiagnostics, downloadJson } = window.__intervalTest;
const { S, F, OPERAND: O } = E.constants;
const structure = { templateId: 'template', conditions: [{ criterionRowId: 'pages', criterionName: 'Листы', operandTypeId: O.Int }], functions: [{ id: 'sign', name: 'Подписание' }] };
const original = {
  rowCardId: 'saved-card', versionId: 'saved-version', index: 0,
  values: { pages: [{ kind: 'Int', value: 801, to: 809, display: '801 - 809' }] },
  roles: { sign: [{ id: 'person', roleTypeId: 1, display: 'Исполнитель' }] },
  flat: { 'criterion:pages': ['801 - 809'], 'function:sign': ['Исполнитель'] },
};
const snapshot = { matrixId: 'matrix', templateId: 'template', rows: [original], criterionIdCache: new Map(), roleIdCache: new Map(), roleIdByFunctionCache: new Map() };
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, { matrixId: 'matrix', TemplateID: 'template' });
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
for (const [excelRow, range] of [[16, '810..819'], [17, '820..829'], [18, '830..839']]) {
  const values = Array(workbook.headers.length).fill('');
  values[workbook.headers.indexOf('Листы')] = range;
  values[workbook.headers.indexOf('Подписание')] = 'Исполнитель';
  values[workbook.headers.indexOf('Подписание__ID')] = 'person|1';
  workbook.rows.push({ excelRow, values });
}
const failedRows = [16, 17, 18].map(excelRow => ({ excelRow, code: 'duplicate-interval-extractor' }));
function fixture({ allowRequestNumbers = [] } = {}) {
  const allowedRequests = new Set(allowRequestNumbers);
  const row = (data, rowId = 'row', state = 0) => ({ data, rowId, state, set(key, value) { this.data[key] = value; } });
  const card = (id, version, filled) => ({
    id, sections: {
      [S.Versions]: { rows: [row({}, version)] },
      [S.Values]: { rows: filled ? [row({ [F.OwnerRowID]: version, [F.CriterionRowID]: 'pages', [F.IntValue]: 801, [F.IntToValue]: 809 })] : [] },
      [S.Roles]: { rows: filled ? [row({ [F.OwnerRowID]: version, [F.FunctionID]: 'sign', [F.RoleID]: 'person', [F.RoleName]: 'Исполнитель', [F.RoleTypeID]: 1 })] : [] },
    },
    getStorage() { return { id: this.id, sections: this.sections }; },
    clone() {
      const copy = card(this.id, version, false);
      for (const [name, section] of Object.entries(this.sections)) copy.sections[name].rows = section.rows.map(r => row(structuredClone(r.data), r.rowId, r.state));
      return copy;
    },
  });
  const stored = card('saved-card', 'saved-version', true);
  const unchanged = JSON.stringify(stored.getStorage());
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
    section: (card, name) => card.sections[name], rowValue: (row, key) => row.data[key], isDeleted: r => r.state === 2,
    addRow: section => { const r = row({}); section.rows.push(r); return r; },
    getCard: async id => { calls.push(['get', id]); return stored; },
    createRowCard: async () => { calls.push(['new']); const versionId = `new-${++serial}`; return { card: card(`card-${serial}`, versionId, false), versionId }; },
    cardService: {
      request: async request => {
        calls.push(['request', request.requestType]);
        const requestNumber = calls.filter(call => call[0] === 'request').length;
        if (allowedRequests.has(requestNumber)) return { info: { ok: true }, validationResult: { isSuccessful: true } };
        return { info: {}, validationResult: { isSuccessful: false, build: () => 'LeftOperandExtractor is null' } };
      },
      store: () => { throw new Error('Store must never run'); },
      delete: () => { throw new Error('Delete must never run'); },
    },
    storeRowCard: () => { throw new Error('Store must never run'); },
    deleteMatrixRow: () => { throw new Error('Delete must never run'); },
  });
  return { bridge, calls, stored, unchanged };
}
const f = fixture();
const inputsBefore = JSON.stringify({ workbook, snapshot });
const result = await E.collectIntervalDiagnostics({ ...f, workbook, structure, snapshot, failedRows, assertContext: async () => {} });
assert.equal(result.interrupted, undefined, result.interruptionReason);
const expectedKinds = [
  'saved-original',
  'saved-rebuilt',
  'saved-rebuilt-clear-interval-changed',
  'saved-rebuilt-clear-interval-state',
  'saved-rebuilt-clear-interval-markers',
  'proposed-add',
  'proposed-add',
];
assert.deepEqual(result.samples.map(s => s.kind), expectedKinds, 'structural probes must run only after the rejected rebuilt control');
assert.ok(result.samples.every(s => s.code === 'duplicate-interval-extractor'));
assert.ok(result.samples.every(s => s.request.info.card && s.response && s.message));
assert.equal(result.samples[0].request.info.card.id, 'saved-card');
assert.deepEqual(result.candidateRows, [16, 17], 'at most two failed additions');
assert.equal(f.calls.filter(c => c[0] === 'request').length, 7, 'rejected rebuilt control stays bounded to its three exact interval probes plus two proposed-add controls');
assert.equal(f.calls.filter(c => c[0] === 'new').length, 2);
assert.equal(result.writesAttempted, 0);

const rowsOf = sample => {
  const cardStorage = sample.request.info.card;
  const sections = cardStorage.Sections || cardStorage.sections || {};
  const section = sections[S.Values] || {};
  return section.Rows || section.rows || [];
};
const unwrap = value => value && typeof value === 'object' && '$__value' in value ? value.$__value : value;
const present = value => {
  const scalar = unwrap(value);
  return scalar !== null && scalar !== undefined && scalar !== '';
};
const intervalRowOf = sample => rowsOf(sample).find(r => {
  const data = r?.data && typeof r.data === 'object' ? r.data : r;
  return (present(data?.[F.IntValue]) && present(data?.[F.IntToValue]))
    || (present(data?.[F.DecimalValue]) && present(data?.[F.DecimalToValue]));
});
const rebuiltBase = result.samples[1];
const clearChanged = result.samples[2];
const clearState = result.samples[3];
const clearBoth = result.samples[4];
const baseInterval = intervalRowOf(rebuiltBase);
const changedInterval = intervalRowOf(clearChanged);
const stateInterval = intervalRowOf(clearState);
const bothInterval = intervalRowOf(clearBoth);
assert.ok(baseInterval && changedInterval && stateInterval && bothInterval, 'interval value row missing from structural samples');
assert.equal('.changed' in changedInterval || 'changed' in changedInterval, false, 'changed-only probe left a changed marker');
assert.equal('.state' in stateInterval || 'state' in stateInterval, false, 'state-only probe left a state marker');
assert.equal('.changed' in bothInterval || 'changed' in bothInterval, false, 'combined probe left a changed marker');
assert.equal('.state' in bothInterval || 'state' in bothInterval, false, 'combined probe left a state marker');
const baseData = baseInterval.data || baseInterval;
for (const sample of [clearChanged, clearState, clearBoth]) {
  const row = intervalRowOf(sample);
  const data = row.data || row;
  assert.deepEqual(data[F.IntValue], baseData[F.IntValue], `${sample.kind} changed IntValue`);
  assert.deepEqual(data[F.IntToValue], baseData[F.IntToValue], `${sample.kind} changed IntToValue`);
  assert.deepEqual(data[F.CriterionRowID], baseData[F.CriterionRowID], `${sample.kind} changed CriterionRowID`);
}
assert.equal(JSON.stringify(f.stored.getStorage()), f.unchanged, 'control card was mutated');
assert.equal(snapshot.rows[0], original);
assert.equal(JSON.stringify({ workbook, snapshot }), inputsBefore, 'collector changed workbook or snapshot');

// If rebuilt control is accepted but the outgoing CardNew still fails, the first
// proposed-add is isolated progressively: exact interval markers -> version markers ->
// non-interval/role markers -> all row markers. The second candidate remains only a
// baseline proposed-add, so the whole diagnostic stays bounded.
const acceptedRebuilt = fixture({ allowRequestNumbers: [2] });
const acceptedResult = await E.collectIntervalDiagnostics({ ...acceptedRebuilt, workbook, structure, snapshot, failedRows, assertContext: async () => {} });
assert.deepEqual(acceptedResult.samples.map(s => s.kind), [
  'saved-original',
  'saved-rebuilt',
  'proposed-add',
  'proposed-add-clear-interval-changed',
  'proposed-add-clear-interval-state',
  'proposed-add-clear-interval-markers',
  'proposed-add-clear-version-changed',
  'proposed-add-clear-version-state',
  'proposed-add-clear-version-markers',
  'proposed-add-clear-noninterval-markers',
  'proposed-add-clear-all-row-markers',
  'proposed-add-clear-main-section-changed',
  'proposed-add',
]);
assert.equal(acceptedResult.samples[1].outcome, 'allowed');
assert.deepEqual(acceptedResult.samples.filter(s => s.structuralMode).map(s => s.structuralMode), [
  'clear-interval-changed', 'clear-interval-state', 'clear-interval-markers',
  'clear-version-changed', 'clear-version-state', 'clear-version-markers',
  'clear-noninterval-markers', 'clear-all-row-markers', 'clear-main-section-changed',
], 'rejected proposed-add must progressively deepen only after narrower probes keep rejecting');
assert.equal(acceptedRebuilt.calls.filter(c => c[0] === 'request').length, 13, 'accepted rebuilt path is bounded to two controls + nine detached probes + second proposed-add baseline');
assert.equal(acceptedRebuilt.calls.filter(c => c[0] === 'new').length, 2, 'structural probes must not allocate extra CardNew cards');
assert.equal(acceptedResult.writesAttempted, 0);

// Switching card/cancelling during a request stops every subsequent request.
const stopped = fixture();
const partial = await E.collectIntervalDiagnostics({ ...stopped, workbook, structure, snapshot, failedRows,
  assertContext: async () => { if (stopped.calls.some(c => c[0] === 'request')) throw new Error('context changed'); },
});
assert.equal(partial.interrupted, true);
assert.equal(stopped.calls.filter(c => c[0] === 'request').length, 1);
assert.equal(stopped.calls.filter(c => c[0] === 'new').length, 0);
const blocked = fixture();
const noCalls = await E.collectIntervalDiagnostics({ ...blocked, workbook, structure, snapshot, failedRows, assertContext: async () => { throw new Error('cancelled'); } });
assert.equal(noCalls.interrupted, true);
assert.equal(blocked.calls.length, 0);

// JSON export keeps the exact request card only for this explicit diagnostic.
const blobs = new Map();
URL.createObjectURL = blob => { const url = `blob:${blobs.size}`; blobs.set(url, blob); return url; };
URL.revokeObjectURL = () => {};
downloadJson(result, 'diagnostic.json', null);
assert.ok(JSON.parse(await blobs.get(downloads.at(-1).url).text()).samples[0].request.info.card);
downloadJson({ card: 'not-public', count: 1 }, 'ordinary.json');
assert.deepEqual(JSON.parse(await blobs.get(downloads.at(-1).url).text()), { count: 1 });
const button = { disabled: true, textContent: '' };
controls.set('#tms-interval-diagnostics', button);
controls.set('#tms-interval-tool', { hidden: true });
const beforeReport = { value: { appliedCount: 1 }, name: 'apply.json' };
APP.lastReport = beforeReport;
Object.assign(APP, { plan: { matrixId: 'matrix', skippedRows: failedRows }, workbook, structure, snapshot, lastIntervalDiagnostics: { value: result, name: 'cached.json' } });
const oldCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => f.bridge;
const count = f.calls.length;
await runIntervalDiagnostics();
assert.equal(f.calls.length, count, 'cached download unexpectedly repeats server checks');
assert.equal(APP.lastReport, beforeReport, 'diagnostics overwrote Apply report');
APP.busy = true;
await runIntervalDiagnostics();
assert.equal(f.calls.length, count);
APP.busy = false;
resetFilePreview();
assert.equal(APP.lastIntervalDiagnostics, null);
assert.equal(button.disabled, true);
assert.equal(controls.get('#tms-interval-tool').hidden, true);
E.TessaBridge.create = oldCreate;
console.log('TESSA interval diagnosis: bounded structural probes, rejected-only gate, unchanged control, no Store/Delete, cancellation and opt-in raw report: OK');