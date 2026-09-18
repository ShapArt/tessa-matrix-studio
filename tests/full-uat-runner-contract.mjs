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
