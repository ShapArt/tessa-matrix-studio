import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.example.test' };
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;

assert.equal(typeof E.partnerRecordKeepingColumnIndex, 'function', 'record-keeping column detector must be exported');

const partnerResult = {
  alias: 'GchPartners',
  references: [{ colPrefix:'Partner', refSection:['GchPartners','GchPartnersMulti'], displayValueColumn:'PartnerName' }],
  columns: ['PartnerID','PartnerName','FullName','IsRecordKeeping'],
  rows: [
    ['org-yes','Компания Да','ООО Компания Да',true],
    ['org-no','Компания Нет','ООО Компания Нет',false],
    ['org-yes-text','Компания Текст','ООО Компания Текст','Да'],
  ],
  rowCount: 3,
  returnedRows: 3,
  complete: true,
  truncated: false,
};
assert.equal(E.partnerRecordKeepingColumnIndex(partnerResult.columns), 3);
assert.equal(E.partnerRecordKeepingColumnIndex(['PartnerID','PartnerName']), -1);

const bridge = Object.create(E.TessaBridge.prototype);
bridge.localizeValue = value => value == null ? '' : String(value);
bridge.findCompatibleViewAlias = () => 'GchPartners';
bridge.queryViewSample = async alias => alias === 'GchPartners'
  ? partnerResult
  : { alias, references: [], columns: [], rows: [], rowCount: 0, returnedRows: 0, complete: true, truncated: false };

const direct = bridge.extractDictionaryEntries(partnerResult, { refSection:'GchPartners', recordKeepingOnly:true });
assert.deepEqual(direct.map(item => item.id).sort(), ['org-yes','org-yes-text'], 'only IsRecordKeeping=Да must enter the fresh organization dictionary');

const structure = {
  templateId:'template-org',
  conditions:[{ criterionRowId:'org', criterionName:'Организация ГЧ ✅', operandTypeId:O.ReferenceGuid, autocompleteViewName:'GchPartners', refSection:'GchPartners' }],
  functions:[],
};
const snapshot = { rows:[{
  rowCardId:'row-1', versionId:'version-1',
  values:{ org:[{ id:'legacy-current', display:'Текущее старое ЮЛ' }] }, roles:{},
  flat:{ 'criterion:org':['Текущее старое ЮЛ'] },
}] };
const catalog = await bridge.loadDictionaryCatalog(structure, snapshot, { forceRefresh:true, transient:true });
const id = catalog.columnCatalogIds['criterion:org'];
const ids = new Set(catalog.catalogs[id].entries.map(item => item.id));
assert.ok(ids.has('org-yes'));
assert.ok(ids.has('org-yes-text'));
assert.ok(!ids.has('org-no'));
assert.ok(ids.has('legacy-current'), 'a value already used by the matrix must survive snapshot overlay even if absent from the filtered fresh view');

const noFlagBridge = Object.create(E.TessaBridge.prototype);
noFlagBridge.localizeValue = bridge.localizeValue;
noFlagBridge.findCompatibleViewAlias = () => 'GchPartners';
const noFlag = { ...partnerResult, columns:['PartnerID','PartnerName','FullName'], rows:partnerResult.rows.map(row => row.slice(0,3)) };
noFlagBridge.queryViewSample = async alias => alias === 'GchPartners' ? noFlag : { alias, references:[], columns:[], rows:[], rowCount:0, returnedRows:0, complete:true, truncated:false };
const fallback = await noFlagBridge.loadDictionaryCatalog(structure, { rows:[] }, { forceRefresh:true, transient:true });
const fallbackId = fallback.columnCatalogIds['criterion:org'];
assert.equal(fallback.catalogs[fallbackId].entries.length, 3, 'missing filter field must fail open rather than silently deleting valid organizations');
assert.ok((fallback.stats.warnings || []).some(text => /IsRecordKeeping|делопроизвод/i.test(text)), 'missing live filter field must be visible as a warning');

console.log('TESSA Matrix Studio GchPartners: IsRecordKeeping=Да filter with current-value preservation and safe fallback: OK');
