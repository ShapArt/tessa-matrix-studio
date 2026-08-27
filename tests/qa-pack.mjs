import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;
assert(typeof E.buildQaPackVariants === 'function', 'buildQaPackVariants is missing');

const structure = {
  templateId: 'qa-pack-template',
  conditions: [
    { criterionRowId: 'criterion-org', criterionName: 'Организация', operandTypeId: O.ReferenceGuid, autocompleteViewName: 'QaOrganizationView', refSection: 'QaOrganizationView' },
    { criterionRowId: 'criterion-note', criterionName: 'Комментарий', operandTypeId: O.String },
  ],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};
function row(index, card, version, orgId, org, note, personId, person) {
  const flat = {
    'criterion:criterion-org': [org],
    'criterion:criterion-note': [note],
    'function:function-sign': [person],
  };
  return {
    index,
    rowCardId: card,
    versionId: version,
    fingerprint: E.fingerprintFlat(flat),
    values: {
      'criterion-org': [{ id: orgId, display: org }],
      'criterion-note': [{ id: '', display: note, value: note }],
    },
    roles: { 'function-sign': [{ id: personId, display: person, roleTypeId: 'role-type' }] },
    flat,
  };
}
const snapshot = {
  matrixId: 'qa-pack-matrix',
  templateId: structure.templateId,
  rows: [
    row(0, 'card-a', 'version-a', 'org-a', 'Компания А', 'A', 'person-a', 'Иванов И.И.'),
    row(1, 'card-b', 'version-b', 'org-b', 'Компания Б', 'B', 'person-b', 'Петров П.П.'),
    row(2, 'card-c', 'version-c', 'org-c', 'Компания В', 'C', 'person-c', 'Сидоров С.С.'),
  ],
};
const matrixInfo = { matrixId: snapshot.matrixId, TemplateID: snapshot.templateId, TemplateName: 'QA Pack Matrix', Name: 'QA Pack Matrix' };
const dictionaryCatalog = {
  version: 2,
  columnCatalogIds: {
    'criterion:criterion-org': 'qa-orgs',
    'function:function-sign': 'qa-signers',
  },
  catalogs: {
    'qa-orgs': {
      id: 'qa-orgs', label: 'Организация', sourceView: 'QaOrganizationView', entries: [
        { id: 'org-a', display: 'Компания А', selector: 'Компания А', roleTypeId: '' },
        { id: 'org-b', display: 'Компания Б', selector: 'Компания Б', roleTypeId: '' },
        { id: 'org-c', display: 'Компания В', selector: 'Компания В', roleTypeId: '' },
        { id: 'org-d', display: 'Компания Г', selector: 'Компания Г', roleTypeId: '' },
      ],
    },
    'qa-signers': {
      id: 'qa-signers', label: 'Подписание', sourceView: 'MtxRoles', entries: [
        { id: 'person-a', display: 'Иванов И.И.', selector: 'Иванов И.И.', roleTypeId: 'role-type' },
        { id: 'person-b', display: 'Петров П.П.', selector: 'Петров П.П.', roleTypeId: 'role-type' },
        { id: 'person-c', display: 'Сидоров С.С.', selector: 'Сидоров С.С.', roleTypeId: 'role-type' },
        { id: 'person-d', display: 'Новиков Н.Н.', selector: 'Новиков Н.Н.', roleTypeId: 'role-type' },
      ],
    },
  },
  stats: { catalogs: 2, entries: 8, errors: [] },
};

const pack = await E.buildQaPackVariants(structure, snapshot, matrixInfo, dictionaryCatalog);
assert(pack && Array.isArray(pack.variants), 'QA pack variants missing');
assert(Array.isArray(pack.checklist) && pack.checklist.length >= 10, 'QA checklist is too small');
const byScenario = new Map(pack.variants.map(item => [item.scenario, item]));
const required = [
  'noop', 'valid_patch', 'multi_patch', 'valid_add', 'valid_replace', 'valid_delete',
  'invalid_clear_row', 'invalid_dictionary', 'invalid_hidden_identity', 'invalid_hidden_fingerprint',
  'ambiguous_copy', 'schema_refresh_delete', 'wrong_matrix', 'wrong_template',
];
for (const scenario of required) assert(byScenario.has(scenario), `QA scenario is missing: ${scenario}`);

async function parseScenario(scenario) {
  const variant = byScenario.get(scenario);
  assert(variant?.bytes instanceof Uint8Array, `${scenario}: bytes missing`);
  const ab = variant.bytes.buffer.slice(variant.bytes.byteOffset, variant.bytes.byteOffset + variant.bytes.byteLength);
  const wb = await E.readXlsxArrayBuffer(ab, variant.name || `${scenario}.xlsx`);
  assert(wb.roundtrip.enabled, `${scenario}: generated workbook is not roundtrip`);
  assert(wb.roundtrip.format === 'TESSA_MATRIX_ROUNDTRIP_V6', `${scenario}: generated workbook is not V6`);
  return wb;
}

