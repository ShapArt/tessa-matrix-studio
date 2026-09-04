import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

let anchorClicks = 0;
const downloads = [];
const blobs = new Map();
const elements = new Map([
  ['#tms-download-report', { id: 'tms-download-report', disabled: true, hidden: true }],
  ['#tms-refresh-view', { id: 'tms-refresh-view', disabled: true, hidden: true }],
  ['#tms-reconciliation-result', { dataset: {} }],
]);
const reportButton = elements.get('#tms-download-report');
globalThis.URL = {
  createObjectURL(blob) { const url = `blob:report-${blobs.size}`; blobs.set(url, blob); return url; },
  revokeObjectURL() {},
};
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = {
  body: { innerText: 'Завершить редактирование и разблокировать' },
  querySelector: selector => elements.get(selector) || null,
  querySelectorAll: () => [...elements.values()].filter(el => el.id),
  createElement: tag => tag === 'a'
    ? ({ click() { anchorClicks += 1; downloads.push({ url: this.href, name: this.download }); }, style: {} })
    : ({ click() {}, style: {}, set href(_) {}, set download(_) {} }),
};
const marker = '  bootstrap();';
assert(code.split(marker).length === 2, 'test hook must target bootstrap exactly once');
vm.runInThisContext(code.replace(marker,
  '  window.__reportTest = { APP, setBusy, renderPlanConsumedNotice }; bootstrap();'),
{ filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const { APP, setBusy, renderPlanConsumedNotice } = globalThis.__reportTest;
reportButton.click = () => { if (!reportButton.disabled) E.downloadLastReport(); };
assert(E.downloadLastReport() === false, 'no report must not create an empty download');
const O = E.constants.OPERAND;
const structure = {
  templateId: 'report-opt-in-template',
  conditions: [{ criterionRowId: 'criterion-org', criterionName: 'Организация', operandTypeId: O.ReferenceGuid, autocompleteViewName: 'QaOrganizationView', refSection: 'QaOrganizationView' }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};
const flat = { 'criterion:criterion-org': ['Организация 1'], 'function:function-sign': ['Сотрудник 1'] };
const current = {
  index: 0, rowCardId: 'card-1', versionId: 'version-1', fingerprint: E.fingerprintFlat(flat),
  values: { 'criterion-org': [{ id: 'org-1', display: 'Организация 1' }] },
  roles: { 'function-sign': [{ id: 'person-1', display: 'Сотрудник 1', roleTypeId: 'role-type' }] }, flat,
};
const snapshot = { matrixId: 'report-opt-in-matrix', templateId: structure.templateId, rows: [current], criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map() };
const matrixInfo = { matrixId: snapshot.matrixId, TemplateID: snapshot.templateId, TemplateName: 'Report Opt-in QA', StateName: 'Черновик', Name: 'Report Opt-in QA' };

const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, matrixInfo, catalog);
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'report-opt-in.xlsx');
const signerIndex = workbook.headers.indexOf('Подписание');
const signerIdIndex = workbook.headers.indexOf('Подписание__ID');
workbook.rows[0].values[signerIndex] = 'Сотрудник 2';
workbook.rows[0].values[signerIdIndex] = 'person-2|role-type';
const plan = E.buildPlan(workbook, structure, snapshot);
plan.safety = { blocked: false, blockedReasons: [] };

// Preview itself must be exportable before any write. The result is a compact snapshot
// of the reviewed plan, its skips, and current Apply availability; downloading stays opt-in.
assert(typeof E.buildPreviewReport === 'function', 'Preview report builder is not exported');
const previewReport = E.buildPreviewReport(plan, E.createPlanReviewState());
assert(previewReport.format === 'TESSA_MATRIX_PREVIEW_REPORT_V1', `unexpected preview report format: ${previewReport.format}`);
assert(previewReport.studioVersion === APP.version, 'preview report lost Studio version');
assert(previewReport.plan?.counts?.update === 1 && previewReport.plan?.counts?.skip === 0,
  `preview report counters are wrong: ${JSON.stringify(previewReport.plan?.counts)}`);
assert(previewReport.apply?.canApply === true && previewReport.apply?.count === 1,
  `preview report lost Apply availability: ${JSON.stringify(previewReport.apply)}`);
assert(Array.isArray(previewReport.skippedRows) && Array.isArray(previewReport.skippedFields),
  'preview report must expose row/field skips');
assert(code.includes('id="tms-download-report" hidden disabled>Скачать результат</button>'),
  'Preview result download must be visible next to the Check step after a plan exists');
assert(code.includes('rememberReport(buildPreviewReport(plan, APP.review),'),
  'rendered Preview must refresh the downloadable result for the current review state');

const bridge = {
  matrixInfo: () => matrixInfo,
  templateId: () => structure.templateId,
  requestStructure: async () => structure,
  loadSnapshot: async () => snapshot,
  resolveReferenceOnline: async () => null,
  resolveCriterion: (condition, display, id) => ({ id, display }),
  resolveRole: (fn, display, packedId) => { const [id, roleTypeId] = String(packedId || '').split('|'); return { id, display, roleTypeId: roleTypeId || 'role-type' }; },
  getCard: async rowCardId => ({ id: rowCardId }), rebuildRowCard: () => {}, validateDuplicate: async () => {}, assertCanCreateRows: () => {},
  storeRowCard: async card => ({ cardId: card?.id || 'card-1' }),
};
const originalCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => bridge;
let result;
setBusy(true);
try {
  result = await E.applyPlan(plan);
  E.invalidatePlanStateAfterApply(APP, result);
  renderPlanConsumedNotice(result);
} finally { E.TessaBridge.create = originalCreate; setBusy(false); }

assert(result?.status === 'completed', `expected completed Apply, got ${JSON.stringify(result)}`);
assert(anchorClicks === 0, `successful Apply must not auto-download JSON; got ${anchorClicks} automatic download(s)`);
assert(code.includes('id="tms-download-report"'), 'manual report download control is missing');
assert(!/downloadJson\(result,\s*`TESSA_Matrix_Apply_/.test(code), 'Apply result still auto-downloads JSON');
assert(!/downloadJson\(\{ app: \{ name: APP\.name/.test(code), 'caught Apply error still auto-downloads ErrorReport JSON');

// Exercise the actual busy -> rememberReport -> finally sequence. Previously,
// finally restored the initial disabled=true and stranded an existing report.
assert(!reportButton.hidden && !reportButton.disabled, 'completed Apply left its report button disabled');
reportButton.click();
assert(anchorClicks === 1, 'one explicit click must download the completed Apply report');
const downloaded = JSON.parse(await blobs.get(downloads[0].url).text());
assert(downloaded.status === result.status && downloaded.appliedCount === result.appliedCount, 'download lost the Apply result');
assert(downloads[0].name.startsWith('TESSA_Matrix_Apply_'), 'download lost its Apply filename');

for (const status of ['partial', 'cancelled', 'error']) {
  APP.lastReport = null;
  reportButton.hidden = true; reportButton.disabled = true;
  const value = { status, appliedCount: status === 'error' ? 0 : 11, requestedCount: 12, rows: [{ excelRow: 35, status: 'skipped', reason: 'test-reason' }] };
  const name = `TESSA_Matrix_${status}.json`;
  setBusy(true);
  E.rememberReport(value, name);
  assert(reportButton.disabled, 'report must remain disabled until the running operation finishes');
  const before = anchorClicks;
  setBusy(false);
  assert(!reportButton.hidden && !reportButton.disabled, `${status} report is inaccessible`);
  assert(anchorClicks === before, `${status} report downloaded without a click`);
  for (const reconciliation of [{ status: 'verified', checkedCount: 11, verifiedCount: 11 }, { status: 'incomplete', unknownCount: 11 }]) {
    setBusy(true);
    E.renderReconciliationResult(reconciliation);
    setBusy(false);
    assert(!reportButton.disabled, 'reconciliation stranded the Apply report');
    assert(APP.lastReport.value === value && APP.lastReport.name === name, 'reconciliation replaced the original report');
  }
  reportButton.click();
  assert(anchorClicks === before + 1, `${status} report did not download exactly once`);
  const last = downloads.at(-1);
  assert(last.name === name && JSON.stringify(JSON.parse(await blobs.get(last.url).text())) === JSON.stringify(value), 'downloaded report content/name changed');
}

const refreshButton = elements.get('#tms-refresh-view');
setBusy(true);
renderPlanConsumedNotice({ status: 'partial', appliedCount: 11, requestedCount: 12, viewRefresh: { ok: false, skipped: false } });
setBusy(false);
assert(!refreshButton.hidden && !refreshButton.disabled, 'failed auto-refresh stranded the manual refresh button');
setBusy(true);
renderPlanConsumedNotice({ status: 'completed', appliedCount: 1, success: true, viewRefresh: { ok: true } });
setBusy(false);
assert(refreshButton.hidden && refreshButton.disabled, 'successful refresh resurrected an unnecessary button');
assert(!JSON.stringify(APP.lastReport).includes('expectedSemanticKey'), 'private receipt leaked into a report');

console.log('TESSA Matrix Studio Preview/Apply diagnostic reports are opt-in and downloadable: OK');
