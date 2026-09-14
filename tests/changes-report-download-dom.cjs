const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://tessa.cherkizovsky.net/test-matrix',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const w = dom.window;
w.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
w.TextEncoder = TextEncoder;
w.TextDecoder = TextDecoder;
w.Blob = Blob;
w.Response = Response;
w.CompressionStream = globalThis.CompressionStream;
w.DecompressionStream = globalThis.DecompressionStream;
w.alert = () => {};
w.confirm = () => true;

const createdBlobs = [];
const revokedUrls = [];
let objectUrlSeq = 0;
w.URL.createObjectURL = blob => {
  createdBlobs.push(blob);
  objectUrlSeq += 1;
  return `blob:https://tessa.cherkizovsky.net/tms-${objectUrlSeq}`;
};
w.URL.revokeObjectURL = url => revokedUrls.push(String(url));

let userActivation = false;
const anchorClicks = [];
w.HTMLAnchorElement.prototype.click = function click() {
  anchorClicks.push({
    active: userActivation,
    href: String(this.href || ''),
    download: String(this.download || ''),
    connected: Boolean(this.isConnected),
  });
};

let source = fs.readFileSync(path.join(__dirname, '../tessa-matrix-studio.user.js'), 'utf8');
source = source.replace(
  'window.__TESSA_MATRIX_SYNC_EXPORTS__ = {',
  'window.__downloadDomTest={APP,mountUi,renderPlan}; window.__TESSA_MATRIX_SYNC_EXPORTS__ = {',
);
w.eval(source);

const U = w.__downloadDomTest;
const E = w.__TESSA_MATRIX_SYNC_EXPORTS__;
assert.ok(U && E, 'test exports unavailable');

const structure = {
  templateId: 'download-template',
  conditions: [{ criterionRowId: 'org', criterionName: 'Организация', operandTypeId: E.constants.OPERAND.ReferenceGuid }],
  functions: [{ id: 'sign', name: 'Подписание', typeName: 'Подписание' }],
};
const plan = {
  matrixId: 'download-matrix',
  templateId: structure.templateId,
  matrixName: 'Download smoke matrix',
  actions: [
    {
      type: 'update',
      excelRow: { excelRow: 15, flat: { 'criterion:org': ['Орг Б'] } },
      currentRow: { index: 0, rowCardId: 'row-1', flat: { 'criterion:org': ['Орг А'] } },
      changes: [{ key: 'criterion:org', label: 'Организация', before: ['Орг А'], after: ['Орг Б'] }],
    },
  ],
  skippedRows: [],
  skippedFields: [],
  warnings: [],
  safety: { blocked: false, blockedReasons: [], matrixInfo: { matrixId: 'download-matrix', templateId: structure.templateId } },
  matrixInfo: { matrixId: 'download-matrix', templateId: structure.templateId },
};

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitFor(predicate, timeoutMs, message) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error(message);
}

(async () => {
  U.mountUi();
  U.APP.runtimeMonitor?.stop?.();
  U.APP.structure = structure;
  U.APP.plan = plan;
  U.APP.review = E.createPlanReviewState();
  U.renderPlan(plan);

  const button = w.document.querySelector('#tms-download-changes');
  assert.ok(button, 'real #tms-download-changes control is missing');
  await waitFor(() => !button.hidden && !button.disabled, 5000, 'changes download control never became ready after Preview');

  userActivation = true;
  button.click();
  userActivation = false;

  await waitFor(() => anchorClicks.length > 0, 5000, 'production download path never activated an anchor');
  const click = anchorClicks.at(-1);
  assert.equal(click.active, true, `download anchor was activated after the user gesture expired: ${JSON.stringify(click)}`);
  assert.match(click.href, /^blob:/, `download must use a blob URL: ${click.href}`);
  assert.match(click.download, /\.xlsx$/i, `download filename must be .xlsx: ${click.download}`);
  assert.ok(createdBlobs.length > 0, 'production path did not create a Blob');
  const blob = createdBlobs.at(-1);
  assert.ok(blob.size > 1000, `downloaded XLSX Blob is unexpectedly small: ${blob.size}`);
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  console.log(`TESSA changes download DOM contract: ${click.download}, ${blob.size} bytes, activation preserved`);
  U.APP.runtimeMonitor?.stop?.();
  dom.window.close();
})().catch(error => {
  console.error(error);
  U?.APP?.runtimeMonitor?.stop?.();
  dom.window.close();
  process.exitCode = 1;
});
