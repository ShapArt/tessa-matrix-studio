const { JSDOM } = require('jsdom');
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
w.alert = () => {};
w.confirm = () => true;

const created = [];
const revoked = [];
w.URL.createObjectURL = blob => {
  const url = `blob:https://tessa.cherkizovsky.net/package-${created.length + 1}`;
  created.push({ url, blob });
  return url;
};
w.URL.revokeObjectURL = url => revoked.push(String(url));
w.HTMLAnchorElement.prototype.click = () => {};

let source = fs.readFileSync(path.join(__dirname, '../tessa-matrix-studio.user.js'), 'utf8');
source = source.replace(
  'window.__TESSA_MATRIX_SYNC_EXPORTS__ = {',
  'window.__downloadLifecycleTest={APP,mountUi,resetFilePreview}; window.__TESSA_MATRIX_SYNC_EXPORTS__ = {',
);
w.eval(source);

const U = w.__downloadLifecycleTest;
const E = w.__TESSA_MATRIX_SYNC_EXPORTS__;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  U.mountUi();
  U.APP.runtimeMonitor?.stop?.();

  U.APP.supportBundleRequest = 4;
  U.APP.supportBundleArtifact = { key: 'old', bytes: new Uint8Array([1]), blob: new Blob(['old']) };
  U.APP.supportBundleBuild = { key: 'old', promise: Promise.resolve(null) };
  E.clearSupportBundleArtifact(U.APP);
  assert.equal(U.APP.supportBundleArtifact, null, 'superseded package bytes remained retained');
  assert.equal(U.APP.supportBundleBuild, null, 'superseded package build remained retained');
  assert.equal(U.APP.supportBundleRequest, 5, 'request generation was not invalidated');

  E.triggerBlobDownload(new Blob(['package'], { type: 'application/zip' }), 'package.zip', { cleanupDelayMs: 0 });
  assert.equal(created.length, 1, 'download did not create exactly one temporary Blob URL');
  await sleep(20);
  assert.deepEqual(revoked, [created[0].url], 'temporary Blob URL was not revoked after download');
  assert.equal(w.document.querySelectorAll('a[download]').length, 0, 'temporary download anchor remained in DOM');

  U.APP.supportBundleArtifact = { key: 'reset', bytes: new Uint8Array([2]), blob: new Blob(['reset']) };
  U.APP.supportBundleBuild = { key: 'reset', promise: Promise.resolve(null) };
  U.resetFilePreview();
  assert.equal(U.APP.supportBundleArtifact, null, 'file reset retained support package bytes');
  assert.equal(U.APP.supportBundleBuild, null, 'file reset retained support package build');

  console.log('TESSA support bundle lifecycle: generation invalidation, byte release and Blob URL cleanup OK');
  U.APP.runtimeMonitor?.stop?.();
  dom.window.close();
})().catch(error => {
  console.error(error);
  U?.APP?.runtimeMonitor?.stop?.();
  dom.window.close();
  process.exitCode = 1;
});
