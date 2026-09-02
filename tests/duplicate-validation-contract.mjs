import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const summary = { innerHTML: '' };
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.document = {
  body: { innerText: '' }, querySelectorAll: () => [],
  querySelector: selector => selector === '#tms-summary' ? summary : null,
};
const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(code.replace('  bootstrap();',
  '  window.__duplicateTest = { runtimeSkip, renderPlanConsumedNotice }; bootstrap();'));
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;
const { runtimeSkip, renderPlanConsumedNotice } = window.__duplicateTest;
let response;
let request;
let requestCount = 0;
const bridge = Object.create(E.TessaBridge.prototype);
Object.assign(bridge, {
  cards: { CardRequest: class { constructor() { this.info = {}; } } },
  core: {
    TypedField: { createGuid: value => ({ value, type: 'Guid' }) },
    StorageHelper: { tryGet: (info, key) => info?.[key] },
  },
  mainCard: { id: 'matrix-id' }, templateId: () => 'template-id',
  cardService: { request: async value => { request = value; requestCount++; return response; } },
});
const storage = { sections: { typedValues: 'preserved' } };
const card = { getStorage: () => storage };
const successful = info => ({ validationResult: { isSuccessful: true }, info });
const check = () => bridge.validateDuplicate(card, 'version-id');

// An HTTP/platform success without a positive duplicate-check decision must
// never grant permission to Store. Native TESSA also treats missing ok as false.
for (const ok of [undefined, null, '', 'true', 'false', 0, 1, {}, []]) {
  response = successful(ok === undefined ? {} : { ok });
  await assert.rejects(check, /не подтвердила проверку дубликатов/, `accepted invalid ok=${String(ok)}`);
}
response = successful({ ok: false });
await assert.rejects(check, /дублирующую строку/);
response = successful({ ok: true });
await check();
assert.strictEqual(request.info.card, storage);
assert.deepEqual(request.info.versionId, { value: 'version-id', type: 'Guid' });
assert.deepEqual(request.info.matrixId, { value: 'matrix-id', type: 'Guid' });
assert.deepEqual(request.info.templateID, { value: 'template-id', type: 'Guid' });
assert.equal(request.requestType.toLowerCase(), 'f5c0419f-15cc-428e-b2f9-76c1b3ef7525');

// Platform errors take precedence even if info happens to contain ok=true.
response = {
  validationResult: { isSuccessful: false, build: () => 'LeftOperandExtractor is null <private-value>' },
  info: { ok: true },
};
let intervalError;
try { await check(); } catch (error) { intervalError = error; }
assert.ok(intervalError);
const beforeCount = requestCount;
const action = { type: 'add', excelRow: { excelRow: 37 } };
const failed = runtimeSkip(action, intervalError, 'store-add');
assert.equal(failed.code, 'duplicate-interval-extractor');
assert.equal(failed.check, 'duplicate');
assert.equal(failed.writeAttempted, false);
assert.match(failed.reason, /LeftOperandExtractor is null/);

// Preserve failures after the old Preview is cleared, including the one
// rejected at Preview time that does not belong to requestedCount.
const prior = runtimeSkip({ ...action, excelRow: { excelRow: 39 } }, intervalError, 'preflight-add');
const inputErrors = Array.from({ length: 41 }, (_, i) => ({ excelRow: 100 + i, source: 'excel-validation', reason: 'bad input' }));
renderPlanConsumedNotice({
  status: 'partial', appliedCount: 10, requestedCount: 11, sourceSkippedCount: 43,
  skipped: [...inputErrors, prior, failed], skippedFields: [],
});
assert.match(summary.innerHTML, /Не удалось выполнить: 2/);
assert.match(summary.innerHTML, /Excel 37/);
assert.match(summary.innerHTML, /Excel 39/);
assert.match(summary.innerHTML, /сравнить интервалы/);
assert.doesNotMatch(summary.innerHTML, /<private-value>|bad input/);
assert.equal(requestCount, beforeCount, 'rendering must not retry or write');

// Ordinary failures remain escaped; an unknown Store outcome must not be
// described as "not saved" or as "Store was not called".
const uncertain = runtimeSkip(action, new Error('<img src=x onerror=alert(1)>'), 'store-add');
assert.equal(uncertain.writeAttempted, undefined);
renderPlanConsumedNotice({ status: 'partial', skipped: [uncertain] });
assert.match(summary.innerHTML, /&lt;img/);
assert.doesNotMatch(summary.innerHTML, /<img|сохранение не запускалось/);
renderPlanConsumedNotice({ status: 'completed', success: true, skipped: inputErrors });
assert.doesNotMatch(summary.innerHTML, /Не удалось выполнить/);
console.log('TESSA duplicate-check contract and persistent failure diagnostics: OK');
