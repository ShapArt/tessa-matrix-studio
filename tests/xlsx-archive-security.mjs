import fs from 'node:fs';
import vm from 'node:vm';
import { deflateRawSync } from 'node:zlib';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.__TESSA_MATRIX_SYNC_TEST_ARCHIVE_LIMITS__ = {
  MaxInputBytes: 64 * 1024,
  MaxEntries: 8,
  MaxEntryUncompressedBytes: 4 * 1024,
  MaxTotalUncompressedBytes: 8 * 1024,
  MaxCompressionRatio: 20,
};
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

const u16 = value => {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value & 0xffff, 0);
  return out;
};
const u32 = value => {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(Number(value) >>> 0, 0);
  return out;
};
const asBuffer = value => Buffer.isBuffer(value) ? value : Buffer.from(value ?? '');

function buildZip(entries, options = {}) {
  const localParts = [];
  const centralParts = [];
  const descriptors = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = asBuffer(entry.data);
    const method = entry.method ?? 0;
    const flags = entry.flags ?? 0;
    const compressed = method === 8 ? deflateRawSync(raw) : raw;
    const localExtra = asBuffer(entry.localExtra);
    const centralExtra = asBuffer(entry.centralExtra);
    const declaredCompressedSize = entry.declaredCompressedSize ?? compressed.length;
    const declaredUncompressedSize = entry.declaredUncompressedSize ?? raw.length;

    const localHeader = Buffer.concat([
      u32(0x04034b50), u16(entry.versionNeeded ?? 20), u16(flags), u16(method), u16(0), u16(0),
      u32(0), u32(declaredCompressedSize), u32(declaredUncompressedSize), u16(name.length), u16(localExtra.length),
      name, localExtra,
    ]);
    localParts.push(localHeader, compressed);
    descriptors.push({
      entry, name, flags, method, centralExtra, compressed,
      declaredCompressedSize, declaredUncompressedSize,
      localOffset: entry.localOffsetOverride ?? localOffset,
    });
    localOffset += localHeader.length + compressed.length;
  }

  const centralOffset = localOffset;
  for (const item of descriptors) {
    centralParts.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(item.entry.versionNeeded ?? 20), u16(item.flags), u16(item.method),
      u16(0), u16(0), u32(0), u32(item.declaredCompressedSize), u32(item.declaredUncompressedSize),
      u16(item.name.length), u16(item.centralExtra.length), u16(0), u16(0), u16(0), u32(0), u32(item.localOffset),
      item.name, item.centralExtra,
    ]));
  }
  const central = Buffer.concat(centralParts);
  const count = options.eocdCount ?? entries.length;
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(options.diskNumber ?? 0), u16(options.centralDisk ?? 0),
    u16(count), u16(count), u32(options.centralSize ?? central.length), u32(options.centralOffset ?? centralOffset), u16(0),
  ]);
  return Buffer.concat([...localParts, central, eocd]);
}

const toArrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

async function expectRejected(bytes, expected, label) {
  try {
    await E.readXlsxArrayBuffer(toArrayBuffer(bytes), `${label}.xlsx`);
  } catch (error) {
    const message = String(error?.message || error);
    assert(expected.test(message), `${label}: unexpected rejection: ${message}`);
    return;
  }
  throw new Error(`${label}: unsafe archive was accepted`);
}

// Input limit must run before ZIP parsing so a huge arbitrary file cannot reach DataView/inflate work.
await expectRejected(Buffer.alloc(globalThis.__TESSA_MATRIX_SYNC_TEST_ARCHIVE_LIMITS__.MaxInputBytes + 1), /размер файла|безопасн.*лимит/i, 'input-size');

// Central-directory metadata is untrusted: reject pathological counts before walking entries.
await expectRejected(
  buildZip(Array.from({ length: 9 }, (_, index) => ({ name: `xl/test-${index}.xml`, data: '' }))),
  /слишком много|количеств.*файл/i,
  'entry-count',
);

// ZIP64 is intentionally unsupported in the browser parser; sentinel values must fail closed.
await expectRejected(
  buildZip([{ name: 'xl/workbook.xml', data: 'x', declaredUncompressedSize: 0xffffffff }]),
  /ZIP64/i,
  'zip64',
);

// Encrypted entries must never be passed to the XML parser as if they were normal workbook parts.
await expectRejected(
  buildZip([{ name: 'xl/workbook.xml', data: 'x', flags: 0x0001 }]),
  /зашифрован|encrypt/i,
  'encrypted-entry',
);

// Archive paths are logical OPC part names, not filesystem paths; traversal/absolute/backslash forms are rejected.
await expectRejected(buildZip([{ name: '../evil.xml', data: 'x' }]), /небезопасн.*путь|путь.*архив/i, 'path-traversal');
await expectRejected(buildZip([{ name: '/xl/workbook.xml', data: 'x' }]), /небезопасн.*путь|путь.*архив/i, 'absolute-path');
await expectRejected(buildZip([{ name: 'xl\\workbook.xml', data: 'x' }]), /небезопасн.*путь|путь.*архив/i, 'backslash-path');

// Duplicate normalized part names create parser ambiguity and therefore fail closed.
await expectRejected(
  buildZip([
    { name: 'xl/workbook.xml', data: 'a' },
    { name: 'xl/workbook.xml', data: 'b' },
  ]),
  /дублирующ|повтор.*путь|duplicate/i,
  'duplicate-path',
);

// Declared entry/aggregate sizes and compression ratio are checked before decompression.
await expectRejected(
  buildZip([{ name: 'xl/worksheets/sheet1.xml', data: 'x', declaredUncompressedSize: 5 * 1024 }]),
  /распакованн.*размер.*файл|размер.*sheet1\.xml/i,
  'declared-entry-size',
);
await expectRejected(
  buildZip([
    { name: 'xl/a.xml', data: Buffer.alloc(3000) },
    { name: 'xl/b.xml', data: Buffer.alloc(3000) },
    { name: 'xl/c.xml', data: Buffer.alloc(3000) },
  ]),
  /суммарн.*распакованн|общ.*размер/i,
  'declared-total-size',
);
await expectRejected(
  buildZip([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(2000), method: 8 }]),
  /степен.*сжат|compression|100|20/i,
  'compression-ratio',
);

// Do not trust declared uncompressed size: streamed inflate must stop when actual output crosses the limit.
// Raise only the ratio cap for this one test so it proves the output-byte limit rather than the ratio guard.
const savedRatio = globalThis.__TESSA_MATRIX_SYNC_TEST_ARCHIVE_LIMITS__.MaxCompressionRatio;
globalThis.__TESSA_MATRIX_SYNC_TEST_ARCHIVE_LIMITS__.MaxCompressionRatio = 10000;
await expectRejected(
  buildZip([{
    name: 'xl/worksheets/sheet1.xml',
    data: Buffer.alloc(5 * 1024),
    method: 8,
    declaredUncompressedSize: 100,
  }]),
  /распакованн.*размер.*файл|безопасн.*лимит/i,
  'actual-inflate-size',
);
globalThis.__TESSA_MATRIX_SYNC_TEST_ARCHIVE_LIMITS__.MaxCompressionRatio = savedRatio;

// A bogus local-header offset must become a controlled XLSX rejection, never a raw RangeError.
await expectRejected(
  buildZip([{ name: 'xl/workbook.xml', data: 'x', localOffsetOverride: 0xffffff00 }]),
  /поврежд|границ|offset|смещен/i,
  'local-offset-bounds',
);

console.log('TESSA Matrix Studio XLSX archive security regressions: OK');
