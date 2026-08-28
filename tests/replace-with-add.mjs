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
const structure = {
  templateId: 'replace-add-template',
  conditions: [{ criterionRowId: 'criterion-org', criterionName: 'Организация', operandTypeId: O.ReferenceGuid, autocompleteViewName: 'Organizations', refSection: 'Organizations' }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};
function row(index, card, version, orgId, org, personId, person) {
  const flat = { 'criterion:criterion-org': [org], 'function:function-sign': [person] };
  return { index, rowCardId: card, versionId: version, fingerprint: E.fingerprintFlat(flat), flat,
    values: { 'criterion-org': [{ id: orgId, display: org }] },
    roles: { 'function-sign': [{ id: personId, display: person, roleTypeId: 'role-type' }] } };
}
const snapshot = { matrixId: 'replace-add-matrix', templateId: structure.templateId,
  rows: [
    row(0, 'card-a', 'version-a', 'org-a', 'Компания А', 'person-a', 'Иванов И.И.'),
    row(1, 'card-b', 'version-b', 'org-b', 'Компания Б', 'person-b', 'Петров П.П.'),
    row(2, 'card-c', 'version-c', 'org-c', 'Компания В', 'person-c', 'Сидоров С.С.'),
  ] };
const info = { matrixId: snapshot.matrixId, TemplateID: snapshot.templateId, TemplateName: 'REPLACE + ADD', StateName: 'Черновик' };
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, info, catalog);
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'replace-add.xlsx');
const edited = { ...workbook, rows: workbook.rows.map(r => ({ excelRow: r.excelRow, values: [...r.values] })) };
const signer = workbook.headers.indexOf('Подписание');
const signerId = workbook.headers.indexOf('Подписание__ID');
const rowCard = workbook.schemaTokens.indexOf('system:rowCardId');
const version = workbook.schemaTokens.indexOf('system:versionId');
const fp = workbook.schemaTokens.indexOf('system:baseFingerprint');
assert([signer, signerId, rowCard, version, fp].every(i => i >= 0), 'required columns missing');

// REPLACE A over B, but keep B signer so the resulting target is not identical to A.
edited.rows[1].values = [...edited.rows[0].values];
edited.rows[1].values[signer] = workbook.rows[1].values[signer];
edited.rows[1].values[signerId] = workbook.rows[1].values[signerId];

// In the SAME workbook add one genuinely new row with no hidden identity.
const added = { excelRow: edited.rows.at(-1).excelRow + 1, values: [...workbook.rows[2].values] };
added.values[rowCard] = '';
added.values[version] = '';
added.values[fp] = '';
// Make it unique using a valid existing signer.
added.values[signer] = workbook.rows[0].values[signer];
added.values[signerId] = workbook.rows[0].values[signerId];
edited.rows.push(added);

const plan = E.buildPlan(edited, structure, snapshot);
const replacement = plan.actions.find(a => a.type === 'update' && E.isOverwriteMatch(a.match));
const add = plan.actions.find(a => a.type === 'add');
assert(replacement, `REPLACE must survive an unrelated ADD row: ${JSON.stringify(plan.counts)} ${JSON.stringify(plan.issues)}`);
assert(replacement.currentRow?.versionId === 'version-b', `REPLACE target must remain B: ${JSON.stringify(replacement.match)}`);
assert(add, `ADD must coexist with REPLACE: ${JSON.stringify(plan.counts)}`);
assert(plan.counts.delete === 0, `REPLACE + ADD must not invent DELETE: ${JSON.stringify(plan.counts)} ${JSON.stringify(plan.issues)}`);

console.log('TESSA Matrix Studio REPLACE + ADD batch regression: OK');
