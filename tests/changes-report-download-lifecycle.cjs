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

const created = [];
const revoked = [];
let seq = 0;
w.URL.createObjectURL = blob => {
  const url = `blob:https://tessa.cherkizovsky.net/prepared-${++seq}`;
  created.push({ url, blob });
  return url;
};
w.URL.revokeObjectURL = url => revoked.push(String(url));

let source = fs.readFileSync(path.join(__dirname, '../tessa-matrix-studio.user.js'), 'utf8');
source = source.replace(
  'window.__TESSA_MATRIX_SYNC_EXPORTS__ = {',
  'window.__downloadLifecycleTest={APP,mountUi,renderPlan,resetFilePreview}; window.__TESSA_MATRIX_SYNC_EXPORTS__ = {',
);
w.eval(source);

const U = w.__downloadLifecycleTest;
const E = w.__TESSA_MATRIX_SYNC_EXPORTS__;
const structure = {
  templateId: 'download-template',
  conditions: [{ criterionRowId: 'org', criterionName: 'Организация', operandTypeId: E.constants.OPERAND.ReferenceGuid }],
  functions: [],
};
function plan(after) {
  return {
    matrixId: 'download-matrix', templateId: structure.templateId, matrixName: 'Download lifecycle',
    actions: [{
      type: 'update', excelRow: { excelRow: 15, flat: { 'criterion:org': [after] } },
      currentRow: { index: 0, rowCardId: 'row-1', flat: { 'criterion:org': ['Орг А'] } },
      changes: [{ key: 'criterion:org', label: 'Организация', before: ['Орг А'], after: [after] }],
    }],
    skippedRows: [], skippedFields: [], warnings: [],
    safety: { blocked: false, blockedReasons: [], matrixInfo: { matrixId: 'download-matrix', templateId: structure.templateId } },
    matrixInfo: { matrixId: 'download-matrix', templateId: structure.templateId },
  };
}
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
  U.APP.review = E.createPlanReviewState();

  const firstPlan = plan('Орг Б');
  U.APP.plan = firstPlan;
  U.renderPlan(firstPlan);
  await waitFor(() => created.length >= 1, 5000, 'Preview did not prepare a browser download artifact');
  const firstUrl = created[0].url;

  const secondPlan = plan('Орг В');
  U.APP.plan = secondPlan;
  U.renderPlan(secondPlan);
  await waitFor(() => created.length >= 2, 5000, 'updated Preview did not prepare a replacement artifact');
  assert.ok(revoked.includes(firstUrl), `superseded Preview object URL was not revoked: ${JSON.stringify({ firstUrl, revoked })}`);

  const secondUrl = created.at(-1).url;
  U.resetFilePreview();
  assert.ok(revoked.includes(secondUrl), `resetFilePreview did not revoke prepared URL: ${JSON.stringify({ secondUrl, revoked })}`);

  console.log('TESSA changes download lifecycle: prepared after Preview and superseded URLs revoked');
  U.APP.runtimeMonitor?.stop?.();
  dom.window.close();
})().catch(error => {
  console.error(error);
  U?.APP?.runtimeMonitor?.stop?.();
  dom.window.close();
  process.exitCode = 1;
});
