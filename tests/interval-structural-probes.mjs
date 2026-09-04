import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(code);
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;
assert.equal(typeof E.applyIntervalStructuralProbe, 'function', 'interval structural probe transformer is missing');

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
  ReferenceValueID: typed('uid', 'reference-id'),
  ReferenceValueName: typed('str', 'Sensitive business value'),
};
const source = {
  Sections: {
    MtxRouteMatrixRowVersionValues: { Rows: [structuredClone(intervalRow), structuredClone(referenceRow)] },
    MtxRouteMatrixRowVersionRoles: { Rows: [{ '.state': typed('int', 2), '.changed': [typed('str', 'RoleID')], RoleName: typed('str', 'Sensitive Person') }] },
    MtxRouteMatrixRowVersions: { Rows: [{ '.state': typed('int', 2), '.changed': [typed('str', 'LinkCount')], LinkCount: typed('int', 0) }] },
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
        { state: 2, data: { ReferenceValueID: 'id', keep: 'also' } },
      ],
    },
  },
};
E.applyIntervalStructuralProbe(lower, 'clear-interval-state');
assert.equal('state' in lower.sections.MtxRouteMatrixRowVersionValues.rows[0], false, 'SDK-like lower-case row state was not cleared');
assert.equal(lower.sections.MtxRouteMatrixRowVersionValues.rows[0].data.keep, 'yes');
assert.equal(lower.sections.MtxRouteMatrixRowVersionValues.rows[1].state, 2, 'non-interval SDK-like row was changed');

assert.throws(() => E.applyIntervalStructuralProbe(structuredClone(source), 'unknown-mode'), /Неизвестный режим структурной диагностики/);
assert.deepEqual(source.Sections.MtxRouteMatrixRowVersionValues.Rows[0], intervalRow, 'source fixture was unexpectedly changed between variants');

console.log('TESSA interval structural probes: one-variable marker transforms OK');
