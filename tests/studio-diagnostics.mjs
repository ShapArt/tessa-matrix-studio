import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
const controls = new Map();
const downloads = [];
globalThis.document = { body: { innerText: '' }, querySelector: s => controls.get(s) || null, querySelectorAll: () => [], createElement: () => ({ click() { downloads.push(this.download); } }) };
const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source.replace('  bootstrap();', '  window.__studioTests = { APP, runStudioDiagnostics, renderStudioDiagnostics, resetFilePreview, invalidatePlanStateAfterApply, unzipArrayBuffer, setProbe: value => { probeRuntimeEnvironment = value; } }; bootstrap();'));
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;
const { S, F, OPERAND: O, REQUEST } = E.constants;
const structure = { templateId: 'template', conditions: [{ criterionRowId: 'pages', criterionName: 'Листы', operandTypeId: O.Int }], functions: [{ id: 'sign', name: 'Подписание' }] };
const original = { rowCardId: 'saved-card', versionId: 'saved-version', index: 0, values: { pages: [{ kind: 'Int', value: 801, to: 809, display: '801 - 809' }] }, roles: { sign: [{ id: 'role', roleTypeId: 1, display: 'Исполнитель' }] }, flat: { 'criterion:pages': ['801 - 809'], 'function:sign': ['Исполнитель'] } };
original.fingerprint = E.fingerprintFlat(original.flat);
const snapshot = { matrixId: 'matrix', templateId: 'template', rows: [original], criterionIdCache: new Map(), roleIdCache: new Map(), roleIdByFunctionCache: new Map() };
const probe = () => ({ runtime: { extensionRequire: true, apiLoader: true, workspace: true, editor: true, cardModel: true }, cardService: { get: true, request: true, store: true, newOrCreate: true }, constructors: { cardGetRequest: true, cardRequest: true, cardStoreRequest: true, cardNewRequest: true, affectVersion: true }, matrix: { identity: true, template: true, stateReadable: true, writableState: true, matrixId: 'matrix', templateId: 'template' }, nativeView: { found: true, paging: true, refresh: true } });
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, { matrixId: 'matrix', TemplateID: 'template' });
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const added = Array(workbook.headers.length).fill('');
added[workbook.headers.indexOf('Листы')] = '810..819'; added[workbook.headers.indexOf('Подписание')] = 'Исполнитель'; added[workbook.headers.indexOf('Подписание__ID')] = 'role|1';
workbook.rows.push({ excelRow: 16, values: added });
function fixture({ intervalFailure = false } = {}) {
  const row = (data, rowId = 'row', state = 0) => ({ data, rowId, state, set(k, v) { this.data[k] = v; } });
  const card = (id, version, filled) => ({ id, sections: {
    [S.Versions]: { rows: [row({}, version)] },
    [S.Values]: { rows: filled ? [row({ [F.OwnerRowID]: version, [F.CriterionRowID]: 'pages', [F.IntValue]: 801, [F.IntToValue]: 809 })] : [] },
    [S.Roles]: { rows: filled ? [row({ [F.OwnerRowID]: version, [F.FunctionID]: 'sign', [F.RoleID]: 'role', [F.RoleName]: 'Исполнитель', [F.RoleTypeID]: 1 })] : [] },
  }, getStorage() { return { id: this.id, sections: this.sections }; }, clone() {
    const c = card(this.id, version, false);
    for (const [name, section] of Object.entries(this.sections)) c.sections[name].rows = section.rows.map(r => row(structuredClone(r.data), r.rowId, r.state));
    return c;
  } });
  const saved = card('saved-card', 'saved-version', true);
  let seq = 0;
  const calls = [];
  const bridge = Object.create(E.TessaBridge.prototype);
  Object.defineProperties(bridge, { FieldType: { value: { Int: 'Int', Guid: 'Guid', String: 'String' } }, CardRowState: { value: { Inserted: 1, Deleted: 2 } }, Guid: { value: { newGuid: () => `id-${++seq}` } } });
  Object.assign(bridge, {
    core: { TypedField: { createGuid: value => value }, StorageHelper: { tryGet: (info, key) => info?.[key] } },
    cards: { CardRequest: class { constructor() { this.info = {}; } } },
    mainCard: { id: 'matrix' }, templateId: () => 'template', matrixInfo: () => ({ matrixId: 'matrix', TemplateID: 'template' }),
    section: (c, name) => c.sections[name], rowValue: (r, key) => r.data[key], isDeleted: r => r.state === 2,
    addRow: section => { const r = row({}); section.rows.push(r); return r; },
    async requestStructure() { await this.cardService.request({ requestType: REQUEST.Structure, info: {} }); return structuredClone(structure); },
    async loadSnapshot() { const response = await this.cardService.get({ cardId: 'saved-card' }); return { ...snapshot, rows: [{ ...original, card: response.card }] }; },
    async loadDictionaryCatalog(s, snap, options) { assert.equal(options.transient, true); await this.queryViewSample('Roles', 100); return { catalogs: {}, columnCatalogIds: {}, stats: { catalogs: 0, entries: 0, errors: [] } }; },
    queryViewSample: async () => ({ rows: [], columns: [], complete: true }),
    async getCard(id) { return (await this.cardService.get({ cardId: id })).card; },
    async createRowCard() { return this.cardService.create({ cardTypeName: 'row' }); },
    cardService: {
      async get(req) { calls.push('get'); return { card: saved.clone() }; },
      async create() { calls.push('new'); const versionId = `new-${++seq}`; return { card: card(`new-card-${seq}`, versionId, false), versionId }; },
      async request(req) {
        calls.push(req.requestType);
        if (req.requestType === REQUEST.Structure) return { info: {}, validationResult: { isSuccessful: true } };
        const data = req.info.card.sections[S.Values].rows.find(r => r.state !== 2).data;
        const isNew = req.info.card.id !== 'saved-card';
        if (isNew && intervalFailure) return { info: {}, validationResult: { isSuccessful: false, build: () => 'LeftOperandExtractor is null' } };
        return { info: { ok: !isNew || data[F.IntValue] !== 801 }, validationResult: { isSuccessful: true } };
      },
      store() { throw new Error('REAL STORE CALLED'); }, delete() { throw new Error('REAL DELETE CALLED'); },
    },
  });
  return { bridge, calls, saved };
}
async function collect(f, overrides = {}) { return E.collectStudioDiagnostics({ connect: async () => f.bridge, probe, workbook, assertContext: async () => {}, ...overrides }); }
const f = fixture();
const originalBytes = JSON.stringify(f.saved.getStorage()), workbookBefore = JSON.stringify(workbook);
const result = await collect(f);
assert.equal(result.report.status, 'passed', JSON.stringify(result.report.checks));
assert.equal(result.report.checks.find(c => c.id === 'duplicate-control').status, 'pass');
assert.equal(result.report.candidateCoverage.checked, 1);
assert.equal(result.report.writesAttempted, 0);
assert.equal(JSON.stringify(f.saved.getStorage()), originalBytes);
assert.equal(JSON.stringify(workbook), workbookBefore);
assert.ok(result.report.notTested.includes('Сохранение и удаление строк'));
const count = f.calls.length;
const zip = await E.makeStudioDiagnosticPackage(result);
const parts = await window.__studioTests.unzipArrayBuffer(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength));
assert.ok(parts.has('report.json') && parts.has('matrix-current.xlsx') && parts.has('selected-workbook.json'));
assert.ok([...parts.keys()].some(k => /requests\/.*response.json/.test(k)));
await E.makeStudioDiagnosticPackage(result);
assert.equal(f.calls.length, count, 'packaging repeated server requests');

