const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://tessa.example.test', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
w.TextEncoder = TextEncoder;
w.TextDecoder = TextDecoder;
const source = fs.readFileSync(process.env.TMS_TEST_SOURCE || path.join(__dirname, '../tessa-matrix-studio.user.js'), 'utf8');
w.eval(source.replace('window.__TESSA_MATRIX_SYNC_EXPORTS__ = {', 'window.__securityTest = { APP, mountUi, openValuePicker }; window.__TESSA_MATRIX_SYNC_EXPORTS__ = {'));
(async () => {
  const E = w.__TESSA_MATRIX_SYNC_EXPORTS__, U = w.__securityTest;
  U.mountUi();
  U.APP.runtimeMonitor.stop();
  const payload = '<img src=x onerror="window.pwned=1"><svg onload="window.pwned=2"></svg><script>window.pwned=3</script>';
  const attribute = '\" autofocus onfocus=window.pwned=4 data-x=\"';
  U.APP.structure = { conditions: [{ criterionRowId: 'criterion', criterionName: payload, operandTypeId: E.constants.OPERAND.ReferenceGuid }], functions: [] };
  U.APP.snapshot = { rows: [] };
  U.APP.dictionaryCatalog = { catalogs: { adversarial: { sourceView: 'Example', entries: [{ id: attribute, display: payload, selector: payload, details: payload, qualifier: payload }] } }, columnCatalogIds: { 'criterion:criterion': 'adversarial' } };
  await U.openValuePicker();
  const picker = w.document.querySelector('#tms-value-picker');
  assert.ok(picker.textContent.includes('<img'), 'payload is visible as literal text');
  assert.equal(picker.querySelectorAll('img,script,svg[onload],[onerror],[onfocus],[autofocus]').length, 0, 'untrusted captions/details/IDs must not create executable DOM');
  assert.equal(w.pwned, undefined);

  const bridge = Object.create(E.TessaBridge.prototype);
  bridge.cards = { CardGetRequest: class {}, CardStoreRequest: class { constructor() { this.info = {}; } } };
  bridge.core = { TypedField: { createGuid: value => value } };
  bridge.mainCard = { id: 'matrix' };
  bridge.prepareRowCardForServer = card => card;
  let reads = 0, stores = 0;
  const denied = () => ({ validationResult: { isSuccessful: false, build: () => ({ toString: () => 'Access denied by TESSA' }) } });
  bridge.cardService = {
    get: async () => { reads += 1; return { ...denied(), card: { id: 'must-not-be-used' } }; },
    store: async request => { stores += 1; assert.equal(request.affectVersion, true); return denied(); },
  };
  await assert.rejects(() => bridge.getCard('forbidden-card'), /Access denied/);
  await assert.rejects(() => bridge.storeRowCard({ id: 'forbidden-card' }), /Access denied/);
  assert.equal(reads, 1);
  assert.equal(stores, 1, 'denied write is not retried with weaker flags or alternate credentials');
  bridge.cardService.store = async () => ({});
  await assert.rejects(() => bridge.storeRowCard({ id: 'forbidden-card' }), /Не удалось сохранить/, 'missing validation status fails closed');
  console.log('Security boundaries: hostile picker DOM, server-denied reads/writes, no bypass retry and missing-status rejection OK');
})().then(() => dom.window.close(), error => { dom.window.close(); console.error(error); process.exitCode = 1; });
