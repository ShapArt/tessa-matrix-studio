import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const instrumented = source.replace(
  'window.__TESSA_MATRIX_SYNC_EXPORTS__ = {',
  'window.__TESSA_MATRIX_SYNC_EXPORTS__ = { parseSharedStrings,',
);
if (instrumented === source) throw new Error('test instrumentation could not expose parseSharedStrings');

const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(instrumented, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.parseSharedStrings === 'function', 'parseSharedStrings must be exposed to this regression');

// Microsoft Open XML SDK emits valid SpreadsheetML with explicit namespace prefixes.
// Rich-text shared strings may contain multiple <t> nodes whose text forms one cell value.
const namespacedSharedStrings = `<?xml version="1.0" encoding="utf-8"?>
<x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
  <x:si><x:t>Alpha</x:t></x:si>
  <x:si>
    <x:r><x:t>Hello</x:t></x:r>
    <x:r><x:t xml:space="preserve"> World</x:t></x:r>
  </x:si>
  <x:si><x:t></x:t></x:si>
</x:sst>`;

const shared = E.parseSharedStrings(namespacedSharedStrings);
assert(shared.length === 3, `namespaced sharedStrings must preserve all items, got ${JSON.stringify(shared)}`);
assert(shared[0] === 'Alpha', `simple namespaced shared string was not parsed: ${JSON.stringify(shared)}`);
assert(shared[1] === 'Hello World', `rich-text runs must concatenate in order: ${JSON.stringify(shared)}`);
assert(shared[2] === '', `explicit empty shared string must remain valid: ${JSON.stringify(shared)}`);

const sheetForIndex = rawIndex => `<?xml version="1.0" encoding="utf-8"?>
<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>${rawIndex}</x:v></x:c></x:row></x:sheetData>
</x:worksheet>`;

const valid = E.parseSheetXml(sheetForIndex('0'), shared);
assert(valid.rows[0]?.[0] === 'Alpha', `valid shared-string index did not resolve: ${JSON.stringify(valid.rows[0])}`);

const explicitEmpty = E.parseSheetXml(sheetForIndex('2'), shared);
assert(explicitEmpty.rows[0]?.[0] === '', 'valid shared-string item containing empty text must not be rejected');

for (const badIndex of ['-1', '3', '1.5', 'abc', '']) {
  let rejected = false;
  try {
    E.parseSheetXml(sheetForIndex(badIndex), shared);
  } catch (error) {
    rejected = true;
    const message = String(error?.message || error);
    assert(/shared|общ|строк|индекс/i.test(message),
      `invalid shared-string index ${JSON.stringify(badIndex)} must have an explicit diagnostic, got: ${message}`);
  }
  assert(rejected,
    `invalid shared-string index ${JSON.stringify(badIndex)} must fail closed instead of becoming an empty cell`);
}

console.log('TESSA Matrix Studio sharedStrings namespace/index regression: OK');