const failure = await collect(fixture({ intervalFailure: true }));
assert.equal(failure.report.status, 'failed');
assert.equal(failure.report.checks.find(c => c.id === 'duplicate-control').code, 'duplicate-interval-extractor');
assert.equal(failure.report.checks.find(c => c.id === 'candidate-16').code, 'duplicate-interval-extractor');
assert.ok(failure.entries.some(([name]) => name === 'matrix-current.xlsx'), 'server failure discarded prior evidence');
const denied = fixture();
denied.bridge.requestStructure = async function () { return this.cardService.store({}); };
const guarded = await collect(denied);
assert.equal(guarded.report.blockedWrites, 1);
assert.equal(guarded.report.writesAttempted, 0);
assert.equal(guarded.report.checks.find(c => c.id === 'schema').status, 'fail');
for (const attempt of [reader => reader.cardService.delete({}), reader => reader.cardService.request({ requestType: 'unrecognized-request' })]) {
  const denied = fixture(); denied.bridge.requestStructure = function () { return attempt(this); };
  const blocked = await collect(denied);
  assert.equal(blocked.report.blockedWrites, 1);
  assert.ok(!denied.calls.includes('unrecognized-request'));
}
const changedWorkbook = structuredClone(workbook);
changedWorkbook.rows = [changedWorkbook.rows[0]];
changedWorkbook.rows[0].values[changedWorkbook.headers.indexOf('Листы')] = '900..909';
const updated = await collect(fixture(), { workbook: changedWorkbook });
assert.equal(updated.report.status, 'passed', JSON.stringify(updated.report.checks));
assert.equal(updated.report.candidateCoverage.checked, 1);
assert.match(updated.report.checks.find(c => c.id.startsWith('candidate-')).title, /изменить/);
const changed = fixture();
const interrupted = await collect(changed, { assertContext: async () => { if (changed.calls.length) throw new Error('context changed'); } });
assert.equal(changed.calls.length, 1);
assert.ok(interrupted.report.interrupted);
const capped = await collect(fixture(), { limits: { itemBytes: 1, candidates: 0 } });
assert.ok(capped.report.omitted.length > 0);
assert.equal(capped.report.candidateCoverage.checked, 0);
assert.equal(capped.report.status, 'incomplete');
const callLimit = await collect(fixture(), { limits: { calls: 1 } });
assert.equal(callLimit.report.calls.length, 1); assert.match(callLimit.report.interrupted, /лимит запросов/);
const disconnected = await collect(fixture(), { connect: async () => { throw new Error('No matrix'); }, workbook: null });
assert.equal(disconnected.report.checks.find(c => c.id === 'connection').status, 'fail');
assert.ok(disconnected.entries.some(([name]) => name === 'input-rules.json'));
const hang = fixture(); hang.bridge.cardService.request = () => new Promise(() => {});
const timeout = await collect(hang, { limits: { requestMs: 5 } });
assert.ok(timeout.report.interrupted); assert.equal(timeout.report.calls.length, 1);
const unreadable = await collect(fixture(), { file: { name: 'bad.xlsx', size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } });
assert.equal(unreadable.report.checks.find(c => c.id === 'file-read').status, 'fail');
assert.equal(unreadable.report.checks.find(c => c.id === 'selected-plan').status, 'not-run', 'failed read reused a previously parsed workbook');
assert.equal(unreadable.report.candidateCoverage.checked, 0);
let viewRequest;
const viewBridge = { viewApi: () => ({ serviceModule: { TessaViewRequest: class {} }, service: { getByName: () => ({ metadata: {}, getData: async req => { viewRequest = req; throw new Error('network offline'); } }) } }) };
assert.match((await E.TessaBridge.prototype.queryViewSample.call(viewBridge, 'test')).error, /network offline/);
await assert.rejects(E.TessaBridge.prototype.queryViewSample.call(viewBridge, 'test', 10, { forceRefresh: true, throwOnError: true }), /network offline/);
assert.equal(viewRequest.canUseCache, false);
let pageCalls = 0;
const pagingBridge = {
  findNativeMatrixControl: () => ({ controlName: 'matrix-view', rows: [], target: { setPageAndRefresh: async () => { pageCalls++; } } }),
  nativePagingInfo: () => ({ currentPage: 1, pageCount: 2, component: {} }),
};
await E.TessaBridge.prototype.collectNativeMatrixViewLinksAllPages.call(pagingBridge, { assertContext: async () => { throw new Error('other context'); } });
assert.equal(pageCalls, 0, 'native view navigated after context changed');

