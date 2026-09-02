import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = {
  body: { innerText: '' },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ click() {}, style: {}, set href(_) {}, set download(_) {} }),
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.probeRuntimeEnvironment === 'function', 'probeRuntimeEnvironment is missing');
assert(typeof E.inspectNativeViewCapabilitiesReadOnly === 'function', 'inspectNativeViewCapabilitiesReadOnly is missing');
assert(typeof E.inspectMatrixCapabilitiesReadOnly === 'function', 'inspectMatrixCapabilitiesReadOnly is missing');

const calls = [];
const fakeService = {
  get() { calls.push('get'); },
  request() { calls.push('request'); },
  store() { calls.push('store'); },
  new() { calls.push('new'); },
  create() { calls.push('create'); },
};
class FakeStoreRequest {
  constructor() { this.affectVersion = false; }
}
const fakeCards = {
  CardGetRequest: class {},
  CardRequest: class {},
  CardNewRequest: class {},
  CardStoreRequest: FakeStoreRequest,
};
const fakeTypedField = { get: value => value };
const fakeRequire = id => {
  if (id === 9855) return fakeCards;
  if (id === 9814) return { TypedField: fakeTypedField };
  if (id === 9893) return { CardService: { instance: fakeService } };
  return {};
};

const templateId = '22222222-2222-2222-2222-222222222222';
function makeMatrixSection(stateName) {
  return {
    fields: {
      tryGetString(key) {
        if (key === 'TemplateID') return templateId;
        if (key === 'StateName') return stateName;
        return null;
      },
      tryGetGuid(key) { return key === 'TemplateID' ? templateId : null; },
      tryGet() { return null; },
    },
  };
}
function makeCard(stateName) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    sections: { tryGet: () => makeMatrixSection(stateName) },
  };
}
const fakeControl = {
  table: {
    rows: [{
      data: new Map([
        ['MatrixRowID', '33333333-3333-3333-3333-333333333333'],
        ['MatrixVersionID', '44444444-4444-4444-4444-444444444444'],
      ]),
    }],
  },
  refresh() {},
  setPageAndRefresh() {},
};
function makeRoot(stateName, localization = null) {
  const editor = { cardModel: { card: makeCard(stateName), controls: new Map([['TestMatrixView', fakeControl]]) } };
  const workspace = { editor };
  return {
    tessa: {
      apiLoader(id) {
        if (id === 546914) return { WorkspaceStorage: { instance: { currentCardWorkspace: workspace } } };
        if (id === 880540 && localization) {
          return { LocalizationManager: { instance: { localize: localization } } };
        }
        return {};
      },
    },
  };
}

const fakeRoot = makeRoot('Черновик');
const probe = E.probeRuntimeEnvironment({ root: fakeRoot, extensionRequireFactory: () => fakeRequire });
assert(probe.runtime.extensionRequire === true, JSON.stringify(probe));
assert(probe.runtime.apiLoader === true, JSON.stringify(probe));
assert(probe.cardService.get === true && probe.cardService.request === true, JSON.stringify(probe));
assert(probe.cardService.store === true && probe.cardService.newOrCreate === true, JSON.stringify(probe));
assert(probe.constructors.cardGetRequest === true && probe.constructors.cardRequest === true, JSON.stringify(probe));
assert(probe.constructors.cardStoreRequest === true && probe.constructors.cardNewRequest === true, JSON.stringify(probe));
assert(probe.constructors.affectVersion === true, `AffectVersion capability not proven: ${JSON.stringify(probe)}`);
assert(probe.matrix.identity === true && probe.matrix.template === true && probe.matrix.stateReadable === true, JSON.stringify(probe));
assert(probe.matrix.writableState === true, JSON.stringify(probe));
assert(probe.nativeView.found === true && probe.nativeView.refresh === true && probe.nativeView.paging === true, JSON.stringify(probe));
assert(calls.length === 0, `read-only probe invoked CardService methods: ${calls.join(', ')}`);

const localizedRoot = makeRoot('$Mtx_Enums_RouteMatrixStates_Draft', value =>
  value === '$Mtx_Enums_RouteMatrixStates_Draft' ? 'Черновик' : value);
const localizedProbe = E.probeRuntimeEnvironment({ root: localizedRoot, extensionRequireFactory: () => fakeRequire });
assert(localizedProbe.matrix.stateReadable === true, JSON.stringify(localizedProbe));
assert(localizedProbe.matrix.writableState === true, `localized Draft must be writable: ${JSON.stringify(localizedProbe)}`);
assert(calls.length === 0, `localized probe invoked CardService methods: ${calls.join(', ')}`);

const missingRootProbe = E.probeRuntimeEnvironment({ root: {}, extensionRequireFactory: () => { throw new Error('no extension runtime'); } });
assert(missingRootProbe.runtime.extensionRequire === false, JSON.stringify(missingRootProbe));
assert(missingRootProbe.runtime.apiLoader === false, JSON.stringify(missingRootProbe));
assert(missingRootProbe.nativeView.found === false, JSON.stringify(missingRootProbe));

const throwingLoaderProbe = E.probeRuntimeEnvironment({
  root: { tessa: { apiLoader: () => { throw new Error('loader changed'); } } },
  extensionRequireFactory: () => fakeRequire,
});
assert(throwingLoaderProbe.runtime.extensionRequire === true, JSON.stringify(throwingLoaderProbe));
assert(throwingLoaderProbe.runtime.apiLoader === true, JSON.stringify(throwingLoaderProbe));
assert(throwingLoaderProbe.runtime.workspace === false, JSON.stringify(throwingLoaderProbe));
assert(calls.length === 0, `failure-path probe invoked CardService methods: ${calls.join(', ')}`);

console.log('TESSA Matrix Studio read-only runtime capability probe: OK');

// The UI can mount before a card exists. Subsequent local checks must discover
// both the card and its later-mounted native view without any service call.
let currentWorkspace = null, scheduled;
const delayedRoot = { tessa: { apiLoader: id => id === 546914 ? { WorkspaceStorage: { instance: { get currentCardWorkspace() { return currentWorkspace; } } } } : {} } };
const states = [];
const monitor = E.createRuntimeMonitor({ active: () => true, schedule: fn => { scheduled = fn; return 1; }, cancel() {}, check() {
  const p = E.probeRuntimeEnvironment({ root: delayedRoot, extensionRequireFactory: () => fakeRequire });
  const c = E.evaluateRuntimeCapabilities(p);
  states.push(E.capabilityStatusModel(c, E.capabilityOperationAvailability(c, [])).label);
} });
monitor.start();
currentWorkspace = { editor: { cardModel: { card: makeCard('Черновик'), controls: new Map() } } };
scheduled();
currentWorkspace.editor.cardModel.controls.set('TestMatrixView', fakeControl);
scheduled();
assert(JSON.stringify(states) === JSON.stringify(['Откройте матрицу','Матрица загружается','Матрица готова']), JSON.stringify(states));
monitor.stop();
assert(calls.length === 0, 'automatic readiness checks must not call CardService');
console.log('TESSA delayed card/view mounting recovers automatically: OK');
