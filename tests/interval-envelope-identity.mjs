import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Trusted-actor touch: re-run the normal PR quality gate after the self-cleaning helper commit.
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const { S, F } = E.constants;

assert.equal(typeof E.applyCardNewEnvelopeProbe, 'function', 'CardNew envelope probe transformer is missing');
assert.equal(typeof E.summarizeCardIdentityTopology, 'function', 'privacy-safe card identity topology summary is missing');

const typed = (type, value) => ({ $__type: type, $__value: value });
const versionId = 'version-1';
const source = {
  ID: typed('uid', 'card-secret-id'),
  Version: typed('int', 1),
  Sections: {
    [S.MatrixRow]: {
      Fields: { TemplateID: typed('uid', 'template-secret-id') },
      '.changed': [typed('str', 'TemplateID')],
    },
    [S.Versions]: {
      Rows: [{ RowID: typed('uid', versionId), '.state': typed('int', 2), '.changed': [typed('str', 'LinkCount')], LinkCount: typed('int', 0) }],
    },
    [S.Values]: {
      Rows: [{ RowID: typed('uid', 'value-secret-id'), OwnerRowID: typed('uid', versionId), CriterionName: typed('str', 'Sensitive criterion'), IntValue: typed('int', 10), IntToValue: typed('int', 20), '.state': typed('int', 2), '.changed': [typed('str', 'IntValue')] }],
    },
    [S.Roles]: {
      Rows: [{ RowID: typed('uid', 'role-secret-id'), OwnerRowID: typed('uid', versionId), RoleName: typed('str', 'Sensitive Person'), RoleID: typed('uid', 'person-secret-id'), '.state': typed('int', 2), '.changed': [typed('str', 'RoleID')] }],
    },
  },
};

const envelope = structuredClone(source);
const transformed = E.applyCardNewEnvelopeProbe(envelope, 'clear-main-section-changed');
assert.equal(transformed, envelope, 'envelope transformer must mutate only the supplied detached storage');
assert.equal('.changed' in envelope.Sections[S.MatrixRow], false, 'main section .changed must be removed');
assert.deepEqual(envelope.Sections[S.MatrixRow].Fields, source.Sections[S.MatrixRow].Fields, 'main section fields changed');
assert.deepEqual(envelope.Sections[S.Versions], source.Sections[S.Versions], 'version rows changed');
assert.deepEqual(envelope.Sections[S.Values], source.Sections[S.Values], 'value rows changed');
assert.deepEqual(envelope.Sections[S.Roles], source.Sections[S.Roles], 'role rows changed');
assert.throws(() => E.applyCardNewEnvelopeProbe(structuredClone(source), 'unknown-mode'), /Неизвестный режим структурной диагностики/);

const summary = E.summarizeCardIdentityTopology(source, versionId);
assert.equal(summary.cardIdPresent, true);
assert.equal(summary.cardVersion, 1);
assert.equal(summary.mainSectionChanged, true);
assert.equal(summary.versionRowCount, 1);
assert.equal(summary.requestVersionMatchesVersionRow, true);
assert.equal(summary.ownerMismatchCount, 0);
assert.equal(summary.missingRowIdCount, 0);
assert.equal(summary.duplicateRowIdCount, 0);
assert.deepEqual(summary.rowCounts, { versions: 1, values: 1, roles: 1 });
const serializedSummary = JSON.stringify(summary);
for (const secret of ['card-secret-id', 'template-secret-id', 'value-secret-id', 'role-secret-id', 'person-secret-id', 'Sensitive criterion', 'Sensitive Person', versionId]) {
  assert.equal(serializedSummary.includes(secret), false, `identity summary leaked raw/business value: ${secret}`);
}

const broken = structuredClone(source);
broken.Sections[S.Versions].Rows[0].RowID = typed('uid', 'different-version');
broken.Sections[S.Values].Rows[0].OwnerRowID = typed('uid', 'wrong-owner');
broken.Sections[S.Roles].Rows[0].RowID = typed('uid', 'value-secret-id');
const brokenSummary = E.summarizeCardIdentityTopology(broken, versionId);
assert.equal(brokenSummary.requestVersionMatchesVersionRow, false);
assert.equal(brokenSummary.ownerMismatchCount, 2, 'both child rows should mismatch the sole version-row owner');
assert.equal(brokenSummary.duplicateRowIdCount, 1, 'cross-section duplicate RowID must be counted without exposing the ID');

// Integration contract: after every existing detached marker probe still returns the
// exact extractor failure, the same CardNew request payload gets one final envelope
// probe. Samples must also carry the privacy-safe identity topology summary.
assert(code.includes("'clear-main-section-changed'"), 'collector has no main-section envelope mode');
assert(code.includes("proposed-add-clear-main-section-changed"), 'collector does not wire the final envelope probe');
assert(code.includes('sample.identityTopology = summarizeCardIdentityTopology('), 'diagnostic samples do not include identity topology summary');
assert(code.includes('writesAttempted: 0'), 'interval diagnostics lost the explicit zero-write contract');

console.log('TESSA interval diagnosis: CardNew envelope probe + privacy-safe identity topology contract: OK');
