import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.example.test', href: 'https://tessa.example.test/matrix' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };

vm.runInThisContext(fs.readFileSync(process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const U = globalThis.__TMS_FULL_UAT_V1__;
assert.ok(U, 'Full UAT runner must be installed');
assert.equal(typeof U.runFullUat, 'function');
assert.equal(typeof U.runProductionShadowAudit, 'function', 'Full UAT must expose the production-shadow stress layer');
assert.equal(typeof U.installUi, 'function');
assert.equal(typeof E.makeZip, 'function', 'Full UAT must reuse the audited ZIP writer');
assert.equal(typeof U.actionCoverageFromChecks, 'function', 'Full UAT must expose action coverage audit');
const registry = E.STUDIO_ACTION_REGISTRY || [];
assert.equal(registry.length, 12, 'Full UAT action registry cardinality drifted');
const requiredActions = new Set(registry.map(item => item.id));
assert(requiredActions.has('apply'), 'Apply must remain a required Full UAT action');
assert(requiredActions.has('reconcile'), 'Reconcile must remain a required Full UAT action');
const syntheticActionChecks = registry.map(action => ({
  id: action.uatCheckId,
  status: 'PASS',
  detail: 'synthetic coverage proof',
  data: { outcome: action.outcome },
}));
const syntheticCoverage = U.actionCoverageFromChecks(syntheticActionChecks, registry);
assert.equal(syntheticCoverage.covered, registry.length, 'all registered actions must be coverable');
assert.deepEqual(syntheticCoverage.missing, [], 'complete action evidence must not produce a false FAILED status');
const runnerSource = fs.readFileSync(process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
if (/FULL_UAT_ACTION_COVERAGE_FINAL_V1/.test(runnerSource)) {
  assert.match(runnerSource, /addCheck\(\s*['"]action-apply['"]/,
    'composed Full UAT must emit an explicit Apply action-evidence check, not merely register the action');
  assert.match(runnerSource, /outcome:\s*applyOk\s*\?\s*['"]live-write-readback['"]/,
    'composed Full UAT Apply evidence must use the registry outcome after real writes');
  assert.match(runnerSource, /addCheck\(\s*['"]action-reconcile['"]/,
    'composed Full UAT must emit an explicit Reconcile action-evidence check, not merely register the action');
  assert.match(runnerSource, /await E\.runReconciliationRead\(/,
    'composed Full UAT Reconcile evidence must invoke the real reconciliation reader');
  assert.match(runnerSource, /outcome:\s*['"]reconciliation-readback['"]/,
    'composed Full UAT Reconcile evidence must use the registry outcome');
} else {
  assert.match(runnerSource, /['"]action-apply['"]/,
    'source Full UAT must retain the Apply registry contract before release transforms');
  assert.match(runnerSource, /['"]action-reconcile['"]/,
    'source Full UAT must retain the Reconcile registry contract before release transforms');
}
const a = U.seededRandom(0x12345678), b = U.seededRandom(0x12345678);
for (let i = 0; i < 20; i += 1) assert.equal(a(), b(), 'same seed must reproduce candidate choices');
const sigA = U.snapshotSignature({ rows: [{ rowCardId: 'b', fingerprint: '2' }, { rowCardId: 'a', fingerprint: '1' }] });
const sigB = U.snapshotSignature({ rows: [{ rowCardId: 'a', fingerprint: '1' }, { rowCardId: 'b', fingerprint: '2' }] });
assert.deepEqual(sigA, sigB, 'cleanup signature must ignore row ordering');
const shadow = await U.runProductionShadowAudit();
assert.equal(shadow.profile.sourceRows, 488);
assert.equal(shadow.profile.targetRows, 103);
assert.equal(shadow.profile.observedIssueOccurrences, 2386);
assert.equal(shadow.metrics.dictionaryEntries, shadow.profile.syntheticOrganizationEntries + shadow.profile.syntheticEmployeeEntries);
assert.equal(shadow.metrics.operationCount, 591);
assert.ok(shadow.observedProfile, 'production-shadow must replay the observed PROD issue envelope');
assert.equal(shadow.observedProfile.sourceRows, 488);
assert.equal(shadow.observedProfile.targetRows, 103);
assert.equal(shadow.observedProfile.resolution.skippedRows, 478);
assert.equal(shadow.observedProfile.resolution.issueOccurrences, 2386);
assert.deepEqual(shadow.observedProfile.resolution.categories, {
  notFound: 2168,
  positionOnly: 172,
  ambiguous: 45,
  noPerformers: 1,
  other: 0,
});
assert.equal(shadow.observedProfile.resolution.maxIssuesPerRow, 21);
assert.equal(shadow.observedProfile.resolution.autoUniqueFragment, 239);
assert.equal(shadow.observedProfile.resolution.fields['Организация ГЧ ✅'].total, 670);
assert.equal(shadow.observedProfile.resolution.fields['Обязательные'].total, 550);
assert.equal(shadow.observedProfile.resolution.fields['Подписание'].total, 468);
assert.equal(shadow.assertions.staleEmployeeTitleResolvedByFio, true);
assert.equal(shadow.assertions.previousSelectorMigration, true, 'historical PROD aliases must resolve to the current canonical dictionary item');
assert.equal(shadow.assertions.observedIssueEnvelopeExact, true);
assert.equal(shadow.assertions.namesakeFailClosed, true);
assert.equal(shadow.assertions.positionOnlyFailClosed, true);
assert.equal(shadow.assertions.crossMatrixScale, true);
assert.equal(shadow.assertions.schemaDrift, true);
assert.equal(U.installUi(), undefined, 'test mode must never inject or click live UI');
console.log(`TESSA Matrix Studio Full UAT runner + production-shadow contract: OK (${shadow.metrics.dictionaryEntries} dictionary entries, 488→103, ${shadow.metrics.totalMs}ms)`);
