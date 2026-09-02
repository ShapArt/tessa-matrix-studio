import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.createPreviewViewState === 'function', 'createPreviewViewState is missing');
assert(typeof E.selectPreviewItems === 'function', 'selectPreviewItems is missing');
assert(typeof E.createPlanReviewState === 'function', 'createPlanReviewState is missing');
assert(typeof E.setPlanReviewRow === 'function', 'setPlanReviewRow is missing');
assert(typeof E.buildReviewedPlan === 'function', 'buildReviewedPlan is missing');

const actions = Array.from({ length: 120 }, (_, index) => ({
  type: index % 10 === 0 ? 'delete' : 'update',
  excelRow: { excelRow: index + 2, flat: { scenario: [`SCN-${String(index + 1).padStart(3, '0')}`] } },
  currentRow: { rowCardId: `card-${index}`, versionId: `version-${index}`, flat: {} },
  match: { matchedBy: 'identity', lowConfidence: false },
  changes: [{ key: 'scenario', label: 'Scenario', before: [`OLD-${index}`], after: [`SCN-${index + 1}`] }],
}));
const plan = {
  id: 'large-review-plan',
  actions,
  skippedRows: [
    { excelRow: 5001, reason: 'SCN-SKIP-001: намеренно невалидный справочник' },
    { excelRow: 5002, reason: 'SCN-SKIP-002: намеренно пустой исполнитель' },
  ],
  snapshot: { rows: actions.map(action => action.currentRow) },
  counts: { update: 108, add: 0, delete: 12, noop: 0, skip: 2 },
  safety: { blocked: false, blockedReasons: [] },
};
const review = E.createPlanReviewState();

// Page 3 must expose actions 81..120, not silently cap Preview at the first 40.
const page3 = E.selectPreviewItems(plan, review, E.createPreviewViewState({ page: 3, pageSize: 40 }));
assert(page3.total === 122, `large preview lost actions or skipped rows: total=${page3.total}`);
assert(page3.page === 3 && page3.pageCount === 4, `page metadata mismatch: ${JSON.stringify(page3)}`);
assert(page3.start === 81 && page3.end === 120, `page range mismatch: ${page3.start}-${page3.end}`);
assert(page3.items.length === 40, `expected 40 actions on page 3, got ${page3.items.length}`);
assert(page3.items.some(item => item.action?.excelRow?.excelRow === 101), 'Excel row 101 is not reviewable from page 3');
const page4 = E.selectPreviewItems(plan, review, { page: 4, pageSize: 40 });
assert(page4.items.length === 2 && page4.items.every(item => item.kind === 'skip'), 'All must keep the final skipped rows reachable');

// Type filtering must operate over the full plan before paging.
const deletes = E.selectPreviewItems(plan, review, E.createPreviewViewState({ filter: 'delete', pageSize: 40 }));
assert(deletes.total === 12, `delete filter expected 12, got ${deletes.total}`);
assert(deletes.items.every(item => item.action?.type === 'delete'), 'delete filter returned non-delete action');

// Search must find an action far beyond the old 40-row DOM limit.
const searched = E.selectPreviewItems(plan, review, E.createPreviewViewState({ query: 'SCN-100', pageSize: 40 }));
assert(searched.total === 1, `search expected one action, got ${searched.total}`);
assert(searched.items[0]?.action?.excelRow?.excelRow === 101, 'search resolved the wrong underlying action');

// Excluding a far-page action must use original action identity, not page-relative index.
const farAction = actions[99];
E.setPlanReviewRow(review, farAction, true);
const reviewed = E.buildReviewedPlan(plan, review);
assert(reviewed.actions[99].type === 'noop', 'far-page row exclusion did not suppress the original action');
assert(reviewed.actions[98].type === actions[98].type, 'far-page exclusion changed its neighbor');

// SKIP is also navigable/filterable as a first-class Preview item.
const skips = E.selectPreviewItems(plan, review, E.createPreviewViewState({ filter: 'skip', pageSize: 40 }));
assert(skips.total === 2 && skips.items.every(item => item.kind === 'skip'), `skip filter mismatch: ${JSON.stringify(skips)}`);

console.log('TESSA Matrix Studio large-plan Preview reviewability contract: OK');
