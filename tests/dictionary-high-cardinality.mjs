import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const raw = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const source = raw.replace(
  'window.__TESSA_MATRIX_SYNC_EXPORTS__ = {',
  'window.__TESSA_MATRIX_SYNC_EXPORTS__ = { finalizeDictionaryEntries, dictionaryLookup, resolveEmbeddedDictionaryValue,',
);
if (source === raw) throw new Error('test instrumentation could not expose dictionary helpers');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(source, { filename: 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

const ENTRY_COUNT = 30000;
const entries = Array.from({ length: ENTRY_COUNT }, (_, i) => ({
  id: `id-${i}`,
  display: `Организация ${String(i).padStart(5, '0')}`,
  roleTypeId: '',
  source: 'HighCardinalityQA',
}));
entries.push(
  { id: 'dup-a', display: 'Одинаковое название', roleTypeId: '', qualifier: 'Москва', source: 'HighCardinalityQA' },
  { id: 'dup-b', display: 'Одинаковое название', roleTypeId: '', qualifier: 'Курск', source: 'HighCardinalityQA' },
);

const started = performance.now();
const finalized = E.finalizeDictionaryEntries(entries);
const catalog = { sourceView: 'HighCardinalityQA', entries: finalized };
const lookup = E.dictionaryLookup(catalog);
const indexMs = performance.now() - started;

assert(finalized.length === ENTRY_COUNT + 2, `dictionary entries drifted: ${finalized.length}`);
assert(lookup.byId.get('id-29999|')?.length >= 1, 'last high-cardinality ID is not indexed');
assert(lookup.byDisplay.get('одинаковое название')?.length === 2, 'duplicate display must remain explicitly ambiguous');
assert(finalized.some(item => item.id === 'dup-a' && /Москва/.test(item.selector)), 'duplicate selector lost Moscow qualifier');
assert(finalized.some(item => item.id === 'dup-b' && /Курск/.test(item.selector)), 'duplicate selector lost Kursk qualifier');
assert(indexMs < 15000, `dictionary normalize/index exceeded broad 15s ceiling: ${Math.round(indexMs)}ms`);

const workbook = {
  dictionaryCatalog: {
    catalogs: { orgs: catalog },
    columnCatalogIds: { 'criterion:org': 'orgs' },
  },
};
const column = { key: 'criterion:org', kind: 'criterion', excelHeader: 'Организация' };

const exact = E.resolveEmbeddedDictionaryValue(workbook, column, 'Организация 29999', 'id-29999');
assert(exact.resolved && exact.explicit === 'id-29999', `exact high-cardinality ID resolution failed: ${JSON.stringify(exact)}`);
const ambiguous = E.resolveEmbeddedDictionaryValue(workbook, column, 'Одинаковое название', '');
assert(!ambiguous.resolved && /неоднознач/i.test(ambiguous.issue || ''), `duplicate display must fail closed: ${JSON.stringify(ambiguous)}`);

// Repeated identical typo/fragment lookups are common when many rows reuse one bad Excel value.
// The first call may scan the high-cardinality search rows; subsequent calls must reuse the
// resolution result rather than rescan tens of thousands of entries for every matrix row.
const firstMiss = E.resolveEmbeddedDictionaryValue(workbook, column, 'Несуществующий контрагент XYZ', '');
assert(!firstMiss.resolved, 'unknown value unexpectedly resolved');
const originalFilter = lookup.searchRows.filter;
lookup.searchRows.filter = () => { throw new Error('high-cardinality searchRows rescanned for identical lookup'); };
let secondMiss;
try {
  secondMiss = E.resolveEmbeddedDictionaryValue(workbook, column, 'Несуществующий контрагент XYZ', '');
} finally {
  lookup.searchRows.filter = originalFilter;
}
assert(!secondMiss.resolved && secondMiss.issue === firstMiss.issue,
  `cached unresolved result drifted: ${JSON.stringify({ firstMiss, secondMiss })}`);

console.log(`TESSA Matrix Studio high-cardinality dictionary regression: OK (${ENTRY_COUNT + 2} entries, index=${Math.round(indexMs)}ms)`);
