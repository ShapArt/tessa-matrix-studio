import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

// Some spreadsheet writers serialize SpreadsheetML with explicit namespace prefixes
// (<x:row>, <x:c>, <x:v>) instead of relying on a default namespace. This is valid XLSX
// and must be parsed exactly like the unprefixed form emitted by Studio itself.
const xml = `<?xml version="1.0" encoding="utf-8"?>
<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <x:sheetData>
    <x:row r="10"><x:c r="A10" t="str"><x:v>__TESSA_HEADER_ROW</x:v></x:c><x:c r="B10" t="str"><x:v>14</x:v></x:c></x:row>
    <x:row r="13"><x:c r="A13" t="str"><x:v>criterion:test</x:v></x:c><x:c r="B13" t="str"><x:v>system:rowCardId</x:v></x:c></x:row>
    <x:row r="14"><x:c r="A14" t="str"><x:v>Организация ГЧ ✅</x:v></x:c><x:c r="B14" t="str"><x:v>__TESSA_ROW_CARD_ID</x:v></x:c></x:row>
    <x:row r="15"><x:c r="A15" t="str"><x:v>ООО Тест</x:v></x:c><x:c r="B15" t="str"><x:v>card-1</x:v></x:c></x:row>
  </x:sheetData>
</x:worksheet>`;

const parsed = E.parseSheetXml(xml, []);
assert(parsed.rows.length >= 15, `namespaced rows were not parsed: ${parsed.rows.length}`);
assert(parsed.rows[9]?.[0] === '__TESSA_HEADER_ROW', `metadata row missing: ${JSON.stringify(parsed.rows[9])}`);
assert(parsed.rows[13]?.[0] === 'Организация ГЧ ✅', `header row missing: ${JSON.stringify(parsed.rows[13])}`);
assert(parsed.rows[14]?.[1] === 'card-1', `data row missing: ${JSON.stringify(parsed.rows[14])}`);

console.log('TESSA Matrix Studio namespaced SpreadsheetML parser regression: OK');
