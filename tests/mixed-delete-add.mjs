import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
globalThis.window=globalThis;globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__=true;
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js',import.meta.url),'utf8'));
const E=window.__TESSA_MATRIX_SYNC_EXPORTS__;
const structure={templateId:'t',conditions:[{criterionRowId:'c',criterionName:'Число',operandTypeId:E.constants.OPERAND.Int}],functions:[{id:'f',name:'Исполнитель'}]};
const rows=[1,2,3].map(n=>{const flat={'criterion:c':[String(n)],'function:f':['Тестер']};return {index:n-1,rowCardId:'r'+n,versionId:'v'+n,values:{c:[{kind:'Int',value:n,display:String(n)}]},roles:{f:[{id:'person',display:'Тестер',roleTypeId:1}]},flat,fingerprint:E.fingerprintFlat(flat)}});
const snapshot={matrixId:'m',rows};
const buf=x=>x.buffer.slice(x.byteOffset,x.byteOffset+x.byteLength);
const book=await E.readXlsxArrayBuffer(buf(await E.createRoundtripXlsxBytes(structure,snapshot,{TemplateID:'t'},null,{includeActions:true})));
const add={excelRow:18,values:Array(book.headers.length).fill('')};add.values[0]='4';add.values[2]='Тестер';add.values[3]='person|1';add.values[book.schemaTokens.indexOf('system:action')]='Добавить';
const mixed={...book,rows:[book.rows[0],add,book.rows[2]]};
const plan=E.buildPlan(mixed,structure,snapshot);
assert.equal(plan.counts.add,1);assert.equal(plan.counts.delete,1);assert.equal(plan.counts.noop,2);assert.equal(plan.counts.skip,0,JSON.stringify(plan.skippedRows));
assert.equal(plan.actions.find(a=>a.type==='delete').currentRow.rowCardId,'r2');
const prepared=E.prepareThreeWayMerge(mixed,structure,snapshot);
const merged=E.mergeWorkbookIntoCurrentSnapshot(prepared.workbook,structure,snapshot);
const restored=await E.readXlsxArrayBuffer(buf(await E.createRoundtripXlsxBytes(structure,merged.snapshot,{TemplateID:'t'},null,{baselineRows:rows,includeActions:true})));
assert.equal(E.buildPlan(restored,structure,snapshot).counts.delete,1);
assert.equal(E.buildPlan(restored,structure,snapshot).counts.add,1);
for(const index of [0,1,2]){
 const sample={...book,rows:book.rows.filter((_,i)=>i!==index)};
 assert.equal(E.buildPlan(sample,structure,snapshot).actions.find(a=>a.type==='delete').currentRow.rowCardId,rows[index].rowCardId);
}
console.log('Physical delete first/middle/last and explicit ADD together, including schema refresh: OK');
