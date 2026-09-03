import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__, bridge = Object.create(E.TessaBridge.prototype);
bridge.localizeValue = x => x == null ? '' : String(x);
const projection = (columns, row, refSection, prefix, display) => bridge.extractDictionaryEntries({alias:'Test', columns, rows:[row], references:[{refSection:[refSection],colPrefix:prefix,displayValueColumn:display}]}, {refSection});
assert.deepEqual(projection(['FunctionID','FunctionName','ScopeID','ScopeName'], ['parent','Функция','child','Область'], 'Scope','Scope','ScopeName').map(x=>[x.id,x.display]), [['child','Область']]);
assert.deepEqual(projection(['ScopeID','ScopeName','AdditionalScopeID','AdditionalScopeName'], ['parent','Область','child','Подобласть'], 'AdditionalScope','AdditionalScope','AdditionalScopeName').map(x=>[x.id,x.display]), [['child','Подобласть']]);
assert.equal(projection(['DocTypeID','DocTypeTitle','CardTypeCaption','CardTypeID'], ['id','Акт передачи','Акт','type'], 'DocTypes','DocType','DocTypeTitle')[0].display, 'Акт передачи');
assert.equal(projection(['CategoryID','CategoryName'], [0,'Открыто'], 'Category','Category','CategoryName')[0].id, '0');
assert.equal(projection(['SegmentID','SegmentName','SegmentIsHidden'], ['id','Скрыт',true], 'Segment','Segment','SegmentName').length,0);
assert.throws(()=>bridge.extractDictionaryEntries({columns:['LeftID','LeftName','RightID','RightName'],rows:[['a','A','b','B']]}), /однозначной/);
const structure={templateId:'t',conditions:[{criterionRowId:'c',criterionName:'Область',refSection:'Scope',operandTypeId:E.constants.OPERAND.ReferenceGuid}],functions:[]};
const flat={'criterion:c':['Область']};
const snapshot={matrixId:'m',rows:[{rowCardId:'r',versionId:'v',flat,values:{c:[{id:'child',display:'Область',kind:'ReferenceGuid'}]},roles:{},fingerprint:E.fingerprintFlat(flat)}]};
const catalog={catalogs:{scopes:{id:'scopes',entries:[{id:'child',display:'Область'}]}},columnCatalogIds:{'criterion:c':'scopes'}};
const bytes=await E.createRoundtripXlsxBytes(structure,snapshot,{TemplateID:'t'},catalog);
const buf=x=>x.buffer.slice(x.byteOffset,x.byteOffset+x.byteLength);
const book=await E.readXlsxArrayBuffer(buf(bytes));
const nextCatalog={catalogs:{fresh:{id:'fresh',entries:[{id:'child',display:'Область'},{id:'new',display:'Новая область'}]}},columnCatalogIds:{'criterion:c':'fresh'}};
const refreshed=await E.readXlsxArrayBuffer(buf(await E.refreshWorkbookDictionaries(book,structure,nextCatalog)));
assert.deepEqual(refreshed.rows,book.rows,'refresh changed matrix values or metadata');
assert.deepEqual(refreshed.roundtrip.baselineRows,book.roundtrip.baselineRows,'refresh changed baseline');
assert.equal(refreshed.dictionaryCatalog.catalogs.fresh.entries.length,2);
assert.equal(E.buildPlan(refreshed,structure,snapshot).counts.noop,1);
console.log('Dictionary projection and workbook-preserving refresh: OK');
// Two normalizations must not renumber "variant 10" as "variant 2", nor retain
// a lookup index pointing at entries from the previous normalization.
const repeated=Array.from({length:24},(_,i)=>({id:`same-${String(i).padStart(2,'0')}`,display:'Одинаковое подразделение',roleTypeId:2}));
const stable=E.finalizeDictionaryEntries(repeated);
const again=E.finalizeDictionaryEntries(stable);
assert.deepEqual(again.map(e=>[e.id,e.selector]),stable.map(e=>[e.id,e.selector]));
const many={catalogs:{roles:{id:'roles',entries:stable}},columnCatalogIds:{'function:f':'roles'}};
E.dictionaryLookup(many.catalogs.roles);
E.normalizeDictionaryCatalog(many);
for(const item of many.catalogs.roles.entries){
 const resolved=E.resolveEmbeddedDictionaryValue({dictionaryCatalog:many},{kind:'function',key:'function:f',excelHeader:'Роли'},item.selector,`${item.id}|2`);
 assert.equal(resolved.explicit,`${item.id}|2`);
}
const originalSelectors={dictionaryCatalog:many};
const incoming={catalogs:{roles:{id:'roles',entries:[{id:'aaa-new',display:'Одинаковое подразделение',roleTypeId:2},...repeated]}},columnCatalogIds:{'function:f':'roles'}};
const preserved=E.preserveWorkbookSelectors(originalSelectors,incoming);
for(const item of many.catalogs.roles.entries) assert.equal(preserved.catalogs.roles.entries.find(x=>x.id===item.id).selector,item.selector);
const renamed=E.preserveWorkbookSelectors({dictionaryCatalog:{catalogs:{names:{entries:[{id:'one',display:'Прежнее',selector:'Прежнее'}]}},columnCatalogIds:{'criterion:c':'names'}}},{catalogs:{fresh:{id:'fresh',entries:[{id:'one',display:'Новое'}]}},columnCatalogIds:{'criterion:c':'fresh'}});
assert.equal(E.resolveEmbeddedDictionaryValue({dictionaryCatalog:renamed},{kind:'criterion',key:'criterion:c',excelHeader:'Поле'},'Прежнее','one').explicit,'one');
