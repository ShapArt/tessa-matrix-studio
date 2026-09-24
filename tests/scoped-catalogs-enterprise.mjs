import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.example.test' };
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
const source = fs.readFileSync(process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source.replace('window.__TESSA_MATRIX_SYNC_EXPORTS__ = {', 'window.__scopeTest = { assertDocumentTypeAssignments, dictionaryCacheKey, APP }; window.__TESSA_MATRIX_SYNC_EXPORTS__ = {'));
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__, H = window.__scopeTest;
const cardType = '11111111-1111-4111-8111-111111111111';
const otherType = '22222222-2222-4222-8222-222222222222';
const structure = { templateId: 'template', conditions: [
  { criterionRowId: 'doc', criterionName: 'Вид документа', autocompleteViewName: 'GchDocTypes', refSection: 'GchDocTypes', operandTypeId: E.constants.OPERAND.ReferenceGuid },
  { criterionRowId: 'org', criterionName: 'Организация', autocompleteViewName: 'Organizations', refSection: 'Organizations', operandTypeId: E.constants.OPERAND.ReferenceGuid },
], functions: [{ id: 'role', name: 'Исполнитель' }] };
const calls = [];
const bridge = Object.create(E.TessaBridge.prototype);
bridge.findCompatibleViewAlias = condition => condition.autocompleteViewName;
bridge.getCard = async id => { assert.equal(id, structure.templateId); return { targetType: cardType, typeId: otherType }; };
bridge.section = card => card;
bridge.fieldFromSection = (card, field) => { assert.equal(field, 'CardTypeID'); return card.targetType; };
bridge.queryViewSample = async alias => {
  calls.push(alias);
  if (alias === 'GchDocTypes') return { alias, columns: ['KrDocTypeID', 'KrDocTypeTitle', 'KrDocTypeCardTypeID'], references: [{ colPrefix: 'KrDocType', refSection: ['GchDocTypes'], displayValueColumn: 'KrDocTypeTitle' }], rows: [['allowed', 'Приказ', cardType], ['foreign', 'Договор', otherType]] };
  if (alias === 'MtxRoles') return { alias, columns: ['RoleID', 'RoleName', 'RoleTypeID'], rows: [['role-id', 'Исполнитель', 1]] };
  return { alias, columns: ['OrganizationID', 'OrganizationName'], rows: [['org', 'Организация']] };
};
const historical = { matrixId: 'matrix', templateId: 'template', rows: [{ index: 0, rowCardId: 'r', versionId: 'v', values: { doc: [{ id: 'foreign', display: 'Договор', kind: 'ReferenceGuid' }] }, roles: { role: [{ id: 'role-id', display: 'Исполнитель', roleTypeId: 1 }] }, flat: { 'criterion:doc': ['Договор'], 'function:role': ['Исполнитель'] } }] };
historical.rows[0].fingerprint = E.fingerprintFlat(historical.rows[0].flat);
const full = await bridge.loadDictionaryCatalog(structure, historical, { forceRefresh: true, transient: true });
const docCatalog = full.catalogs[full.columnCatalogIds['criterion:doc']];
assert.deepEqual(docCatalog.entries.map(item => item.id), ['allowed'], 'snapshot must not reinsert foreign document types');
assert.equal(docCatalog.documentScope.cardTypeId, cardType, 'scope must use template field, not matrix/card typeId');
assert.equal(E.searchPickerPage(docCatalog).total, 1);
const bytes = await E.createRoundtripXlsxBytes(structure, historical, { TemplateID: structure.templateId }, full);
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
assert.deepEqual(workbook.dictionaryCatalog.catalogs[full.columnCatalogIds['criterion:doc']].entries.map(item => item.id), ['allowed']);
assert.equal(E.buildPlan(workbook, structure, historical).counts.noop, 1, 'unchanged historical row survives scoped export/import');
const desired = E.workbookRowsToDesired(workbook, E.buildColumnMap(workbook, structure))[0];
assert.equal(desired.ids['criterion:doc'][0], 'foreign');
H.assertDocumentTypeAssignments({ excelRow: desired }, structure, full, historical.rows[0]);
assert.throws(() => H.assertDocumentTypeAssignments({ excelRow: desired }, structure, full), /не соответствует/, 'copied historical value is not valid for ADD');
const valid = { ...desired, flat: { ...desired.flat, 'criterion:doc': ['Приказ'] }, ids: { ...desired.ids, 'criterion:doc': ['allowed'] } };
H.assertDocumentTypeAssignments({ excelRow: valid }, structure, full);
let creates = 0;
const preflightBridge = {
  matrixInfo: () => ({ matrixId: 'matrix', TemplateID: structure.templateId, StateName: 'Черновик' }),
  loadDictionaryCatalog: async (_structure, _fresh, options) => options.includeRoles === false ? full : null,
  assertCanCreateRows() {},
  createRowCard: async () => { creates += 1; throw new Error('Access denied by TESSA'); },
  resolveCriterion: () => ({}), resolveRole: () => ({}),
};
const planFor = excelRow => ({ id: 'scope-plan', matrixId: 'matrix', templateId: structure.templateId, actions: [{ type: 'add', excelRow, match: { matchedBy: 'new-row-no-id' }, changes: [] }], skippedRows: [], safety: { blocked: false } });
const blocked = await E.preflightPlan(planFor(desired), { previewOnly: true, bridge: preflightBridge, structure, fresh: historical });
assert.equal(blocked.preparedAdds.size, 0);
assert.ok(blocked.runtimeSkips.some(item => /не соответствует/.test(item.reason)));
assert.equal(creates, 0, 'invalid copied document type must be stopped before CardNew');
const accessDenied = await E.preflightPlan(planFor(valid), { previewOnly: true, bridge: preflightBridge, structure, fresh: historical });
assert.equal(accessDenied.preparedAdds.size, 0);
assert.ok(accessDenied.runtimeSkips.some(item => /Недостаточно прав/.test(item.reason)), 'native access denial is reported and skipped');
assert.equal(creates, 1);
assert.throws(() => H.assertDocumentTypeAssignments({ excelRow: valid }, structure, null), /Не удалось проверить/);
const missingId = { ...valid, ids: { ...valid.ids, 'criterion:doc': [] } };
assert.throws(() => H.assertDocumentTypeAssignments({ excelRow: missingId }, structure, full), /не соответствует/);
calls.length = 0;
const rolesOnly = await bridge.loadDictionaryCatalog(structure, historical, { requiredCriterionIds: [], transient: true });
assert.deepEqual(calls, ['MtxRoles'], 'ADD role validation must not reload every criterion dictionary');
assert.equal(rolesOnly.columnCatalogIds['criterion:org'], undefined);
calls.length = 0;
await bridge.loadDictionaryCatalog(structure, historical, { requiredCriterionIds: ['doc'], includeRoles: false });
assert.deepEqual(calls, ['GchDocTypes'], 'document validation must not load roles/organizations');
bridge.getCard = async () => { throw new Error('Access denied'); };
const denied = await bridge.loadDictionaryCatalog(structure, historical, { requiredCriterionIds: ['doc'], includeRoles: false });
assert.equal(denied.catalogs[denied.columnCatalogIds['criterion:doc']].entries.length, 0);
assert.throws(() => H.assertDocumentTypeAssignments({ excelRow: valid }, structure, denied), /Не удалось проверить/);
assert.throws(() => bridge.extractDictionaryEntries({ columns: ['KrDocTypeID', 'KrDocTypeTitle'], rows: [['allowed', 'Приказ']] }, { documentCardTypeId: cardType }), /KrDocTypeCardTypeID/);

