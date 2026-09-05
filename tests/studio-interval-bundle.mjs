import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};

const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source.replace('  bootstrap();', '  window.__studioIntervalBundleTests = { unzipArrayBuffer }; bootstrap();'));
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

assert.equal(typeof E.resolveStudioIntervalDiagnostics, 'function', 'Studio interval resolver is missing');
assert.equal(typeof E.buildIntervalDiagnosticSummary, 'function', 'interval summary builder is missing');
assert.match(source, /await resolveStudioIntervalDiagnostics\(/, 'runStudioDiagnostics does not auto-resolve interval diagnostics');

const intervalReport = {
  format: 'TESSA_INTERVAL_DIAGNOSTICS_V1',
  studioVersion: '1.11.3',
  scope: 'read-only',
  writesAttempted: 0,
  interrupted: false,
  samples: [
    {
      kind: 'proposed-add',
      outcome: 'rejected',
      code: 'duplicate-interval-extractor',
      reason: 'LeftOperandExtractor is null — Sensitive Person',
      request: { info: { card: { RoleName: 'Sensitive Person', ID: 'secret-guid' } } },
      identityTopology: {
        cardIdPresent: true,
        cardVersion: 1,
        mainSectionChanged: true,
        versionRowCount: 1,
        requestVersionMatchesVersionRow: true,
        ownerMismatchCount: 0,
        ownerMissingCount: 0,
        missingRowIdCount: 0,
        duplicateRowIdCount: 0,
        rowCounts: { versions: 1, values: 2, roles: 1 },
        markerCounts: { state: 4, changed: 4 },
      },
    },
    {
      kind: 'proposed-add-clear-main-section-changed',
      structuralMode: 'clear-main-section-changed',
      outcome: 'allowed',
      code: null,
      request: { businessValue: 'TOP SECRET' },
      identityTopology: { mainSectionChanged: false },
    },
  ],
};

const plan = { skippedRows: [{ excelRow: 16, code: 'duplicate-interval-extractor', reason: 'raw server message' }] };
let collectCalls = 0;
const options = {
  plan,
  workbook: { fileName: 'matrix.xlsx' },
  structure: { templateId: 'template' },
  snapshot: { rows: [] },
  cached: null,
  assertContext: async () => {},
  createBridge: async () => ({ kind: 'bridge' }),
  collect: async args => {
    collectCalls++;
    assert.equal(args.failedRows, plan.skippedRows);
    assert.equal(args.workbook.fileName, 'matrix.xlsx');
    return structuredClone(intervalReport);
  },
};

const fresh = await E.resolveStudioIntervalDiagnostics(options);
assert.equal(collectCalls, 1, 'fresh resolver did not run exactly one interval collector');
assert.equal(fresh.reused, false);
assert.equal(fresh.cacheable, true);
assert.equal(fresh.value.writesAttempted, 0);

const reused = await E.resolveStudioIntervalDiagnostics({ ...options, cached: fresh });
assert.equal(collectCalls, 1, 'cached interval diagnostics reran server probes');
assert.equal(reused.reused, true);
assert.equal(reused.value, fresh.value);

const notNeeded = await E.resolveStudioIntervalDiagnostics({ ...options, plan: { skippedRows: [] }, cached: null });
assert.equal(notNeeded, null);
assert.equal(collectCalls, 1, 'resolver ran without duplicate-interval-extractor');

const summary = E.buildIntervalDiagnosticSummary(intervalReport);
assert.equal(summary.format, 'TESSA_INTERVAL_SUMMARY_V1');
assert.equal(summary.scope, 'read-only');
assert.equal(summary.writesAttempted, 0);
assert.deepEqual(summary.samples.map(item => [item.kind, item.outcome, item.code, item.structuralMode || null]), [
  ['proposed-add', 'rejected', 'duplicate-interval-extractor', null],
  ['proposed-add-clear-main-section-changed', 'allowed', null, 'clear-main-section-changed'],
]);
assert.equal(summary.samples[0].identityTopology.mainSectionChanged, true);
assert.equal(summary.samples[1].identityTopology.mainSectionChanged, false);
const summaryText = JSON.stringify(summary);
for (const secret of ['Sensitive Person', 'TOP SECRET', 'secret-guid', 'LeftOperandExtractor is null', 'raw server message']) {
  assert.equal(summaryText.includes(secret), false, `interval summary leaked raw/business value: ${secret}`);
}

const packageInput = {
  report: { format: 'TESSA_STUDIO_DIAGNOSTICS_V1', studioVersion: '1.11.3', startedAt: '2026-09-05T00:00:00.000Z', checks: [], omitted: [] },
  entries: [['existing.json', new TextEncoder().encode('{"ok":true}')]],
  intervalDiagnostics: fresh,
};
const zip = await E.makeStudioDiagnosticPackage(packageInput);
const parts = await window.__studioIntervalBundleTests.unzipArrayBuffer(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength));
assert.ok(parts.has('interval/TESSA_Interval_Diagnostics.json'), 'full interval diagnostic is missing from Studio ZIP');
assert.ok(parts.has('interval/interval-summary.json'), 'privacy-safe interval summary is missing from Studio ZIP');
const bundledSummary = JSON.parse(new TextDecoder().decode(parts.get('interval/interval-summary.json')));
assert.deepEqual(bundledSummary, summary);
const bundledRaw = JSON.parse(new TextDecoder().decode(parts.get('interval/TESSA_Interval_Diagnostics.json')));
assert.equal(bundledRaw.samples[0].request.info.card.RoleName, 'Sensitive Person', 'explicit full diagnostic unexpectedly sanitized');

console.log('TESSA Studio diagnostics bundle: automatic interval resolver, cache reuse, privacy-safe summary and full ZIP evidence: OK');
