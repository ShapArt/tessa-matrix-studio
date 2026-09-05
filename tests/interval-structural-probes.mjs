import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Diagnostic transformers are pure with respect to the SDK Card: tests always clone
// detached request storage first and assert only the intended structural marker moves.
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(code);
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;
assert.equal(typeof E.applyIntervalStructuralProbe, 'function', 'interval structural probe transformer is missing');
assert.equal(typeof E.applyCardNewTopologyProbe, 'function', 'CardNew topology probe transformer is missing');

const typed = (type, value) => ({ $__type: type, $__value: value });
const intervalRow = {
  RowID: typed('uid', 'interval-row'),
  '.state': typed('int', 2),
  '.changed': ['OwnerRowID', 'CriterionRowID', 'CriterionName', 'IntValue', 'IntToValue'].map(v => typed('str', v)),
  OwnerRowID: typed('uid', 'version-row'),
  CriterionRowID: typed('uid', 'criterion-id'),
  CriterionName: typed('str', 'Sensitive interval criterion'),
  IntValue: typed('int', 801),
  IntToValue: typed('int', 809),
};
const referenceRow = {
  RowID: typed('uid', 'reference-row'),
  '.state': typed('int', 2),
  '.changed': ['ReferenceValueID'].map(v => typed('str', v)),
  CriterionName: typed('str', 'Sensitive reference criterion'),
  // Real TESSA value-row storage contains all typed value fields. Non-applicable
  // numeric fields are present as null, so field presence alone must NOT classify
  // this reference row as an interval row.
  IntValue: null,
  IntToValue: null,
  DecimalValue: null,
  DecimalToValue: null,
  ReferenceValueID: typed('uid', 'reference-id'),
  ReferenceValueName: typed('str', 'Sensitive business value'),
};
const roleRow = {
  '.state': typed('int', 2),
  '.changed': [typed('str', 'RoleID')],
  RoleName: typed('str', 'Sensitive Person'),
};
const versionRow = {
  '.state': typed('int', 2),
  '.changed': [typed('str', 'LinkCount')],
  LinkCount: typed('int', 0),
};
const source = {
  Sections: {
    MtxRouteMatrixRowVersionValues: { Rows: [structuredClone(intervalRow), structuredClone(referenceRow)] },
    MtxRouteMatrixRowVersionRoles: { Rows: [structuredClone(roleRow)] },
    MtxRouteMatrixRowVersions: { Rows: [structuredClone(versionRow)] },
  },
};

function variant(mode) {
  const value = structuredClone(source);
  const result = E.applyIntervalStructuralProbe(value, mode);
  assert.equal(result, value, 'transformer should mutate only the detached outgoing request storage');
  return value;
}

const noChanged = variant('clear-interval-changed');
assert.equal('.changed' in noChanged.Sections.MtxRouteMatrixRowVersionValues.Rows[0], false);
assert.deepEqual(noChanged.Sections.MtxRouteMatrixRowVersionValues.Rows[0]['.state'], intervalRow['.state']);
assert.deepEqual(noChanged.Sections.MtxRouteMatrixRowVersionValues.Rows[1], referenceRow, 'non-interval value row changed');
assert.deepEqual(noChanged.Sections.MtxRouteMatrixRowVersionRoles, source.Sections.MtxRouteMatrixRowVersionRoles, 'role rows changed');
assert.deepEqual(noChanged.Sections.MtxRouteMatrixRowVersions, source.Sections.MtxRouteMatrixRowVersions, 'version rows changed');

const noState = variant('clear-interval-state');
assert.equal('.state' in noState.Sections.MtxRouteMatrixRowVersionValues.Rows[0], false);
assert.deepEqual(noState.Sections.MtxRouteMatrixRowVersionValues.Rows[0]['.changed'], intervalRow['.changed']);
assert.deepEqual(noState.Sections.MtxRouteMatrixRowVersionValues.Rows[1], referenceRow);

const noMarkers = variant('clear-interval-markers');
assert.equal('.state' in noMarkers.Sections.MtxRouteMatrixRowVersionValues.Rows[0], false);
assert.equal('.changed' in noMarkers.Sections.MtxRouteMatrixRowVersionValues.Rows[0], false);
assert.deepEqual(noMarkers.Sections.MtxRouteMatrixRowVersionValues.Rows[0].IntValue, intervalRow.IntValue);
assert.deepEqual(noMarkers.Sections.MtxRouteMatrixRowVersionValues.Rows[0].IntToValue, intervalRow.IntToValue);
assert.deepEqual(noMarkers.Sections.MtxRouteMatrixRowVersionValues.Rows[0].CriterionRowID, intervalRow.CriterionRowID);
assert.deepEqual(noMarkers.Sections.MtxRouteMatrixRowVersionValues.Rows[1], referenceRow);

const lower = {
  sections: {
    MtxRouteMatrixRowVersionValues: {
      rows: [
        { state: 2, data: { IntValue: 1, IntToValue: 2, keep: 'yes' } },
        { state: 2, data: { IntValue: null, IntToValue: null, ReferenceValueID: 'id', keep: 'also' } },
      ],
    },
  },
};
E.applyIntervalStructuralProbe(lower, 'clear-interval-state');
assert.equal('state' in lower.sections.MtxRouteMatrixRowVersionValues.rows[0], false, 'SDK-like lower-case row state was not cleared');
assert.equal(lower.sections.MtxRouteMatrixRowVersionValues.rows[0].data.keep, 'yes');
assert.equal(lower.sections.MtxRouteMatrixRowVersionValues.rows[1].state, 2, 'non-interval SDK-like row was changed');

