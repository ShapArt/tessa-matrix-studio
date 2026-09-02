import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const marker = '  bootstrap();';
assert.equal(source.split(marker).length, 2, 'test hook must target the bootstrap call exactly once');
const hooked = source.replace(marker, '  window.__monitorTest = { APP, refreshRuntimeCapabilities, setBusy }; bootstrap();');
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const T1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const T2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function fixture() {
  const elements = new Map([
    '#tms-apply', '#tms-apply-section', '#tms-summary', '#tms-plan', '#tms-value-picker', '#tms-reconcile', '#tms-file',
    '#tms-download-current', '#tms-download-fresh', '#tms-analyze',
    '#tms-capability-status', '#tms-capability-details',
  ].map(id => [id, { disabled: false, hidden: false, innerHTML: '', textContent: '', dataset: {} }]));
  const serviceCalls = [];
  const service = Object.fromEntries(['get', 'request', 'store', 'new', 'create'].map(name => [name, () => {
    serviceCalls.push(name);
    throw new Error(`Automatic readiness must not call CardService.${name}`);
  }]));
  class StoreRequest { constructor() { this.affectVersion = false; } }
  const cards = { CardGetRequest: class {}, CardRequest: class {}, CardNewRequest: class {}, CardStoreRequest: StoreRequest };
  const extensionRequire = id => id === 9855 ? cards : id === 9814 ? { TypedField: { get: value => value } }
    : id === 9893 ? { CardService: { instance: service } } : {};
  const chunks = [];
  chunks.push = ([, , callback]) => callback(extensionRequire);
  const controls = new Map();
  const editor = { cardModel: { card: null, controls } };
  let workspace = { editor };
  const context = {
    __TESSA_MATRIX_SYNC_TEST_MODE__: true,
    document: { querySelector: selector => elements.get(selector) || null, querySelectorAll: () => [...elements.values()], body: { innerText: '' } },
    webpackChunktessa_web_extensions: chunks,
    tessa: { apiLoader: id => id === 546914 ? { WorkspaceStorage: { instance: { currentCardWorkspace: workspace } } } : {} },
    console, setTimeout, clearTimeout,
  };
  context.window = context;
  vm.runInNewContext(hooked, context, { filename: 'tessa-matrix-studio.user.js' });
  const { APP, refreshRuntimeCapabilities: refresh } = context.__monitorTest;
  const E = context.__TESSA_MATRIX_SYNC_EXPORTS__;
  const setView = enabled => {
    controls.clear();
    if (enabled) controls.set('MtxRouteMatrixDummyView', {
      table: { rows: [{ data: new Map([['MatrixRowID', 'row-id'], ['MatrixVersionID', 'version-id']]) }] },
      refresh() { throw new Error('readiness must not refresh the native view'); },
      setPageAndRefresh() { throw new Error('readiness must not change the native page'); },
    });
  };
  const setCard = (matrixId, templateId) => {
    workspace = matrixId ? { editor } : null;
    editor.cardModel.card = matrixId ? {
      id: matrixId,
      sections: { tryGet: () => ({ fields: { tryGetString: key => key === 'TemplateID' ? templateId : key === 'StateName' ? 'Черновик' : null } }) },
    } : null;
    setView(Boolean(matrixId));
  };
  setCard(A, T1);
  refresh();

  // A completed preview and receipt from the first card must not survive a
  // context switch. Use the real probe and UI state update, not a probe stub.
  Object.assign(APP, {
    plan: { id: 'plan-A', matrixId: A, templateId: T1 },
    workbook: { fileName: 'matrix-A.xlsx', roundtrip: { enabled: true } },
    structure: { templateId: T1 }, snapshot: { matrixId: A, templateId: T1, rows: [] },
    bridge: { mainCard: { id: A } }, dictionaryCatalog: { catalogs: {} },
    capabilityActions: [{ type: 'update' }], reviewedApplyEnabled: true,
    lastMutationReceipts: { matrixId: A, templateId: T1, receipts: [{ rowCardId: 'row-A' }] },
    lastReconciliation: { status: 'verified' },
    picker: { selected: new Map([['old', 'value']]), searchTimer: null },
  });
  APP.review.excludedRows.add('old-exclusion');
  elements.get('#tms-summary').innerHTML = 'old-summary';
  elements.get('#tms-plan').innerHTML = 'old-preview';
  refresh();
  return { APP, E, refresh, elements, serviceCalls, setCard, setView, setBusy: context.__monitorTest.setBusy };
}

function assertCleared({ APP, elements, serviceCalls }) {
  for (const key of ['plan', 'workbook', 'structure', 'snapshot', 'bridge', 'dictionaryCatalog', 'lastMutationReceipts', 'lastReconciliation', 'picker']) {
    assert.equal(APP[key], null, `${key} retained state from the previous matrix/template`);
  }
  assert.equal(APP.review.excludedRows.size, 0);
  assert.equal(APP.capabilityActions.length, 0);
  assert.equal(APP.reviewedApplyEnabled, false);
  assert.equal(elements.get('#tms-apply').disabled, true);
  assert.equal(elements.get('#tms-apply-section').hidden, true);
  assert.equal(elements.get('#tms-plan').innerHTML, '');
  assert.equal(elements.get('#tms-summary').innerHTML, '');
  assert.equal(elements.get('#tms-value-picker').hidden, true);
  assert.equal(elements.get('#tms-reconcile').hidden, true);
  assert.deepEqual(serviceCalls, []);
}

const failures = [];
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
}

