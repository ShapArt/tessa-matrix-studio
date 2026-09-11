import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.example.test' };
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

const add = { type:'add', excelRow:{ excelRow:15, flat:{}, ids:{} }, currentRow:null, changes:[], match:{ matchedBy:'cross-matrix-replace-add' } };
const del = { type:'delete', excelRow:null, currentRow:{ index:0, rowCardId:'row-1', versionId:'ver-1', fingerprint:'fp', flat:{} }, expectedFingerprint:'fp', changes:[], match:{ matchedBy:'cross-matrix-replace-delete' } };
const base = {
  actions:[add, del],
  skippedRows:[],
  skippedFields:[],
  snapshot:{ rows:[del.currentRow] },
  structure:{ conditions:[], functions:[] },
  crossMatrixReplacement:{ enabled:true },
  safety:{ blocked:false, blockedReasons:[], suppressUnsafePreview:false },
};
base.counts = E.countActions(base.actions, []);

const review = E.createPlanReviewState();
review.excludedRows.add(E.planReviewActionKey(add));
const reviewed = E.buildReviewedPlan(base, review);
assert.equal(reviewed.crossMatrixReplacement?.enabled, true);
assert.equal(reviewed.safety?.blocked, true, `reviewed replacement must be blocked: ${JSON.stringify(reviewed.safety)}`);
assert.match((reviewed.safety?.blockedReasons || []).join(' '), /полного переноса|исключ.*операц|частич/i);
assert.equal(E.applyAvailability(base, review).canApply, false, 'partial review must not expose Apply for full replacement');

const normal = { ...base, crossMatrixReplacement:null, safety:{ blocked:false, blockedReasons:[] } };
const normalReviewed = E.buildReviewedPlan(normal, review);
assert.equal(normalReviewed.safety?.blocked, false, 'ordinary matrix editing must keep selective review');
assert.equal(normalReviewed.actions.find(a => a.originalType === 'add')?.type, 'noop', 'ordinary ADD exclusion must remain supported');

console.log('TESSA Matrix Studio cross-matrix review stays atomic while ordinary selective review remains supported: OK');