for (const scenario of required.filter(x => !['wrong_matrix', 'wrong_template'].includes(x))) {
  const wb = await parseScenario(scenario);
  assert(wb.roundtrip.matrixId === snapshot.matrixId, `${scenario}: MatrixID drifted`);
  assert(wb.roundtrip.templateId === snapshot.templateId, `${scenario}: TemplateID drifted`);
}

let wb = await parseScenario('noop');
let plan = E.buildPlan(wb, structure, snapshot);
assert(plan.counts.update === 0 && plan.counts.add === 0 && plan.counts.delete === 0 && plan.counts.skip === 0,
  `NOOP mismatch: ${JSON.stringify(plan.counts)}`);

wb = await parseScenario('valid_patch');
plan = E.buildPlan(wb, structure, snapshot);
assert(plan.counts.update === 1 && plan.counts.add === 0 && plan.counts.delete === 0,
  `PATCH mismatch: ${JSON.stringify(plan.counts)} ${JSON.stringify(plan.skippedRows)}`);

wb = await parseScenario('multi_patch');
plan = E.buildPlan(wb, structure, snapshot);
const multiAction = plan.actions.find(a => a.type === 'update');
assert(plan.counts.update === 1 && (multiAction?.changes?.length || 0) >= 2,
  `MULTI PATCH mismatch: ${JSON.stringify(plan.counts)} changes=${multiAction?.changes?.length || 0}`);

wb = await parseScenario('valid_add');
plan = E.buildPlan(wb, structure, snapshot);
assert(plan.counts.add === 1 && plan.counts.delete === 0,
  `ADD mismatch: ${JSON.stringify(plan.counts)} ${JSON.stringify(plan.skippedRows)}`);

wb = await parseScenario('valid_replace');
plan = E.buildPlan(wb, structure, snapshot);
const replacement = plan.actions.find(a => a.type === 'update' && E.isOverwriteMatch(a.match));
assert(replacement && plan.counts.add === 0 && plan.counts.delete === 0,
  `REPLACE mismatch: ${JSON.stringify(plan.counts)} actions=${JSON.stringify(plan.actions.map(a => ({t:a.type,m:a.match?.matchedBy})))}`);

wb = await parseScenario('valid_delete');
plan = E.buildPlan(wb, structure, snapshot);
assert(plan.counts.delete === 1 && plan.counts.add === 0,
  `DELETE mismatch: ${JSON.stringify(plan.counts)}`);

wb = await parseScenario('invalid_clear_row');
plan = E.buildPlan(wb, structure, snapshot);
assert(plan.counts.delete === 0 && plan.counts.skip >= 1,
  `CLEAR ROW must skip, not delete: ${JSON.stringify(plan.counts)}`);

wb = await parseScenario('invalid_dictionary');
plan = E.buildPlan(wb, structure, snapshot);
assert(plan.counts.skip >= 1 && plan.counts.add === 0 && plan.counts.delete === 0,
  `INVALID DICTIONARY mismatch: ${JSON.stringify(plan.counts)}`);

wb = await parseScenario('invalid_hidden_identity');
plan = E.buildPlan(wb, structure, snapshot);
assert(plan.counts.skip >= 1 && plan.counts.add === 0 && plan.counts.delete === 0,
  `HIDDEN ID mismatch: ${JSON.stringify(plan.counts)} ${JSON.stringify(plan.skippedRows)}`);

wb = await parseScenario('invalid_hidden_fingerprint');
plan = E.buildPlan(wb, structure, snapshot);
assert(plan.counts.skip >= 1 && plan.counts.update === 0 && plan.counts.delete === 0,
  `HIDDEN FP mismatch: ${JSON.stringify(plan.counts)} ${JSON.stringify(plan.skippedRows)}`);

wb = await parseScenario('ambiguous_copy');
plan = E.buildPlan(wb, structure, snapshot);
assert(plan.counts.delete === 0 && plan.counts.skip >= 1,
  `AMBIGUOUS COPY must refuse guessing: ${JSON.stringify(plan.counts)} ${JSON.stringify(plan.skippedRows)}`);

wb = await parseScenario('schema_refresh_delete');
const refreshed = E.mergeWorkbookIntoCurrentSnapshot(wb, structure, snapshot).snapshot;
assert(refreshed.rows.length === snapshot.rows.length - 1,
  `schema refresh DELETE must stay deleted: ${refreshed.rows.length}`);

wb = await parseScenario('wrong_matrix');
assert(wb.roundtrip.matrixId !== snapshot.matrixId, 'wrong_matrix scenario did not alter MatrixID');
wb = await parseScenario('wrong_template');
assert(wb.roundtrip.templateId !== snapshot.templateId, 'wrong_template scenario did not alter TemplateID');

console.log('TESSA Matrix Studio QA pack tests: OK');
