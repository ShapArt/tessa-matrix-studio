import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE;
if (!sourcePath) throw new Error('TMS_TEST_SOURCE is required');
const source = fs.readFileSync(sourcePath, 'utf8');

const start = source.indexOf("(() => {\n  'use strict';\n\n  const INSTALL_KEY = '__TMS_FULL_UAT_V1__';");
assert.ok(start >= 0, 'Full UAT IIFE start not found');
const endMarker = "\n})();";
const end = source.indexOf(endMarker, start);
assert.ok(end > start, 'Full UAT IIFE end not found');
const uatSource = source.slice(start, end + endMarker.length);

let bridgeCreateCalls = 0;
let loadSnapshotCalls = 0;
const E = {
  STUDIO_ACTION_REGISTRY: [],
  studioVersion: () => '1.16.4',
  TessaBridge: {
    create: async () => {
      bridgeCreateCalls += 1;
      return {
        matrixInfo: () => ({ matrixId: 'm1', TemplateID: 't1', TemplateName: 'Test', StateName: 'Draft' }),
        templateId: () => 't1',
        requestStructure: async () => { throw new Error('structure must not be reached in read-only preflight'); },
        loadSnapshot: async () => { loadSnapshotCalls += 1; throw new Error('loadSnapshot must not run'); },
      };
    },
  },
  assertWritableMatrixDraft: () => true,
  assertNativeEditMode: () => { throw new Error('Матрица открыта только для просмотра.'); },
  makeZip: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
  triggerBlobDownload: () => {},
  downloadJson: () => {},
};

const context = {
  window: { __TESSA_MATRIX_SYNC_EXPORTS__: E },
  __TESSA_MATRIX_SYNC_TEST_MODE__: true,
  globalThis: null,
  location: { href: 'https://tessa.test/card' },
  document: {},
  console,
  TextEncoder,
  Uint8Array,
  Blob,
  setInterval: () => 0,
  clearInterval: () => {},
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(uatSource, context, { filename: 'full-uat-iife.js' });

const api = context.window.__TMS_FULL_UAT_V1__;
assert.ok(api?.runFullUat, 'Full UAT API not installed');
const report = await api.runFullUat({ seed: 2227287221, liveConfirmation: 'full-uat-confirmed' });

assert.equal(report.status, 'INCOMPLETE');
assert.equal(report.writesAttempted, 0);
assert.equal(report.writesCompleted, 0);
assert.equal(loadSnapshotCalls, 0, 'read-only preflight must never call loadSnapshot');
assert.equal(report.restoreProof?.status, 'NOT_REQUIRED');
assert.equal(report.restoreProof?.baselineEquivalent, null);
assert.equal(report.checks.find(x => x.id === 'final-restore-proof')?.status, 'NOT_RUN');
assert.equal(report.checks.find(x => x.id === 'action-apply')?.status, 'NOT_RUN');
assert.equal(report.checks.find(x => x.id === 'action-reconcile')?.status, 'NOT_RUN');
assert.match(report.fatalError || '', /только для просмотра/i);
assert.ok(bridgeCreateCalls >= 1);

console.log('v1.16.3 read-only preflight runtime regression: PASS');
