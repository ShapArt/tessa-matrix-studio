const { JSDOM } = require('jsdom');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
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
Object.defineProperty(w, 'crypto', { value: webcrypto });
w.alert = () => {};
w.confirm = () => true;

const createdBlobs = [];
let objectUrlSeq = 0;
w.URL.createObjectURL = blob => {
  createdBlobs.push(blob);
  return `blob:https://tessa.cherkizovsky.net/tms-${++objectUrlSeq}`;
};
w.URL.revokeObjectURL = () => {};
const anchorClicks = [];
w.HTMLAnchorElement.prototype.click = function click() {
  anchorClicks.push({ href: String(this.href || ''), download: String(this.download || ''), connected: Boolean(this.isConnected) });
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
  functions: [],
};
const currentFlat = { 'criterion:org': ['Организация А'] };
const snapshot = {
  matrixId: 'download-matrix',
  templateId: structure.templateId,
  rows: [{
    index: 0,
    rowCardId: 'row-1',
    versionId: 'version-1',
    fingerprint: E.fingerprintFlat(currentFlat),
    flat: currentFlat,
    values: { org: [{ id: 'org-a', display: 'Организация А' }] },
    roles: {},
  }],
};
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const plan = {
  matrixId: snapshot.matrixId,
  templateId: structure.templateId,
  matrixName: 'Download smoke matrix',
  structure,
  snapshot,
  columnMap: { columns: new Map([['org', { id: 'org', key: 'criterion:org', kind: 'criterion', name: 'Организация', excelHeader: 'Организация' }]]) },
  actions: [{
    type: 'update',
    excelRow: { excelRow: 15, flat: { 'criterion:org': ['<img src=x onerror=window.__xss=1>'] }, ids: { 'criterion:org': ['org-b'] } },
    currentRow: snapshot.rows[0],
    changes: [{ key: 'criterion:org', label: '<script>window.__xss=1</script>', before: ['Организация А'], after: ['<img src=x onerror=window.__xss=1>'] }],
  }],
  skippedRows: [], skippedFields: [], skippedValues: [], warnings: [],
  safety: { blocked: false, blockedReasons: [], matrixInfo: { matrixId: snapshot.matrixId, templateId: structure.templateId } },
  matrixInfo: { matrixId: snapshot.matrixId, templateId: structure.templateId },
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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
  U.APP.snapshot = snapshot;
  U.APP.dictionaryCatalog = catalog;
  U.APP.bridge = { matrixInfo: () => ({ matrixId: snapshot.matrixId, TemplateID: structure.templateId, Name: plan.matrixName }) };
  U.APP.review = E.createPlanReviewState();
  const uploaded = await E.createRoundtripXlsxBytes(structure, snapshot, U.APP.bridge.matrixInfo(), catalog);
  U.APP.selectedFileRef = {
    name: 'matrix-uploaded.xlsx',
    size: uploaded.byteLength,
    lastModified: 1,
    arrayBuffer: async () => uploaded.buffer.slice(uploaded.byteOffset, uploaded.byteOffset + uploaded.byteLength),
  };
  U.APP.plan = plan;
  U.renderPlan(plan);

  assert.equal(w.document.querySelector('#tms-plan script'), null, 'business label created a script element');
  assert.equal(w.document.querySelector('#tms-plan img'), null, 'business value created an image element');
  assert.equal(w.__xss, undefined, 'business value executed script');

  const filter = w.document.querySelector('button[data-preview-counter-filter="update"]');
  assert.ok(filter && !filter.disabled, 'update filter is unavailable');
  filter.click();
  assert.equal(filter.isConnected, false, 'render must replace the old filter node');
  assert.equal(w.document.querySelector('button[data-preview-counter-filter="update"]').getAttribute('aria-pressed'), 'true');
  w.document.querySelector('button[data-preview-counter-filter="update"]').click();
  assert.equal(w.document.querySelector('button[data-preview-counter-filter="update"]').getAttribute('aria-pressed'), 'false');

  const button = w.document.querySelector('#tms-download-package');
  assert.ok(button, 'real #tms-download-package control is missing');
  await waitFor(() => U.APP.supportBundleArtifact && !button.disabled, 10000, 'support package never became ready after Preview');
  button.click();
  await waitFor(() => anchorClicks.length === 1, 5000, 'one click did not start a browser download');
  assert.equal(anchorClicks.length, 1, 'download required or produced a second click');
  assert.match(anchorClicks[0].href, /^blob:/);
  assert.match(anchorClicks[0].download, /\.zip$/i);
  assert.equal(createdBlobs.length, 1, `expected one download Blob, got ${createdBlobs.length}`);
  const blob = createdBlobs[0];
  assert.equal(blob.type, 'application/zip');
  const entries = await E.unzipArrayBuffer(await blob.arrayBuffer());
  const required = [
    'excel/matrix-current.xlsx', 'excel/matrix-uploaded.xlsx', 'excel/changes.xlsx',
    'reports/summary.json', 'reports/preview.json', 'manifest.json', 'README.txt',
  ];
  required.forEach(name => assert.ok(entries.has(name), `${name} missing from support bundle`));
  const manifestText = new TextDecoder().decode(entries.get('manifest.json'));
  let manifest;
  try { manifest = JSON.parse(manifestText); }
  catch (error) { throw new Error(`manifest.json is not JSON: ${JSON.stringify(manifestText.slice(0, 160))}`, { cause: error }); }
  assert.equal(manifest.format, 'TESSA_MATRIX_SUPPORT_BUNDLE_V1');
  for (const file of manifest.files) {
    assert.equal(file.sha256, await E.sha256Hex(entries.get(file.path)), `${file.path}: SHA-256 mismatch`);
  }

  console.log(`TESSA support bundle DOM: one click, ${entries.size} verified files, filters and XSS boundary OK`);
  U.APP.runtimeMonitor?.stop?.();
  dom.window.close();
})().catch(error => {
  console.error(error);
  U?.APP?.runtimeMonitor?.stop?.();
  dom.window.close();
  process.exitCode = 1;
});
