import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], body: { innerText: '' } };
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;

assert.equal(typeof E.createRuntimeMonitor, 'function', 'automatic readiness monitor missing');
let enabled = true, checks = 0, callback, cancelled = 0;
const monitor = E.createRuntimeMonitor({
  active: () => enabled, check: () => { checks++; },
  schedule: fn => { callback = fn; return 7; }, cancel: () => { cancelled++; },
});
monitor.start();
assert.equal(checks, 1);
callback();
assert.equal(checks, 2, 'must retry after the card finishes mounting');
enabled = false; callback(); assert.equal(checks, 2, 'no probes while closed, hidden or busy');
enabled = true; monitor.tick(); assert.equal(checks, 3);
monitor.stop(); assert.equal(cancelled, 1);
callback(); assert.equal(checks, 3, 'late timer cannot revive a stopped monitor');
monitor.start(); assert.equal(checks, 4); monitor.stop();

const waiting = E.capabilityStatusModel({overall:'incompatible',runtime:{workspace:false},blockers:[{code:'workspace-missing'}],warnings:[]},{});
assert.equal(waiting.tone, 'waiting');
assert.equal(waiting.label, 'Откройте матрицу');
assert.ok(waiting.detail.length < 110);
const loading = E.capabilityStatusModel({overall:'incompatible',runtime:{workspace:true,cardModel:true},matrix:{identity:true,template:true,stateReadable:true},nativeView:{found:false},blockers:[{code:'native-view-missing'}],warnings:[]},{});
assert.equal(loading.tone, 'waiting');
assert.ok(!loading.label.includes('несовместима'));

const catalog = {id:'roles',sourceView:'roles',entries:[
  {id:'1',roleTypeId:'1',selector:'Иванов — сотрудник',display:'Иванов'},
  {id:'1',roleTypeId:'2',selector:'Иванов — группа',display:'Иванов'},
  {id:'2',roleTypeId:'1',selector:'<img onerror=alert(1)>',display:'Опасный текст'},
]};
const source = {headers:['Подписание','Скрытый','Признак'],schemaTokens:['function:sign','companion:function:sign','criterion:flag'],dictionaryCatalog:{catalogs:{roles:catalog,bool:{entries:[{id:'true',display:'Да'},{id:'false',display:'Нет'}],sourceView:'Boolean'}},columnCatalogIds:{'function:sign':'roles','criterion:flag':'bool'}}};
const columns = E.pickerColumns(source);
assert.equal(columns.length,1, 'Boolean and hidden companion columns cannot be multi-selected');
assert.equal(columns[0].label,'Подписание');
const found = E.searchPickerEntries(catalog,'иванов',1);
assert.equal(found.total,2); assert.equal(found.items.length,1);
assert.notEqual(E.pickerEntryKey(catalog.entries[0]),E.pickerEntryKey(catalog.entries[1]));
const values = E.pickerSelectionText([catalog.entries[0],catalog.entries[1],catalog.entries[0]]);
assert.equal(values,'Иванов — сотрудник\nИванов — группа');
assert.deepEqual(E.splitCell(values),['Иванов - сотрудник','Иванов - группа']);
assert.throws(()=>E.pickerSelectionText([{id:'3',selector:'bad;value'}]),/разделител/);
assert.throws(()=>E.pickerSelectionText([{id:'3',selector:'x'.repeat(32768)}]),/32767/);
assert.throws(()=>E.pickerSelectionText([{id:'3',selector:'=HYPERLINK("url")'}]),/формул/);
const many={entries:Array.from({length:25000},(_,i)=>({id:String(i),selector:`Вариант ${i}`,display:`Вариант ${i}`}))};
const start=performance.now();
assert.equal(E.searchPickerEntries(many,'',80).items.length,80);
assert.equal(E.searchPickerEntries(many,'24999',80).items[0].id,'24999');
assert.ok(performance.now()-start<2000,'picker search must handle large dictionaries');
console.log('TESSA automatic readiness + multivalue picker: OK');
