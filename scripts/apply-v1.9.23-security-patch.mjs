import fs from 'node:fs';

const path = 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: anchor not found`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: anchor is not unique`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  'archive limits',
  `  const PERFORMANCE = Object.freeze({
    SnapshotCardGetConcurrency: 6,
    PreviewSnapshotTtlMs: 15 * 60 * 1000,
    ZipConcurrency: 4,
  });`,
  `  const PERFORMANCE = Object.freeze({
    SnapshotCardGetConcurrency: 6,
    PreviewSnapshotTtlMs: 15 * 60 * 1000,
    ZipConcurrency: 4,
  });

  // XLSX is an OPC/ZIP package. These are hard browser-side resource ceilings, not
  // business limits: a workbook that exceeds them is rejected before XML parsing.
  const XLSX_ARCHIVE_LIMITS = Object.freeze({
    MaxInputBytes: 32 * 1024 * 1024,
    MaxEntries: 256,
    MaxEntryUncompressedBytes: 128 * 1024 * 1024,
    MaxTotalUncompressedBytes: 256 * 1024 * 1024,
    MaxCompressionRatio: 100,
  });`
);

replaceOnce(
  'ZIP reader',
  `  async function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Браузер не поддерживает DecompressionStream. Нужен актуальный Chrome/Edge.');
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzipArrayBuffer(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    const eocd = findEocd(bytes);
    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder('utf-8');
    const descriptors = [];

    for (let index = 0; index < count; index += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Повреждён центральный каталог XLSX.');
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(\`Повреждён файл \${name} в XLSX.\`);
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      descriptors.push({ name: name.replace(/^\\//, ''), method, compressed: bytes.slice(dataStart, dataStart + compressedSize) });
      offset += 46 + nameLength + extraLength + commentLength;
    }

    const decoded = await mapConcurrent(descriptors, PERFORMANCE.ZipConcurrency, async descriptor => {
      let raw;
      if (descriptor.method === 0) raw = descriptor.compressed;
      else if (descriptor.method === 8) raw = await inflateRaw(descriptor.compressed);
      else throw new Error(\`Неподдерживаемый метод сжатия \${descriptor.method} в \${descriptor.name}.\`);
      return [descriptor.name, raw];
    });
    return new Map(decoded);
  }`,
  `  function xlsxArchiveError(message) {
    return new Error(\`XLSX отклонён: \${message}\`);
  }

  function archiveLimitLabel(bytes) {
    const mib = Number(bytes) / (1024 * 1024);
    if (mib >= 1) return \`\${Number.isInteger(mib) ? mib : mib.toFixed(1)} МБ\`;
    return \`\${Math.ceil(Number(bytes) / 1024)} КБ\`;
  }

  function effectiveXlsxArchiveLimits() {
    // Tiny limits are injectable only in Node regression tests. The browser always uses
    // the immutable production ceilings above, even if a page defines a similarly named global.
    const isNodeTest = Boolean(
      window.__TESSA_MATRIX_SYNC_TEST_MODE__
      && typeof process !== 'undefined'
      && process?.versions?.node
      && window.__TESSA_MATRIX_SYNC_TEST_ARCHIVE_LIMITS__,
    );
    if (!isNodeTest) return XLSX_ARCHIVE_LIMITS;
    const limits = { ...XLSX_ARCHIVE_LIMITS };
    for (const key of Object.keys(limits)) {
      const value = Number(window.__TESSA_MATRIX_SYNC_TEST_ARCHIVE_LIMITS__[key]);
      if (Number.isFinite(value) && value > 0) limits[key] = Math.floor(value);
    }
    return limits;
  }

  function ensureZipRange(length, offset, size, label) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > length) {
      throw xlsxArchiveError(\`\${label} выходит за границы файла.\`);
    }
  }

  function parseZipExtra(extra, label) {
    let offset = 0;
    while (offset < extra.length) {
      if (offset + 4 > extra.length) throw xlsxArchiveError(\`повреждены служебные данные ZIP для \${label}.\`);
      const view = new DataView(extra.buffer, extra.byteOffset + offset, extra.byteLength - offset);
      const id = view.getUint16(0, true);
      const size = view.getUint16(2, true);
      if (offset + 4 + size > extra.length) throw xlsxArchiveError(\`повреждены служебные данные ZIP для \${label}.\`);
      if (id === 0x0001) throw xlsxArchiveError('ZIP64 не поддерживается. Сохраните файл как обычный XLSX.');
      offset += 4 + size;
    }
  }

  function validateArchivePath(name) {
    const raw = String(name ?? '');
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); }
    catch (_) { throw xlsxArchiveError(\`небезопасный путь внутри архива: \${raw || '(пусто)'}.\`); }
    for (const candidate of [raw, decoded]) {
      if (!candidate || candidate.includes('\\0') || candidate.includes('\\\\') || candidate.startsWith('/') || /^[A-Za-z]:/.test(candidate)) {
        throw xlsxArchiveError(\`небезопасный путь внутри архива: \${raw || '(пусто)'}.\`);
      }
      const segments = candidate.split('/');
      if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
        throw xlsxArchiveError(\`небезопасный путь внутри архива: \${raw}.\`);
      }
    }
    return { name: raw, key: decoded.toLowerCase() };
  }

  async function inflateRawLimited(data, descriptor, limits, actualState) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Браузер не поддерживает DecompressionStream. Нужен актуальный Chrome/Edge.');
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks = [];
    let entryTotal = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        entryTotal += chunk.byteLength;
        actualState.total += chunk.byteLength;
        if (entryTotal > limits.MaxEntryUncompressedBytes) {
          try { await reader.cancel(); } catch (_) { /* already closing */ }
          throw xlsxArchiveError(\`распакованный размер файла \${descriptor.name} превышает безопасный лимит \${archiveLimitLabel(limits.MaxEntryUncompressedBytes)}.\`);
        }
        if (actualState.total > limits.MaxTotalUncompressedBytes) {
          try { await reader.cancel(); } catch (_) { /* already closing */ }
          throw xlsxArchiveError(\`суммарный распакованный размер превышает безопасный лимит \${archiveLimitLabel(limits.MaxTotalUncompressedBytes)}.\`);
        }
        const actualRatio = descriptor.compressedSize > 0 ? entryTotal / descriptor.compressedSize : (entryTotal ? Infinity : 1);
        if (actualRatio > limits.MaxCompressionRatio) {
          try { await reader.cancel(); } catch (_) { /* already closing */ }
          throw xlsxArchiveError(\`подозрительная степень сжатия файла \${descriptor.name} превышает \${limits.MaxCompressionRatio}×.\`);
        }
        chunks.push(chunk);
      }
    } catch (error) {
      if (String(error?.message || '').startsWith('XLSX отклонён:')) throw error;
      throw xlsxArchiveError(\`не удалось безопасно распаковать \${descriptor.name}: \${error?.message || error}.\`);
    } finally {
      try { reader.releaseLock(); } catch (_) { /* no-op */ }
    }
    const output = new Uint8Array(entryTotal);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }

  async function unzipArrayBuffer(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const limits = effectiveXlsxArchiveLimits();
    if (bytes.byteLength > limits.MaxInputBytes) {
      throw xlsxArchiveError(\`размер файла превышает безопасный лимит \${archiveLimitLabel(limits.MaxInputBytes)}.\`);
    }
    if (bytes.byteLength < 22) throw xlsxArchiveError('файл слишком мал и не содержит корректный ZIP-каталог.');

    const view = new DataView(arrayBuffer);
    let eocd;
    try { eocd = findEocd(bytes); }
    catch (_) { throw xlsxArchiveError('не найден корректный ZIP-каталог внутри XLSX.'); }
    ensureZipRange(bytes.length, eocd, 22, 'конец ZIP-каталога');
    const diskNumber = view.getUint16(eocd + 4, true);
    const centralDisk = view.getUint16(eocd + 6, true);
    const entriesOnDisk = view.getUint16(eocd + 8, true);
    const count = view.getUint16(eocd + 10, true);
    const centralSize = view.getUint32(eocd + 12, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    const commentLength = view.getUint16(eocd + 20, true);

    if (eocd + 22 + commentLength !== bytes.length) throw xlsxArchiveError('повреждён конец ZIP-каталога или обнаружены лишние данные после него.');
    if (eocd >= 20 && view.getUint32(eocd - 20, true) === 0x07064b50) {
      throw xlsxArchiveError('ZIP64 не поддерживается. Сохраните файл как обычный XLSX.');
    }
    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== count) throw xlsxArchiveError('многотомные ZIP-архивы не поддерживаются.');
    if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw xlsxArchiveError('ZIP64 не поддерживается. Сохраните файл как обычный XLSX.');
    }
    if (count > limits.MaxEntries) throw xlsxArchiveError(\`слишком много файлов внутри архива (\${count} > \${limits.MaxEntries}).\`);
    ensureZipRange(bytes.length, centralOffset, centralSize, 'центральный ZIP-каталог');
    if (centralOffset + centralSize !== eocd) throw xlsxArchiveError('повреждён центральный ZIP-каталог или его границы не совпадают с EOCD.');

    const decoder = new TextDecoder('utf-8');
    const descriptors = [];
    const seenPaths = new Set();
    let offset = centralOffset;
    let declaredTotal = 0;
    let declaredCompressedTotal = 0;

    for (let index = 0; index < count; index += 1) {
      ensureZipRange(bytes.length, offset, 46, 'запись центрального ZIP-каталога');
      if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) throw xlsxArchiveError('повреждён центральный каталог XLSX.');
      const versionNeeded = view.getUint16(offset + 6, true);
      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLengthEntry = view.getUint16(offset + 32, true);
      const diskStart = view.getUint16(offset + 34, true);
      const localOffset = view.getUint32(offset + 42, true);
      const recordLength = 46 + nameLength + extraLength + commentLengthEntry;
      ensureZipRange(bytes.length, offset, recordLength, 'запись центрального ZIP-каталога');
      if (offset + recordLength > eocd) throw xlsxArchiveError('запись центрального ZIP-каталога выходит за его границы.');
      if (versionNeeded >= 45 && (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff)) {
        throw xlsxArchiveError('ZIP64 не поддерживается. Сохраните файл как обычный XLSX.');
      }
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff || diskStart === 0xffff) {
        throw xlsxArchiveError('ZIP64 не поддерживается. Сохраните файл как обычный XLSX.');
      }
      if (flags & 0x2041) throw xlsxArchiveError('зашифрованные ZIP-файлы не поддерживаются.');
      if (![0, 8].includes(method)) throw xlsxArchiveError(\`неподдерживаемый метод сжатия \${method}.\`);

      const nameStart = offset + 46;
      const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
      const pathInfo = validateArchivePath(name);
      if (seenPaths.has(pathInfo.key)) throw xlsxArchiveError(\`дублирующийся путь внутри архива: \${name}.\`);
      seenPaths.add(pathInfo.key);
      const centralExtra = bytes.slice(nameStart + nameLength, nameStart + nameLength + extraLength);
      parseZipExtra(centralExtra, name);

      if (uncompressedSize > limits.MaxEntryUncompressedBytes) {
        throw xlsxArchiveError(\`распакованный размер файла \${name} превышает безопасный лимит \${archiveLimitLabel(limits.MaxEntryUncompressedBytes)}.\`);
      }
      declaredTotal += uncompressedSize;
      declaredCompressedTotal += compressedSize;
      if (declaredTotal > limits.MaxTotalUncompressedBytes) {
        throw xlsxArchiveError(\`суммарный распакованный размер превышает безопасный лимит \${archiveLimitLabel(limits.MaxTotalUncompressedBytes)}.\`);
      }
      const declaredRatio = compressedSize > 0 ? uncompressedSize / compressedSize : (uncompressedSize ? Infinity : 1);
      if (declaredRatio > limits.MaxCompressionRatio) {
        throw xlsxArchiveError(\`подозрительная степень сжатия файла \${name} превышает \${limits.MaxCompressionRatio}×.\`);
      }

      ensureZipRange(bytes.length, localOffset, 30, \`локальный заголовок \${name}\`);
      if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== 0x04034b50) throw xlsxArchiveError(\`повреждён локальный заголовок файла \${name}.\`);
      const localFlags = view.getUint16(localOffset + 6, true);
      const localMethod = view.getUint16(localOffset + 8, true);
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const localHeaderLength = 30 + localNameLength + localExtraLength;
      ensureZipRange(bytes.length, localOffset, localHeaderLength, \`локальный заголовок \${name}\`);
      if (localOffset + localHeaderLength > centralOffset) throw xlsxArchiveError(\`локальный заголовок файла \${name} пересекает центральный каталог.\`);
      if (localFlags & 0x2041) throw xlsxArchiveError('зашифрованные ZIP-файлы не поддерживаются.');
      if (localMethod !== method) throw xlsxArchiveError(\`метод сжатия файла \${name} не совпадает между ZIP-заголовками.\`);
      const localNameStart = localOffset + 30;
      const localName = decoder.decode(bytes.slice(localNameStart, localNameStart + localNameLength));
      if (validateArchivePath(localName).key !== pathInfo.key) throw xlsxArchiveError(\`имя файла \${name} не совпадает между ZIP-заголовками.\`);
      const localExtra = bytes.slice(localNameStart + localNameLength, localNameStart + localNameLength + localExtraLength);
      parseZipExtra(localExtra, name);
      const dataStart = localOffset + localHeaderLength;
      ensureZipRange(bytes.length, dataStart, compressedSize, \`сжатые данные \${name}\`);
      if (dataStart + compressedSize > centralOffset) throw xlsxArchiveError(\`сжатые данные файла \${name} пересекают центральный ZIP-каталог.\`);

      descriptors.push({
        name,
        method,
        compressedSize,
        uncompressedSize,
        compressed: bytes.slice(dataStart, dataStart + compressedSize),
      });
      offset += recordLength;
    }

    if (offset !== centralOffset + centralSize) throw xlsxArchiveError('размер центрального ZIP-каталога не совпадает с количеством записей.');
    const totalDeclaredRatio = declaredCompressedTotal > 0 ? declaredTotal / declaredCompressedTotal : (declaredTotal ? Infinity : 1);
    if (totalDeclaredRatio > limits.MaxCompressionRatio) {
      throw xlsxArchiveError(\`суммарная степень сжатия архива превышает \${limits.MaxCompressionRatio}×.\`);
    }

    const decoded = [];
    const actualState = { total: 0 };
    for (const descriptor of descriptors) {
      let raw;
      if (descriptor.method === 0) {
        if (descriptor.compressedSize !== descriptor.uncompressedSize) {
          throw xlsxArchiveError(\`размер несжатого файла \${descriptor.name} не совпадает с ZIP-каталогом.\`);
        }
        raw = descriptor.compressed;
        actualState.total += raw.byteLength;
        if (actualState.total > limits.MaxTotalUncompressedBytes) {
          throw xlsxArchiveError(\`суммарный распакованный размер превышает безопасный лимит \${archiveLimitLabel(limits.MaxTotalUncompressedBytes)}.\`);
        }
      } else {
        raw = await inflateRawLimited(descriptor.compressed, descriptor, limits, actualState);
      }
      if (raw.byteLength !== descriptor.uncompressedSize) {
        throw xlsxArchiveError(\`фактический распакованный размер файла \${descriptor.name} не совпадает с ZIP-каталогом.\`);
      }
      decoded.push([descriptor.name, raw]);
    }
    return new Map(decoded);
  }`
);

fs.writeFileSync(path, source);
console.log('Applied v1.9.23 XLSX archive safety patch.');