let principal = 'user-a';
globalThis.tessa = { apiLoader: () => ({ ISession$: 'session' }), diContainer: { get: () => ({ sessionToken: { userId: principal } }) } };
const firstKey = H.dictionaryCacheKey(structure);
principal = 'user-b';
assert.notEqual(H.dictionaryCacheKey(structure), firstKey);
assert.notEqual(H.dictionaryCacheKey({ ...structure, documentCardTypeId: cardType }), H.dictionaryCacheKey({ ...structure, documentCardTypeId: otherType }));
delete globalThis.tessa;
H.APP.dictionaryCatalog = { stats: { cache: { key: H.dictionaryCacheKey(structure) } }, catalogs: {} };
calls.length = 0;
await bridge.loadDictionaryCatalog({ ...structure, conditions: [] }, { rows: [] });
assert.deepEqual(calls, ['MtxRoles'], 'unknown principal cannot reuse cached data');

const rows = Array.from({ length: 100000 }, (_, index) => [`id-${index}`, `Company ${index}`, 'Readable parent', 'x'.repeat(512)]);
const started = performance.now();
const projected = bridge.extractDictionaryEntries({ alias: 'Organizations', columns: ['OrganizationID', 'OrganizationName', 'ParentName', 'TechnicalPayload'], rows });
assert.equal(projected.length, rows.length);
assert.ok(projected.every(item => !item.details.includes('TechnicalPayload') && !item.searchText.includes('x'.repeat(64))));
assert.match(projected[0].details, /ParentName: Readable parent/);
console.log(JSON.stringify({ checks: 'scoped choices, historical roundtrip, new assignment rejection, denied scope, selective calls, principal cache, lean projection', rows: rows.length, projectionMs: Math.round(performance.now() - started), projectedBytes: Buffer.byteLength(JSON.stringify(projected)) }));