const { APP, renderStudioDiagnostics, resetFilePreview, invalidatePlanStateAfterApply } = window.__studioTests;
const host = { innerHTML: '', textContent: '' }; controls.set('#tms-tests-result', host);
renderStudioDiagnostics({ checks: [{ title: '<script>bad</script>', status: 'fail', detail: '<img onerror=bad>' }], omitted: [] });
assert.doesNotMatch(host.innerHTML, /<script>|<img/);
assert.match(host.innerHTML, /&lt;script&gt;/);
APP.lastStudioDiagnostics = result; resetFilePreview(); assert.equal(APP.lastStudioDiagnostics, null);
const state = { lastStudioDiagnostics: result }; invalidatePlanStateAfterApply(state, { startedCount: 1 }); assert.equal(state.lastStudioDiagnostics, null);

// Exercise the actual button handler: fresh one-click download, cache, concurrency,
// partial cancellation, and changes not yet noticed by the runtime monitor.
const { runStudioDiagnostics, setProbe } = window.__studioTests;
const oldCreate = E.TessaBridge.create;
setProbe(probe);
const ui = fixture(); E.TessaBridge.create = async () => ui.bridge;
const applyReport = { value: { appliedCount: 4 } }, receipts = { receipts: [{ expectedSemanticKey: 'private-key' }] };
Object.assign(APP, { plan: E.buildPlan(workbook, structure, snapshot), workbook, lastReport: applyReport, lastMutationReceipts: receipts });
const beforePlan = APP.plan;
let firstRpc;
const gate = new Promise(resolve => { firstRpc = resolve; });
const request = ui.bridge.cardService.request;
ui.bridge.cardService.request = async req => { await gate; return request(req); };
const first = runStudioDiagnostics(true);
assert.equal(APP.busy, true);
await runStudioDiagnostics(true);
firstRpc(); await first;
assert.equal(downloads.length, 1, 'double click started another download');
assert.equal(APP.lastStudioDiagnostics.report.status, 'passed');
assert.equal(APP.plan, beforePlan); assert.equal(APP.lastReport, applyReport); assert.equal(APP.lastMutationReceipts, receipts);
const uiCalls = ui.calls.length;
await runStudioDiagnostics(true);
assert.equal(downloads.length, 2); assert.equal(ui.calls.length, uiCalls, 'cached button reran requests');
// A newer Preview invalidates cached checks even when the File object is unchanged.
APP.plan = E.buildPlan(workbook, structure, snapshot);
await runStudioDiagnostics(true);
assert.ok(ui.calls.length > uiCalls); assert.equal(downloads.length, 3);
const switched = fixture(); E.TessaBridge.create = async () => switched.bridge;
const originalRequest = switched.bridge.cardService.request;
switched.bridge.cardService.request = async req => { const value = await originalRequest(req); setProbe(() => ({ ...probe(), matrix: { ...probe().matrix, matrixId: 'other-matrix' } })); return value; };
await runStudioDiagnostics();
assert.equal(APP.lastStudioDiagnostics, null, 'old matrix result retained after context switch');
assert.match(APP.progress.detail, /матрица|шаблон/i); assert.equal(switched.calls.length, 1);
setProbe(probe);
const cancelled = fixture(); E.TessaBridge.create = async () => cancelled.bridge;
const cancelRequest = cancelled.bridge.cardService.request;
cancelled.bridge.cardService.request = async req => { const value = await cancelRequest(req); APP.abortRequested = true; return value; };
await runStudioDiagnostics(true);
assert.ok(APP.lastStudioDiagnostics.report.interrupted); assert.equal(cancelled.calls.length, 1);
assert.equal(downloads.length, 4, 'same-context cancellation lost the partial package');
APP.abortRequested = false;
const selectedFile = { files: [] }; controls.set('#tms-file', selectedFile);
APP.lastStudioDiagnostics = null;
const changedFile = fixture(); E.TessaBridge.create = async () => changedFile.bridge;
const fileRequest = changedFile.bridge.cardService.request;
changedFile.bridge.cardService.request = async req => { const value = await fileRequest(req); selectedFile.files = [{ name: 'other.xlsx' }]; return value; };
await runStudioDiagnostics(true);
assert.equal(APP.lastStudioDiagnostics, null); assert.equal(downloads.length, 4);
assert.equal(changedFile.calls.length, 1); assert.equal(APP.busy, false);
E.TessaBridge.create = oldCreate;
console.log('TESSA one-click diagnostics: actual planners, read allowlist, duplicate control, ZIP, UI caching, context/file switches, cancellation, limits and escaped UI: OK');
