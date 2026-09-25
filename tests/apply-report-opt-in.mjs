import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.Element = class Element {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert.equal(typeof E.buildPreviewReport, 'function');
assert.equal(typeof E.buildApplySupportReport, 'function');
assert.equal(typeof E.prepareSupportBundle, 'function');

const plan = {
  id: 'report-plan', matrixId: 'matrix-id', templateId: 'template-id',
  actions: [{ type: 'update', excelRow: { excelRow: 15 }, currentRow: { index: 0 }, changes: [] }],
  skippedRows: [], skippedFields: [], skippedValues: [], warnings: [],
  counts: { update: 1, add: 0, delete: 0, noop: 0, skip: 0 },
  safety: { blocked: false, blockedReasons: [] },
};
const preview = E.buildPreviewReport(plan, E.createPlanReviewState());
assert.equal(preview.format, 'TESSA_MATRIX_PREVIEW_REPORT_V1');
assert.equal(preview.plan.counts.update, 1);
assert.equal(preview.apply.canApply, true);

const apply = E.buildApplySupportReport({
  planId: plan.id,
  status: 'completed', success: true, partial: false,
  requestedCount: 1, plannedCount: 1, startedCount: 1, appliedCount: 1,
  skippedCount: 0, failedCount: 0, notStartedCount: 0,
  rows: [{ type: 'update', excelRow: 15, status: 'ok', expectedSemanticKey: 'private-secret' }],
}, {}, E.version);
assert.equal(apply.format, 'TESSA_MATRIX_SUPPORT_REPORT_V1');
assert.equal(apply.apply.status, 'completed');
assert.ok(!JSON.stringify(apply).includes('expectedSemanticKey'), 'private receipt leaked into apply report');
assert.ok(!JSON.stringify(apply).includes('private-secret'), 'private receipt value leaked into apply report');

assert.match(code, /id="tms-download-package" hidden disabled>Скачать пакет<\/button>/);
assert.doesNotMatch(code, /id="tms-download-report"/, 'obsolete Apply JSON button must be removed');
assert.doesNotMatch(code, /id="tms-download-support-report"/, 'obsolete support JSON button must be removed');
assert.doesNotMatch(code, /downloadJson\(result,\s*`TESSA_Matrix_Apply_/, 'Apply must not auto-download JSON');
assert.match(code, /supportBundleContext[\s\S]*applyResult:\s*result/, 'Apply must preserve context for the post-Apply package');
assert.match(code, /refreshSupportBundleAfterApply\(/, 'Apply must rebuild the package from a post-write snapshot');

const structure = {
  templateId: 'bundle-template',
  conditions: [{ criterionRowId: 'org', criterionName: 'Организация', operandTypeId: E.constants.OPERAND.ReferenceGuid }],
  functions: [],
};
const flat = { 'criterion:org': ['Организация А'] };
const snapshot = {
  matrixId: 'bundle-matrix', templateId: structure.templateId,
  rows: [{ index: 0, rowCardId: 'row-a', versionId: 'version-a', flat, fingerprint: E.fingerprintFlat(flat), values: { org: [{ id: 'org-a', display: 'Организация А' }] }, roles: {} }],
};
const matrixInfo = { matrixId: snapshot.matrixId, TemplateID: structure.templateId, Name: 'Bundle regression' };
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const uploaded = await E.createRoundtripXlsxBytes(structure, snapshot, matrixInfo, catalog);
const workbook = await E.readXlsxArrayBuffer(uploaded.buffer.slice(uploaded.byteOffset, uploaded.byteOffset + uploaded.byteLength), 'bundle-uploaded.xlsx');
const bundlePlan = E.buildPlan(workbook, structure, snapshot, matrixInfo);
const selectedFile = {
  name: 'bundle-uploaded.xlsx', size: uploaded.byteLength, lastModified: 0,
  arrayBuffer: async () => uploaded.buffer.slice(uploaded.byteOffset, uploaded.byteOffset + uploaded.byteLength),
};
const artifact = await E.prepareSupportBundle(bundlePlan, E.createPlanReviewState(), {
  plan: bundlePlan, review: E.createPlanReviewState(), structure, snapshot, selectedFile,
  dictionaryCatalog: catalog, bridge: { matrixInfo: () => matrixInfo }, matrixInfo,
});
assert.ok(artifact?.bytes instanceof Uint8Array, 'detached Full UAT context must produce a ZIP artifact');
const bundleEntries = await E.unzipArrayBuffer(artifact.bytes.buffer.slice(artifact.bytes.byteOffset, artifact.bytes.byteOffset + artifact.bytes.byteLength));
for (const required of ['excel/matrix-current.xlsx', 'excel/matrix-uploaded.xlsx', 'excel/changes.xlsx', 'manifest.json']) {
  assert.ok(bundleEntries.has(required), `detached support bundle missing ${required}`);
}
E.releaseWorkbookArchive(workbook);

console.log('TESSA Matrix Studio Preview/Apply reports are consolidated into the opt-in support ZIP: OK');
