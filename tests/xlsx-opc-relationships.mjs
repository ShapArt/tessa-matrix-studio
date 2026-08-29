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

const u16 = value => { const out = Buffer.alloc(2); out.writeUInt16LE(value & 0xffff, 0); return out; };
const u32 = value => { const out = Buffer.alloc(4); out.writeUInt32LE(Number(value) >>> 0, 0); return out; };
function buildStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  const descriptors = [];
  let localOffset = 0;
  for (const [entryName, text] of entries) {
    const name = Buffer.from(entryName, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(data.length), u32(data.length), u16(name.length), u16(0), name,
    ]);
    localParts.push(local, data);
    descriptors.push({ name, data, offset: localOffset });
    localOffset += local.length + data.length;
  }
  const centralOffset = localOffset;
  for (const item of descriptors) {
    centralParts.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(item.data.length), u32(item.data.length), u16(item.name.length), u16(0),
      u16(0), u16(0), u16(0), u32(0), u32(item.offset), item.name,
    ]));
  }
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(centralOffset), u16(0),
  ]);
  return Buffer.concat([...localParts, central, eocd]);
}
const toArrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <x:sheets><x:sheet name="Матрица" sheetId="9" r:id="rId42"/></x:sheets>
</x:workbook>`;
const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <x:sheetData>
  <x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>__TESSA_FORMAT</x:t></x:is></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>TESSA_MATRIX_ROUNDTRIP_V6</x:t></x:is></x:c></x:row>
  <x:row r="2"><x:c r="A2" t="inlineStr"><x:is><x:t>__TESSA_HEADER_ROW</x:t></x:is></x:c><x:c r="B2" t="inlineStr"><x:is><x:t>4</x:t></x:is></x:c></x:row>
  <x:row r="3"><x:c r="A3" t="inlineStr"><x:is><x:t>criterion:test</x:t></x:is></x:c></x:row>
  <x:row r="4"><x:c r="A4" t="inlineStr"><x:is><x:t>Организация</x:t></x:is></x:c></x:row>
  <x:row r="5"><x:c r="A5" t="inlineStr"><x:is><x:t>ООО Тест</x:t></x:is></x:c></x:row>
 </x:sheetData>
</x:worksheet>`;

function workbookZip(target, targetMode = null, localPart = 'xl/worksheets/sheet9.xml') {
  const mode = targetMode ? ` TargetMode="${targetMode}"` : '';
  const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId42" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${target}"${mode}/>
</Relationships>`;
  return buildStoredZip([
    ['xl/workbook.xml', workbookXml],
    ['xl/_rels/workbook.xml.rels', relsXml],
    [localPart, sheetXml],
  ]);
}

for (const [label, target] of [
  ['dot-segments', './worksheets/../worksheets/sheet9.xml'],
  ['package-root', '/xl/worksheets/sheet9.xml'],
  ['backslash-writer', 'worksheets\\sheet9.xml'],
]) {
  const workbook = await E.readXlsxArrayBuffer(toArrayBuffer(workbookZip(target)), `${label}.xlsx`);
  assert(workbook.sheetName === 'Матрица' && workbook.rows.length === 1,
    `${label}: safe internal Relationship did not resolve`);
}

for (const [label, target] of [
  ['root-escape', '../../../evil.xml'],
  ['http-uri', 'https://example.invalid/sheet.xml'],
  ['file-uri', 'file:///tmp/sheet.xml'],
  ['network-path', '//example.invalid/sheet.xml'],
]) {
  let error = null;
  try { await E.readXlsxArrayBuffer(toArrayBuffer(workbookZip(target)), `${label}.xlsx`); }
  catch (caught) { error = caught; }
  assert(error && /relationship|внешн|корн|xlsx|пакет/i.test(String(error.message || error)),
    `${label}: unsafe Relationship must fail closed, got ${error?.message || 'no error'}`);
}

// OPC TargetMode is authoritative. This is a separate signal from the Target URI text:
// an explicitly External relationship must never be mapped back onto a local ZIP member.
let externalModeError = null;
try {
  await E.readXlsxArrayBuffer(
    toArrayBuffer(workbookZip('worksheets/sheet9.xml', 'External')),
    'external-mode-local-looking.xlsx',
  );
} catch (caught) {
  externalModeError = caught;
}
assert(externalModeError && /external|внешн|targetmode|relationship/i.test(String(externalModeError.message || externalModeError)),
  `TargetMode=External must fail closed instead of loading local ZIP part: ${externalModeError?.message || 'no error'}`);

console.log('TESSA Matrix Studio OPC Relationship security/interop regression: OK');
