import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Exercise the actual renderer with the live failure shape. No CardService is
// provided: displaying failures cannot retry a check or start a write.
class Element {
  constructor() { this.children = []; this.dataset = {}; this.classList = { add() {} }; }
  set innerHTML(value) { this.html = value; this.children = []; }
  get innerHTML() { return this.html || ''; }
  appendChild(child) { this.children.push(child); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}
const elements = new Map(['#tms-summary', '#tms-plan', '#tms-apply', '#tms-apply-section', '#tms-apply-note'].map(id => [id, new Element()]));
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.document = {
  body: { innerText: '' }, querySelector: id => elements.get(id) || null,
  querySelectorAll: () => [], createElement: () => new Element(),
};
const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source.replace('  bootstrap();', '  window.__skipPreviewTest = { APP, renderPlan }; bootstrap();'));
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;
const { APP, renderPlan } = window.__skipPreviewTest;
const skippedRows = [36, 37].map(excelRow => ({
  excelRow, source: 'preflight-add', code: 'duplicate-interval-extractor',
  check: 'duplicate', writeAttempted: false,
  reason: 'LeftOperandExtractor is null <img src=x onerror=alert(1)>',
}));
const plan = {
  id: 'only-skips', actions: Array.from({ length: 21 }, (_, i) => ({ type: 'noop', excelRow: { excelRow: i + 15 } })),
  skippedRows, counts: { noop: 21, update: 0, add: 0, delete: 0, skip: 2 },
  safety: { blocked: false, blockedReasons: [] }, warnings: [],
};
const review = E.createPlanReviewState();
const selected = E.selectPreviewItems(plan, review, { filter: 'all' });
assert.equal(selected.total, 2, 'All must expose rejected rows when nothing can be applied');
assert.deepEqual(selected.items.map(item => item.skip.excelRow), [36, 37]);
assert.equal(E.selectPreviewItems(plan, review, { filter: 'add' }).total, 0);
assert.equal(E.selectPreviewItems(plan, review, { filter: 'all', query: '37' }).total, 1);

Object.assign(APP, { plan, review, previewView: E.createPreviewViewState() });
const unchanged = JSON.stringify(plan);
renderPlan(plan);
assert.equal(elements.get('#tms-apply').disabled, true);
assert.match(elements.get('#tms-summary').innerHTML, /Нет изменений для применения/);
assert.doesNotMatch(elements.get('#tms-summary').innerHTML, /корректные изменения можно применить|LeftOperandExtractor/);
const cards = elements.get('#tms-plan').children.filter(e => e.className === 'tms-action tms-action-skip');
assert.equal(cards.length, 2, 'both rejected rows must be reachable without changing filter');
assert.ok(cards.every(e => e.open), 'short all-rejected plans show reasons immediately');
assert.ok(cards.every(e => /сравнить интервалы/.test(e.innerHTML)));
assert.ok(cards.every(e => /Технические подробности/.test(e.innerHTML)));
assert.ok(cards.every(e => !/<img|<details open/.test(e.innerHTML)), 'technical text stays escaped and collapsed');
assert.doesNotMatch(elements.get('#tms-plan').children[0].innerHTML, /data-review-package/, 'no package controls without source mutations');
assert.equal(JSON.stringify(plan), unchanged, 'rendering must not change the mutation plan');

// Mixed plans: All includes skips after mutations; paging/search/type filters
// remain consistent. Review and Apply must still select mutations only.
const add = { type: 'add', excelRow: { excelRow: 40, flat: {} }, changes: [] };
const mixed = { ...plan, actions: [...plan.actions, add], counts: { ...plan.counts, add: 1 } };
const page2 = E.selectPreviewItems(mixed, review, { filter: 'all', pageSize: 1, page: 2 });
assert.equal(page2.total, 3);
assert.equal(page2.items[0].skip.excelRow, 36);
assert.equal(E.selectPreviewItems(mixed, review, { filter: 'add' }).total, 1);
const packageReview = E.keepReviewedPackage(mixed, review, { filter: 'all', limit: 1 });
assert.equal(E.buildReviewedPlan(mixed, packageReview).actions.filter(a => a.type !== 'noop').length, 1);
APP.plan = mixed; APP.review = packageReview;
renderPlan(mixed);
assert.equal(elements.get('#tms-apply').disabled, false);
assert.match(elements.get('#tms-summary').innerHTML, /Доступно для применения: 1/);
assert.match(elements.get('#tms-summary').innerHTML, /Не удалось выполнить: 2/, 'mixed plans retain the operational-failure summary across pages');
E.setPlanReviewRow(packageReview, add, true);
renderPlan(mixed);
assert.equal(elements.get('#tms-apply').disabled, true);
assert.match(elements.get('#tms-plan').children[0].innerHTML, /data-review-package="reset"/, 'excluded mutations remain restorable');
console.log('TESSA preview with only skips, mixed paging and review isolation: OK');