// CardNew topology probes are deliberately broader than the interval-row probes, but
// every mode still changes exactly one structural family on detached request storage.
function topologyVariant(mode) {
  const value = structuredClone(source);
  const result = E.applyCardNewTopologyProbe(value, mode);
  assert.equal(result, value, 'topology transformer should mutate only detached request storage');
  return value;
}

const noVersionChanged = topologyVariant('clear-version-changed');
assert.equal('.changed' in noVersionChanged.Sections.MtxRouteMatrixRowVersions.Rows[0], false);
assert.deepEqual(noVersionChanged.Sections.MtxRouteMatrixRowVersions.Rows[0]['.state'], versionRow['.state']);
assert.deepEqual(noVersionChanged.Sections.MtxRouteMatrixRowVersionValues, source.Sections.MtxRouteMatrixRowVersionValues);
assert.deepEqual(noVersionChanged.Sections.MtxRouteMatrixRowVersionRoles, source.Sections.MtxRouteMatrixRowVersionRoles);

const noVersionState = topologyVariant('clear-version-state');
assert.equal('.state' in noVersionState.Sections.MtxRouteMatrixRowVersions.Rows[0], false);
assert.deepEqual(noVersionState.Sections.MtxRouteMatrixRowVersions.Rows[0]['.changed'], versionRow['.changed']);

const noVersionMarkers = topologyVariant('clear-version-markers');
assert.equal('.state' in noVersionMarkers.Sections.MtxRouteMatrixRowVersions.Rows[0], false);
assert.equal('.changed' in noVersionMarkers.Sections.MtxRouteMatrixRowVersions.Rows[0], false);

const noNonIntervalMarkers = topologyVariant('clear-noninterval-markers');
assert.deepEqual(noNonIntervalMarkers.Sections.MtxRouteMatrixRowVersionValues.Rows[0], intervalRow, 'actual interval row must stay untouched');
assert.equal('.state' in noNonIntervalMarkers.Sections.MtxRouteMatrixRowVersionValues.Rows[1], false);
assert.equal('.changed' in noNonIntervalMarkers.Sections.MtxRouteMatrixRowVersionValues.Rows[1], false);
assert.equal('.state' in noNonIntervalMarkers.Sections.MtxRouteMatrixRowVersionRoles.Rows[0], false);
assert.equal('.changed' in noNonIntervalMarkers.Sections.MtxRouteMatrixRowVersionRoles.Rows[0], false);
assert.deepEqual(noNonIntervalMarkers.Sections.MtxRouteMatrixRowVersions.Rows[0], versionRow, 'version row must stay untouched');

const noAllMarkers = topologyVariant('clear-all-row-markers');
for (const sectionName of ['MtxRouteMatrixRowVersions', 'MtxRouteMatrixRowVersionValues', 'MtxRouteMatrixRowVersionRoles']) {
  for (const row of noAllMarkers.Sections[sectionName].Rows) {
    assert.equal('.state' in row, false, `${sectionName} retained .state`);
    assert.equal('.changed' in row, false, `${sectionName} retained .changed`);
  }
}
assert.deepEqual(noAllMarkers.Sections.MtxRouteMatrixRowVersionValues.Rows[0].IntValue, intervalRow.IntValue);
assert.deepEqual(noAllMarkers.Sections.MtxRouteMatrixRowVersionValues.Rows[0].IntToValue, intervalRow.IntToValue);

const lowerTopology = {
  sections: {
    MtxRouteMatrixRowVersions: { rows: [{ state: 2, changed: ['LinkCount'], data: { '.state': 2, '.changed': ['LinkCount'], keep: 'version' } }] },
    MtxRouteMatrixRowVersionValues: { rows: [
      { state: 2, changed: ['IntValue'], data: { IntValue: 1, IntToValue: 2, keep: 'interval' } },
      { state: 2, changed: ['ReferenceValueID'], data: { IntValue: null, IntToValue: null, ReferenceValueID: 'id', keep: 'reference' } },
    ] },
    MtxRouteMatrixRowVersionRoles: { rows: [{ state: 2, changed: ['RoleID'], data: { RoleID: 'role', keep: 'role' } }] },
  },
};
E.applyCardNewTopologyProbe(lowerTopology, 'clear-all-row-markers');
for (const section of Object.values(lowerTopology.sections)) {
  for (const row of section.rows) {
    assert.equal('state' in row, false);
    assert.equal('changed' in row, false);
    assert.equal('.state' in row.data, false);
    assert.equal('.changed' in row.data, false);
  }
}
assert.equal(lowerTopology.sections.MtxRouteMatrixRowVersionValues.rows[0].data.keep, 'interval');
assert.equal(lowerTopology.sections.MtxRouteMatrixRowVersionValues.rows[1].data.keep, 'reference');

assert.throws(() => E.applyIntervalStructuralProbe(structuredClone(source), 'unknown-mode'), /Неизвестный режим структурной диагностики/);
assert.throws(() => E.applyCardNewTopologyProbe(structuredClone(source), 'unknown-mode'), /Неизвестный режим структурной диагностики/);
assert.deepEqual(source.Sections.MtxRouteMatrixRowVersionValues.Rows[0], intervalRow, 'source fixture was unexpectedly changed between variants');

console.log('TESSA interval structural probes: precise interval + CardNew topology transforms OK');
