import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const sourcePath=process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js',import.meta.url).pathname;
const source=fs.readFileSync(sourcePath,'utf8');
const start=source.indexOf('      const pagingNumber = value => {');
const end=source.indexOf('\n\n      const rememberOwn',start);
assert.ok(start>=0 && end>start,'paging helper block missing');
const block=source.slice(start,end).replace(/^      /gm,'');
const ctx={
 canonicalValue:v=>String(v??'').trim().toLowerCase(),
 pageParamEvidence:params=>params,
 hasExplicitPaging:params=>{const n=new Set(params.map(x=>String(x.name).toLowerCase()));return n.has('pagelimit')&&n.has('pageoffset')},
 pageLimit:50,Number,Array,Object,String,Set,console,
};
vm.createContext(ctx);
vm.runInContext(block+'\nthis.api={pagingNumber,pagingValues,isPagingUsableForPage};',ctx);
const {pagingNumber,pagingValues,isPagingUsableForPage}=ctx.api;
assert.equal(pagingNumber('50'),50);
assert.equal(pagingNumber({Value:'51'}),51);
assert.equal(pagingNumber(null),null);
const p=(limit,offset)=>[{name:'PageLimit',value:limit},{name:'PageOffset',value:offset}];
assert.equal(isPagingUsableForPage(p(50,0),1,null),true);
assert.equal(isPagingUsableForPage(p(50,null),1,null),false);\nassert.equal(isPagingUsableForPage(p(20,0),1,null),false);
assert.equal(isPagingUsableForPage(p(50,0),2,0),false);
assert.equal(isPagingUsableForPage(p('50','50'),2,0),true);
assert.deepEqual({...pagingValues(p('50','100'))},{limit:50,offset:100});
console.log('v1.16.6 paging helper runtime: PASS');
