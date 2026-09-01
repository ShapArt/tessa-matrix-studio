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
assert(typeof E.evaluateRuntimeCapabilities === 'function', 'evaluateRuntimeCapabilities is missing');
assert(typeof E.capabilityOperationAvailability === 'function', 'capabilityOperationAvailability is missing');
assert(typeof E.humanCapabilityBlocker === 'function', 'humanCapabilityBlocker is missing');

const readyProbe = {
  runtime: { extensionRequire: true, apiLoader: true, workspace: true, editor: true, cardModel: true },
  cardService: { get: true, request: true, store: true, newOrCreate: true },
  constructors: { cardGetRequest: true, cardRequest: true, cardStoreRequest: true, cardNewRequest: true, affectVersion: true },
  matrix: { identity: true, template: true, stateReadable: true, writableState: true, matrixId: 'matrix-1' },
  nativeView: { found: true, paging: true, refresh: true },
};

const ready = E.evaluateRuntimeCapabilities(readyProbe);
assert(ready.overall === 'ready', `ready probe must be ready: ${JSON.stringify(ready)}`);
assert(E.capabilityOperationAvailability(ready, [{ type: 'update' }]).apply.enabled === true, 'ready UPDATE must be applicable');
assert(E.capabilityOperationAvailability(ready, [{ type: 'add' }]).apply.enabled === true, 'ready ADD must be applicable');
assert(E.capabilityOperationAvailability(ready, [{ type: 'delete' }]).apply.enabled === true, 'ready DELETE must be applicable');

const noCreate = E.evaluateRuntimeCapabilities({
  ...readyProbe,
  cardService: { ...readyProbe.cardService, newOrCreate: false },
});
assert(noCreate.overall === 'limited', `missing CardNew should degrade only part of Studio: ${JSON.stringify(noCreate)}`);
assert(E.capabilityOperationAvailability(noCreate, [{ type: 'update' }]).apply.enabled === true, 'missing CardNew must not block UPDATE-only Apply');
const addAvailability = E.capabilityOperationAvailability(noCreate, [{ type: 'add' }]);
assert(addAvailability.apply.enabled === false, 'missing CardNew must block ADD');
assert(addAvailability.apply.blockers.includes('add-store-unavailable'), JSON.stringify(addAvailability));

const noRefresh = E.evaluateRuntimeCapabilities({
  ...readyProbe,
  nativeView: { found: true, paging: true, refresh: false },
});
assert(noRefresh.overall === 'limited', `missing local refresh should be limited: ${JSON.stringify(noRefresh)}`);
assert(E.capabilityOperationAvailability(noRefresh, [{ type: 'update' }]).apply.enabled === true, 'missing local refresh must not poison Store');
assert(E.capabilityOperationAvailability(noRefresh, []).refreshView.enabled === false, 'refreshView must be disabled when local refresh is absent');

const noView = E.evaluateRuntimeCapabilities({
  ...readyProbe,
  nativeView: { found: false, paging: false, refresh: false },
});
assert(noView.overall === 'incompatible', `current snapshot path needs native view: ${JSON.stringify(noView)}`);
const noViewAvailability = E.capabilityOperationAvailability(noView, [{ type: 'update' }]);
assert(noViewAvailability.export.enabled === false, 'missing native matrix view must block export');
assert(noViewAvailability.analyze.enabled === false, 'missing native matrix view must block analyze');
assert(noViewAvailability.apply.enabled === false, 'missing native matrix view must block Apply preflight');
assert(noViewAvailability.reconcile.enabled === false, 'missing native matrix view must block reconciliation');

const noStore = E.evaluateRuntimeCapabilities({
  ...readyProbe,
  cardService: { ...readyProbe.cardService, store: false },
});
assert(noStore.overall === 'limited', `missing Store should leave read path usable: ${JSON.stringify(noStore)}`);
assert(E.capabilityOperationAvailability(noStore, []).export.enabled === true, 'missing Store must not block read-only export');
assert(E.capabilityOperationAvailability(noStore, [{ type: 'update' }]).apply.enabled === false, 'missing Store must block UPDATE Apply');

const message = E.humanCapabilityBlocker(['add-store-unavailable']);
assert(typeof message === 'string' && message.length > 10, `capability blocker must have user-facing text: ${message}`);
assert(!/webpack|9855|9893/i.test(message), `primary UX must not expose runtime module internals: ${message}`);

console.log('TESSA Matrix Studio runtime capability model: OK');
