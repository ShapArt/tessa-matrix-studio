import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.document = {
  body: { innerText: '' },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ click() {} }),
};

const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source.replace('  bootstrap();', '  // Task14 test: bootstrap intentionally skipped.'));
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;

assert.equal(typeof E.sampleDiagnosticDictionaryEntries, 'function', 'Task14 RED: diagnostics need a deterministic bounded dictionary sampler');

const sourceEntries = Array.from({ length: 10000 }, (_, index) => ({ id: `id-${index}`, display: `Value ${index}` }));
const sampled = E.sampleDiagnosticDictionaryEntries(sourceEntries, 400);
assert.equal(sampled.length, 400, 'sampler must obey the per-catalog evidence cap');
assert.equal(sampled[0].id, 'id-0', 'sampler must retain the first value');
assert.equal(sampled.at(-1).id, 'id-9999', 'sampler must retain the last value');
assert.equal(new Set(sampled.map(item => item.id)).size, sampled.length, 'sampler must not duplicate evidence');
assert.ok(sampled.some(item => Number(item.id.slice(3)) > 4000 && Number(item.id.slice(3)) < 6000), 'sampler must cover the middle of a large catalog');
assert.deepEqual(E.sampleDiagnosticDictionaryEntries(sourceEntries.slice(0, 3), 400), sourceEntries.slice(0, 3), 'small catalogs should stay complete');

assert.match(source, /bytes:\s*64\s*\*\s*1024\s*\*\s*1024/,
  'diagnostics total evidence budget must fit a normal exported workbook plus support evidence');
assert.match(source, /itemBytes:\s*32\s*\*\s*1024\s*\*\s*1024/,
  'a valid XLSX below the normal 32 MiB input ceiling must not be rejected by the diagnostic item ceiling');
assert.match(source, /dictionaryEvidencePerCatalog:\s*400/,
  'diagnostics must bound dictionary evidence per catalog');
assert.match(source, /dictionaryEvidenceTotalEntries:\s*5000/,
  'diagnostics must bound dictionary evidence across all catalogs');
assert.match(source, /report\.dictionaryEvidence\s*=/,
  'the report must explain whether dictionary evidence is full or sampled');
assert.doesNotMatch(source, /for \(let offset = 0; offset < dictionary\.entries\.length; offset \+= 500\)/,
  'diagnostics must not serialize every high-cardinality dictionary row');

console.log('Task14 GREEN: diagnostic evidence is bounded, deterministic, and still spans large catalogs.');
