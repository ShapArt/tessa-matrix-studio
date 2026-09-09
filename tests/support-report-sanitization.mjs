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
assert(typeof E.sanitizeSupportReport === 'function', 'sanitizeSupportReport is missing');
assert(typeof E.buildApplySupportReport === 'function', 'buildApplySupportReport is missing');
assert(typeof E.triggerBlobDownload === 'function', 'triggerBlobDownload is missing');
assert(typeof E.downloadJson === 'function', 'downloadJson is missing');

const unsafe = {
  version: '1.9.40',
  matrixId: 'matrix-id',
  templateId: 'template-id',
  capabilities: {
    overall: 'limited',
    blockers: [{ code: 'native-view-refresh-unavailable', scope: 'refreshView', value: 'СЕКРЕТНЫЙ КОНТРАГЕНТ' }],
    warnings: [{ code: 'optional-warning', scope: 'reconcile', display: 'Иванов Иван' }],
  },
  apply: { status: 'completed', requestedCount: 1, appliedCount: 1, failedCount: 0, notStartedCount: 0, rows: ['СЕКРЕТНЫЙ'] },
  reconciliation: {
    status: 'divergent', checkedCount: 1, verifiedCount: 0, divergentCount: 1, missingCount: 0, unknownCount: 0,
    rows: [{ reasonCode: 'reconcile-semantic-divergence', value: 'СЕКРЕТНЫЙ КОНТРАГЕНТ' }],
  },
  receipts: [{ expectedSemanticKey: 'PRIVATE-HASH' }],
  workbook: { rows: ['СЕКРЕТНЫЙ'] },
  snapshot: { rows: ['Иванов Иван'] },
  error: { message: 'Иванов Иван' },
  logs: ['Ромашка'],
};

const safe = E.sanitizeSupportReport(unsafe, { includeIds: false });
const text = JSON.stringify(safe);
for (const forbidden of ['СЕКРЕТНЫЙ', 'Иванов', 'Ромашка', 'PRIVATE-HASH', 'receipts', 'workbook', 'snapshot', 'error']) {
  assert(!text.includes(forbidden), `privacy leak ${forbidden}: ${text}`);
}
assert(!text.includes('matrix-id') && !text.includes('template-id'), `IDs leaked by default: ${text}`);
assert(safe.studioVersion === '1.9.40', JSON.stringify(safe));
assert(safe.capabilities?.overall === 'limited', JSON.stringify(safe));
assert(safe.capabilities?.blockers?.[0]?.code === 'native-view-refresh-unavailable', JSON.stringify(safe));
assert(safe.apply?.appliedCount === 1 && safe.apply?.requestedCount === 1, JSON.stringify(safe));
assert(safe.reconciliation?.reasonCodes?.includes('reconcile-semantic-divergence'), JSON.stringify(safe));

const withIds = E.sanitizeSupportReport(unsafe, { includeIds: true });
assert(withIds.matrixId === 'matrix-id' && withIds.templateId === 'template-id', JSON.stringify(withIds));
assert(!JSON.stringify(withIds).includes('PRIVATE-HASH'), JSON.stringify(withIds));

// After Apply the live preview is deliberately invalidated (APP.plan=null). Support
// output must therefore be built from the immutable Apply result, not depend on the old
// preview. It stays privacy-safe and includes matrix-save/view-refresh outcomes.
const applySupport = E.buildApplySupportReport({
  status: 'partial', requestedCount: 4, appliedCount: 4, failedCount: 0, notStartedCount: 0,
  matrixSave: { ok: true, method: 'force-transaction-store', internal: 'SECRET' },
  viewRefresh: { ok: true, controlName: 'TestMatrixView', private: 'SECRET' },
  reconciliation: { status: 'incomplete', checkedCount: 0, verifiedCount: 0, unknownCount: 4, reasonCode: 'reconcile-read-failed' },
}, { overall: 'ready', blockers: [], warnings: [] }, '1.12.1');
const applySupportText = JSON.stringify(applySupport);
assert(applySupport.apply?.appliedCount === 4, applySupportText);
assert(applySupport.matrixSave?.ok === true && applySupport.matrixSave?.method === 'force-transaction-store', applySupportText);
assert(applySupport.viewRefresh?.ok === true, applySupportText);
assert(!applySupportText.includes('SECRET'), `support report leaked implementation/private fields: ${applySupportText}`);

// Browser regression: clicking a detached <a> is ignored in the live TESSA shell in
// some Chromium policies. The download helper must attach the anchor to the document,
// click while attached, then remove it and revoke the object URL after the gesture.
const events = [];
const fakeUrlApi = {
  createObjectURL(blob) { events.push(['create', blob]); return 'blob:tessa-support'; },
  revokeObjectURL(url) { events.push(['revoke', url]); },
};
const fakeAnchor = {
  parentNode: null,
  style: {},
  click() {
    events.push(['click', this.parentNode !== null, this.href, this.download]);
  },
  remove() {
    events.push(['remove']);
    if (this.parentNode) this.parentNode.removeChild(this);
  },
};
const fakeBody = {
  appendChild(node) { events.push(['append']); node.parentNode = this; return node; },
  removeChild(node) { events.push(['removeChild']); node.parentNode = null; return node; },
};
const fakeDocument = {
  body: fakeBody,
  documentElement: fakeBody,
  createElement(tag) {
    assert(tag === 'a', `unexpected element: ${tag}`);
    return fakeAnchor;
  },
};
const outcome = E.triggerBlobDownload(new Blob(['{}'], { type: 'application/json' }), 'support.json', {
  document: fakeDocument,
  urlApi: fakeUrlApi,
  cleanupDelayMs: 0,
});
assert(outcome?.ok === true && outcome.name === 'support.json', JSON.stringify(outcome));
assert(events.some(event => event[0] === 'append'), JSON.stringify(events));
const clickEvent = events.find(event => event[0] === 'click');
assert(clickEvent?.[1] === true, `anchor must be attached when clicked: ${JSON.stringify(events)}`);
assert(clickEvent?.[2] === 'blob:tessa-support' && clickEvent?.[3] === 'support.json', JSON.stringify(clickEvent));
await new Promise(resolve => setTimeout(resolve, 5));
assert(events.some(event => event[0] === 'remove'), `anchor cleanup missing: ${JSON.stringify(events)}`);
assert(events.some(event => event[0] === 'revoke' && event[1] === 'blob:tessa-support'), `object URL cleanup missing: ${JSON.stringify(events)}`);

// The support button is a download action, not a dead link. It must remain usable after
// invalidatePlanStateAfterApply clears APP.plan by falling back to APP.lastSupportReport.
assert(code.includes('Скачать отчёт для поддержки'), 'support-report button must say that it downloads a file');
assert(code.includes('APP.lastSupportReport'), 'support report must survive preview invalidation after Apply');
assert(!code.includes("if (APP.busy || !APP.plan) return;\n      downloadJson(buildPreviewSupportReport"), 'support download must not be gated by APP.plan after Apply');

console.log('TESSA Matrix Studio privacy-safe support report + persistent browser download: OK');