check('same matrix and template preserve a completed preview and selections', () => {
  const f = fixture();
  const before = { plan: f.APP.plan, snapshot: f.APP.snapshot, receipts: f.APP.lastMutationReceipts, picker: f.APP.picker };
  for (let i = 0; i < 3; i++) f.refresh();
  assert.equal(f.APP.plan, before.plan);
  assert.equal(f.APP.snapshot, before.snapshot);
  assert.equal(f.APP.lastMutationReceipts, before.receipts);
  assert.equal(f.APP.picker, before.picker);
  assert.equal(f.elements.get('#tms-apply').disabled, false);
  assert.deepEqual(f.serviceCalls, []);
});

for (const templateId of [T1, T2]) check(`different matrix invalidates state with ${templateId === T1 ? 'same' : 'different'} template`, () => {
  const f = fixture();
  f.setCard(B, templateId);
  f.refresh();
  assertCleared(f);
  assert.equal(f.APP.capabilityCheckedCardId, B);
  assert.equal(f.APP.capabilityCheckedTemplateId, templateId);
});

check('busy card change is invalidated by the first idle check', () => {
  const f = fixture();
  const plan = f.APP.plan;
  f.APP.busy = true;
  f.setCard(B, T2);
  f.refresh();
  f.refresh();
  assert.equal(f.APP.plan, plan, 'running operation state changed while busy');
  assert.equal(f.APP.capabilityCheckedCardId, A, 'busy probe acknowledged the new card before invalidation');
  assert.equal(f.APP.capabilityCheckedTemplateId, T1, 'busy probe acknowledged the new template before invalidation');
  f.APP.busy = false;
  f.refresh();
  assertCleared(f);
  assert.equal(f.APP.capabilityCheckedCardId, B);
  assert.equal(f.APP.capabilityCheckedTemplateId, T2);
});

check('closing a card invalidates its preview and receipts', () => {
  const f = fixture();
  f.setCard(null, null);
  f.refresh();
  assertCleared(f);
  assert.equal(f.APP.capabilityCheckedCardId, null);
  assert.equal(f.APP.capabilityCheckedTemplateId, null);
});

check('monitor ticks do not replan or inspect snapshot rows', () => {
  const f = fixture();
  const forbidden = () => { throw new Error('readiness tick scanned the plan/snapshot'); };
  Object.defineProperties(f.APP.plan, { actions: { get: forbidden }, snapshot: { get: forbidden } });
  Object.defineProperty(f.APP.snapshot, 'rows', { get: forbidden });
  let scheduled;
  const monitor = f.E.createRuntimeMonitor({
    active: () => !f.APP.busy, check: f.refresh,
    schedule: callback => { scheduled = callback; return 1; }, cancel() {},
  });
  monitor.start();
  for (let i = 0; i < 20; i++) scheduled();
  assert.equal(f.elements.get('#tms-apply').disabled, false);
  f.APP.reviewedApplyEnabled = false;
  scheduled();
  assert.equal(f.elements.get('#tms-apply').disabled, true, 'cached review exclusion was ignored');
  monitor.stop();
  assert.deepEqual(f.serviceCalls, []);
});

check('temporary native view loss gates buttons and recovers without losing the plan', () => {
  const f = fixture();
  const plan = f.APP.plan;
  f.setView(false);
  f.refresh();
  assert.equal(f.elements.get('#tms-apply').disabled, true);
  assert.equal(f.elements.get('#tms-reconcile').disabled, true);
  f.setView(true);
  f.refresh();
  assert.equal(f.APP.plan, plan);
  assert.equal(f.elements.get('#tms-apply').disabled, false);
  assert.equal(f.elements.get('#tms-reconcile').disabled, false);
  assert.deepEqual(f.serviceCalls, []);
});

check('Analyze requires a file as well as a ready matrix', () => {
  const f = fixture();
  assert.equal(f.elements.get('#tms-analyze').disabled, true);
  f.elements.get('#tms-file').files = [{ name: 'matrix.xlsx' }];
  f.refresh();
  assert.equal(f.elements.get('#tms-analyze').disabled, false);
  f.setView(false);
  f.refresh();
  assert.equal(f.elements.get('#tms-analyze').disabled, true);
  assert.deepEqual(f.serviceCalls, []);
});

for (const busy of [false, true]) check(`same-card template change invalidates state${busy ? ' after busy' : ''}`, () => {
  const f = fixture();
  const plan = f.APP.plan;
  f.APP.busy = busy;
  f.setCard(A, T2);
  f.refresh();
  if (busy) {
    assert.equal(f.APP.plan, plan);
    assert.equal(f.APP.capabilityCheckedTemplateId, T1);
    f.APP.busy = false;
    f.refresh();
  }
  assertCleared(f);
  assert.equal(f.APP.capabilityCheckedCardId, A);
  assert.equal(f.APP.capabilityCheckedTemplateId, T2);
});

check('busy controls restore their original disabled state', () => {
  const f = fixture();
  const firstPage = { id: 'first-page', disabled: true };
  const emptyPicker = { id: 'empty-picker-copy', disabled: true };
  const availableTool = { id: 'tool', disabled: false };
  f.elements.set('#first-page', firstPage);
  f.elements.set('#empty-picker-copy', emptyPicker);
  f.elements.set('#tool', availableTool);
  f.setBusy(true);
  assert.equal(availableTool.disabled, true);
  f.setBusy(false);
  assert.equal(firstPage.disabled, true);
  assert.equal(emptyPicker.disabled, true);
  assert.equal(availableTool.disabled, false);
  assert.deepEqual(f.serviceCalls, []);
});

if (failures.length) throw new Error(`${failures.length} runtime monitor regressions: ${failures.join('; ')}`);
console.log('TESSA runtime monitor integration: OK');
