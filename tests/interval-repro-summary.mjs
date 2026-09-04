import assert from 'node:assert/strict';
import fs from 'node:fs';

const toolUrl = new URL('../tools/interval-repro-summary.mjs', import.meta.url);
assert.ok(fs.existsSync(toolUrl), 'privacy-safe interval repro summarizer is missing');

const { buildIntervalReproSummary } = await import(toolUrl);

const typed = (type, value) => ({ $__type: type, $__value: value });
const sampleCard = ({ id, version = 1, rowState, changed, roleName = 'Sensitive Person', businessName = 'Sensitive Business Value' }) => ({
  ID: typed('uid', id),
  Version: typed('int', version),
  CreatedByName: typed('str', 'Sensitive Author'),
  ModifiedByName: typed('str', 'Sensitive Author'),
  Sections: {
    MtxRouteMatrixRowVersions: {
      Rows: [{ RowID: typed('uid', 'version-row'), ...(rowState === undefined ? {} : { '.state': typed('int', rowState) }), ...(changed ? { '.changed': changed.map(v => typed('str', v)) } : {}) }],
    },
    MtxRouteMatrixRowVersionValues: {
      Rows: [{
        CriterionName: typed('str', 'Sensitive Criterion'),
        ReferenceValueName: typed('str', businessName),
        CriterionRowID: typed('uid', 'criterion-id'),
        OwnerRowID: typed('uid', 'version-row'),
        IntValue: typed('int', 801),
        IntToValue: typed('int', 809),
        ...(rowState === undefined ? {} : { '.state': typed('int', rowState) }),
        ...(changed ? { '.changed': changed.map(v => typed('str', v)) } : {}),
      }],
    },
    MtxRouteMatrixRowVersionRoles: {
      Rows: [{
        FunctionName: typed('str', 'Sensitive Function'),
        RoleName: typed('str', roleName),
        RoleID: typed('uid', 'role-id'),
        RoleTypeID: typed('int', 1),
        OwnerRowID: typed('uid', 'version-row'),
      }],
    },
  },
});

const extractorMessage = 'LeftOperandExtractor is null for Decimal(c4eada4d-eae7-406b-a75e-85d4ce23ae46) Integer(310ecb73-d554-42da-9f9d-7edc62a5d09f) Interval(36403a8f-b6ac-4c93-a953-a003de9b4670) Equality(329a0614-ddb1-4173-914d-c8f02919e347)';
const report = {
  format: 'TESSA_INTERVAL_DIAGNOSTICS_V1',
  studioVersion: '1.10.1',
  matrixId: 'sensitive-matrix-id',
  templateId: 'sensitive-template-id',
  writesAttempted: 0,
  containsBusinessData: true,
  samples: [
    {
      kind: 'saved-original', outcome: 'allowed', requestSent: true,
      request: { RequestType: typed('uid', 'duplicate-check'), Info: { card: sampleCard({ id: 'saved-card' }) } },
      response: { ValidationResult: { Items: null } },
    },
    {
      kind: 'saved-rebuilt', outcome: 'rejected', requestSent: true, code: 'duplicate-interval-extractor', message: extractorMessage,
      request: { RequestType: typed('uid', 'duplicate-check'), Info: { card: sampleCard({ id: 'saved-card', rowState: 3, changed: ['IntValue', 'IntToValue'] }) } },
      response: { ValidationResult: { Items: [{ Message: typed('str', extractorMessage) }] } },
    },
    {
      kind: 'proposed-add', outcome: 'rejected', requestSent: true, code: 'duplicate-interval-extractor', message: extractorMessage,
      request: { RequestType: typed('uid', 'duplicate-check'), Info: { card: sampleCard({ id: 'new-card', version: 0, rowState: 1, changed: ['IntValue', 'IntToValue'] }) } },
      response: { ValidationResult: { Items: [{ Message: typed('str', extractorMessage) }] } },
    },
  ],
};

const summary = buildIntervalReproSummary(report);
assert.equal(summary.format, 'TESSA_INTERVAL_REPRO_SUMMARY_V1');
assert.equal(summary.sourceFormat, 'TESSA_INTERVAL_DIAGNOSTICS_V1');
assert.equal(summary.writesAttempted, 0);
assert.equal(summary.samples.length, 3);
assert.deepEqual(summary.samples.map(sample => sample.kind), ['saved-original', 'saved-rebuilt', 'proposed-add']);
assert.deepEqual(summary.samples.map(sample => sample.outcome), ['allowed', 'rejected', 'rejected']);

const original = summary.samples[0];
const rebuilt = summary.samples[1];
assert.equal(original.card.version, 1);
assert.equal(rebuilt.card.version, 1);
assert.equal(original.sections.MtxRouteMatrixRowVersionValues.rowCount, 1);
assert.equal(rebuilt.sections.MtxRouteMatrixRowVersionValues.states['3'], 1);
assert.deepEqual(rebuilt.sections.MtxRouteMatrixRowVersionValues.changedFields, ['IntToValue', 'IntValue']);
assert.deepEqual(rebuilt.intervalShapes, [{ criterionIdPresent: true, hasFrom: true, hasTo: true, rowState: 3 }]);
assert.equal(rebuilt.validation.code, 'duplicate-interval-extractor');
assert.ok(rebuilt.validation.messageFingerprint.includes('LeftOperandExtractor is null'));
assert.ok(rebuilt.validation.messageFingerprint.includes('36403a8f-b6ac-4c93-a953-a003de9b4670'));

assert.ok(summary.diffs.some(diff => diff.left === 'saved-original' && diff.right === 'saved-rebuilt'));
const structuralDiff = summary.diffs.find(diff => diff.left === 'saved-original' && diff.right === 'saved-rebuilt');
assert.ok(structuralDiff.changedPaths.includes('sections.MtxRouteMatrixRowVersionValues.states.3'));
assert.ok(structuralDiff.changedPaths.includes('sections.MtxRouteMatrixRowVersionValues.changedFields'));

const serialized = JSON.stringify(summary);
for (const forbidden of [
  'Sensitive Person', 'Sensitive Business Value', 'Sensitive Author', 'Sensitive Criterion', 'Sensitive Function',
  'sensitive-matrix-id', 'sensitive-template-id', 'saved-card', 'new-card', 'role-id', 'version-row',
]) {
  assert.equal(serialized.includes(forbidden), false, `summary leaked sensitive/raw identity: ${forbidden}`);
}

console.log('TESSA interval repro summary: privacy-safe structural diff OK');
