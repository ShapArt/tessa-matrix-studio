import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const sourcePath = new URL('tessa-matrix-studio.user.js', root);
const packagePath = new URL('package.json', root);
let source = fs.readFileSync(sourcePath, 'utf8');

function replaceOnce(oldText, newText, label) {
  const first = source.indexOf(oldText);
  assert.notEqual(first, -1, `${label}: source anchor not found`);
  assert.equal(source.indexOf(oldText, first + oldText.length), -1, `${label}: source anchor is not unique`);
  source = source.slice(0, first) + newText + source.slice(first + oldText.length);
}

// Task13-A: ZIP selection happens at the central-directory layer. A skipped worksheet is
// still path/header/range validated, but it consumes no decompression/materialization budget.
// With no selection options the old strict behaviour is byte-for-byte equivalent in intent.
replaceOnce(
  '  async function unzipArrayBuffer(arrayBuffer) {\n    const bytes = new Uint8Array(arrayBuffer);\n    const limits = effectiveXlsxArchiveLimits();',
  `  async function unzipArrayBuffer(arrayBuffer, options = {}) {\n    const bytes = new Uint8Array(arrayBuffer);\n    const limits = effectiveXlsxArchiveLimits();\n    const normalizeSelectionKey = value => String(value || '').trim().replace(/\\\\/g, '/').replace(/^\\/+/, '').toLowerCase();\n    const includeEntryNames = new Set((options.includeEntryNames || []).map(normalizeSelectionKey).filter(Boolean));\n    const skipEntryNames = new Set((options.skipEntryNames || []).map(normalizeSelectionKey).filter(Boolean));\n    const hasIncludeFilter = includeEntryNames.size > 0;`,
  'Task13 unzip selection options',
);

replaceOnce(
  `      const centralExtra = bytes.slice(nameStart + nameLength, nameStart + nameLength + extraLength);\n      parseZipExtra(centralExtra, name);\n\n      if (uncompressedSize > limits.MaxEntryUncompressedBytes) {\n        throw xlsxArchiveError(\`распакованный размер файла \${name} превышает безопасный лимит \${archiveLimitLabel(limits.MaxEntryUncompressedBytes)}.\`);\n      }\n      declaredTotal += uncompressedSize;\n      declaredCompressedTotal += compressedSize;\n      if (declaredTotal > limits.MaxTotalUncompressedBytes) {\n        throw xlsxArchiveError(\`суммарный распакованный размер превышает безопасный лимит \${archiveLimitLabel(limits.MaxTotalUncompressedBytes)}.\`);\n      }\n      const declaredRatio = compressedSize > 0 ? uncompressedSize / compressedSize : (uncompressedSize ? Infinity : 1);\n      if (declaredRatio > limits.MaxCompressionRatio) {\n        throw xlsxArchiveError(\`подозрительная степень сжатия файла \${name} превышает \${limits.MaxCompressionRatio}×.\`);\n      }`,
  `      const centralExtra = bytes.slice(nameStart + nameLength, nameStart + nameLength + extraLength);\n      parseZipExtra(centralExtra, name);\n      const materializeEntry = (!hasIncludeFilter || includeEntryNames.has(pathInfo.key)) && !skipEntryNames.has(pathInfo.key);\n\n      if (materializeEntry) {\n        if (uncompressedSize > limits.MaxEntryUncompressedBytes) {\n          throw xlsxArchiveError(\`распакованный размер файла \${name} превышает безопасный лимит \${archiveLimitLabel(limits.MaxEntryUncompressedBytes)}.\`);\n        }\n        declaredTotal += uncompressedSize;\n        declaredCompressedTotal += compressedSize;\n        if (declaredTotal > limits.MaxTotalUncompressedBytes) {\n          throw xlsxArchiveError(\`суммарный распакованный размер превышает безопасный лимит \${archiveLimitLabel(limits.MaxTotalUncompressedBytes)}.\`);\n        }\n        const declaredRatio = compressedSize > 0 ? uncompressedSize / compressedSize : (uncompressedSize ? Infinity : 1);\n        if (declaredRatio > limits.MaxCompressionRatio) {\n          throw xlsxArchiveError(\`подозрительная степень сжатия файла \${name} превышает \${limits.MaxCompressionRatio}×.\`);\n        }\n      }`,
  'Task13 selected-entry resource guards',
);

replaceOnce(
  `      descriptors.push({\n        name,\n        method,\n        compressedSize,\n        uncompressedSize,\n        compressed: bytes.slice(dataStart, dataStart + compressedSize),\n      });\n      offset += recordLength;`,
  `      if (materializeEntry) {\n        descriptors.push({\n          name,\n          method,\n          compressedSize,\n          uncompressedSize,\n          compressed: bytes.slice(dataStart, dataStart + compressedSize),\n        });\n      }\n      offset += recordLength;`,
  'Task13 avoid copying skipped compressed payloads',
);

// Task13-B: resolve display sheet names using only tiny workbook metadata, then do the real
// pass while excluding the physical worksheet part before its size check / decompression.
replaceOnce(
  `  async function readXlsxArrayBuffer(arrayBuffer, fileName = 'matrix.xlsx', options = {}) {\n    const entries = await unzipArrayBuffer(arrayBuffer);\n    const skipSheetNames = new Set((options.skipSheetNames || []).map(name => String(name)));\n    const decoder = new TextDecoder('utf-8');`,
  `  async function readXlsxArrayBuffer(arrayBuffer, fileName = 'matrix.xlsx', options = {}) {\n    const skipSheetNames = new Set((options.skipSheetNames || []).map(name => String(name).trim()).filter(Boolean));\n    const decoder = new TextDecoder('utf-8');\n    let entries;\n    if (options.selectiveInflate === true && skipSheetNames.size) {\n      const metadataEntries = await unzipArrayBuffer(arrayBuffer, {\n        includeEntryNames: ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels'],\n      });\n      const metadataDescriptors = parseWorkbookSheets(metadataEntries, decoder);\n      const skipEntryNames = metadataDescriptors\n        .filter(descriptor => skipSheetNames.has(String(descriptor.name || '').trim()))\n        .map(descriptor => descriptor.path)\n        .filter(Boolean);\n      entries = await unzipArrayBuffer(arrayBuffer, { skipEntryNames });\n    } else {\n      entries = await unzipArrayBuffer(arrayBuffer);\n    }`,
  'Task13 two-pass selective reader',
);

// Canonical user-file reader: the enormous embedded dictionary is disposable because TESSA
// is authoritative. Keep the rest of the workbook archive so refresh can rebuild the sheet.
const selectedReader = `\n  async function readSelectedWorkbookWithLiveCatalog(file, { needBridge = false } = {}) {\n    if (!file) throw new Error('Выберите файл .xlsx.');\n    const workbook = await readXlsxArrayBuffer(await file.arrayBuffer(), file.name, {\n      skipSheetNames: ['Словари'],\n      selectiveInflate: true,\n    });\n    if (!needBridge) return { workbook, bridge: null, structure: null, dictionaryCatalog: null };\n    const bridge = await TessaBridge.create();\n    const templateId = bridge.templateId();\n    if (!templateId) throw new Error('В карточке матрицы не найден TemplateID.');\n    const structure = await bridge.requestStructure(templateId);\n    const dictionaryCatalog = await bridge.loadDictionaryCatalog(structure, { rows: [] }, { forceRefresh: true });\n    workbook.dictionaryCatalog = dictionaryCatalog;\n    return { workbook, bridge, structure, dictionaryCatalog };\n  }\n`;
replaceOnce(
  '\n  async function refreshSelectedWorkbookDictionaries(file) {',
  `${selectedReader}\n  async function refreshSelectedWorkbookDictionaries(file) {`,
  'Task13 canonical live-catalog reader',
);

replaceOnce(
  `  async function refreshSelectedWorkbookDictionaries(file) {\n    if (!file) throw new Error('Сначала выберите изменённый Excel в шаге 2.');\n    setProgress(10, 'Читаю ваш Excel', 'Матрица и ваши правки сохранятся');\n    const workbook = await readXlsxArrayBuffer(await file.arrayBuffer(), file.name);\n    const bridge = await TessaBridge.create(), matrixInfo = bridge.matrixInfo();\n    if (canonicalValue(workbook.roundtrip?.templateId) !== canonicalValue(matrixInfo.TemplateID)) throw new Error('Excel относится к другому шаблону.');\n    const structure = await bridge.requestStructure(bridge.templateId());\n    setProgress(35, 'Обновляю справочники', 'Читаю актуальные значения TESSA');\n    const catalog = await bridge.loadDictionaryCatalog(structure, { rows: [] }, { forceRefresh: true });\n    const bytes = await refreshWorkbookDictionaries(workbook, structure, catalog);`,
  `  async function refreshSelectedWorkbookDictionaries(file) {\n    if (!file) throw new Error('Сначала выберите изменённый Excel в шаге 2.');\n    setProgress(10, 'Читаю ваш Excel', 'Матрица и ваши правки сохранятся');\n    const selected = await readSelectedWorkbookWithLiveCatalog(file, { needBridge: true });\n    const { workbook, bridge, structure, dictionaryCatalog: catalog } = selected;\n    const matrixInfo = bridge.matrixInfo();\n    if (canonicalValue(workbook.roundtrip?.templateId) !== canonicalValue(matrixInfo.TemplateID)) throw new Error('Excel относится к другому шаблону.');\n    setProgress(35, 'Обновляю справочники', 'Использую актуальные значения TESSA');\n    const bytes = await refreshWorkbookDictionaries(workbook, structure, catalog);`,
  'Task13 dictionary refresh uses canonical reader',
);

replaceOnce(
  `  async function refreshSelectedWorkbook(file) {\n    if (!file) throw new Error('Выберите Excel, который нужно обновить.');\n    const workbook = await readXlsxArrayBuffer(await file.arrayBuffer(), file.name);\n    return refreshWorkbookSchema(workbook, file.name);\n  }`,
  `  async function refreshSelectedWorkbook(file) {\n    if (!file) throw new Error('Выберите Excel, который нужно обновить.');\n    const { workbook } = await readSelectedWorkbookWithLiveCatalog(file, { needBridge: true });\n    return refreshWorkbookSchema(workbook, file.name);\n  }`,
  'Task13 schema refresh uses canonical reader',
);

// Preview must use exactly the same safe ingest path. Reuse its bridge + structure instead of
// opening the runtime twice, and attach the live catalog before planning Excel values.
replaceOnce(
  `    const workbook = await performanceStage('preview.xlsx-read', async () => readXlsxArrayBuffer(await file.arrayBuffer(), file.name), { operation: 'preview', fileName: file.name });\n    setProgress(18, '1/6 · Excel прочитан', \`${'${workbook.rows.length}'} строк данных\`);\n    log(\`Excel: \${workbook.headers.filter(Boolean).length} столбцов, \${workbook.rows.length} строк данных.\`);\n    setProgress(22, '2/6 · Подключаюсь к TESSA', 'Проверяю открытую матрицу');\n    const bridge = await TessaBridge.create();\n    const templateId = bridge.templateId();\n    if (!templateId) throw new Error('В карточке матрицы не найден TemplateID.');\n    setProgress(32, '3/6 · Читаю структуру TESSA', 'Критерии и функции');\n    const structure = await performanceStage('preview.structure', () => bridge.requestStructure(templateId), { operation: 'preview' });`,
  `    const selected = await performanceStage('preview.xlsx-read', async () => readSelectedWorkbookWithLiveCatalog(file, { needBridge: true }), { operation: 'preview', fileName: file.name });\n    const { workbook, bridge, structure } = selected;\n    setProgress(18, '1/6 · Excel прочитан', \`\${workbook.rows.length} строк данных\`);\n    log(\`Excel: \${workbook.headers.filter(Boolean).length} столбцов, \${workbook.rows.length} строк данных.\`);\n    setProgress(22, '2/6 · TESSA подключена', 'Открытая матрица определена');\n    const templateId = bridge.templateId();\n    if (!templateId) throw new Error('В карточке матрицы не найден TemplateID.');\n    setProgress(32, '3/6 · Структура TESSA прочитана', 'Критерии, функции и актуальные справочники');`,
  'Task13 preview uses canonical reader',
);

replaceOnce(
  `      APP.dictionaryCatalog.stats.cache = { hit: true, key: dictionaryCacheKey(structure), savedAt: Date.now(), ageMs: 0, source: 'workbook' };`,
  `      APP.dictionaryCatalog.stats.cache = { hit: true, key: dictionaryCacheKey(structure), savedAt: Date.now(), ageMs: 0, source: 'live-tessa' };`,
  'Task13 dictionary cache source',
);

// Task12's internal Full UAT already supplies an authoritative catalog; make its existing
// skipSheetNames option actually selective before inflate as well.
replaceOnce(
  `      skipSheetNames: ['Словари'],\n      dictionaryCatalog: catalog,\n    });`,
  `      skipSheetNames: ['Словари'],\n      dictionaryCatalog: catalog,\n      selectiveInflate: true,\n    });`,
  'Task13 Full UAT base selective inflate',
);
replaceOnce(
  `{ skipSheetNames: ['Словари'], dictionaryCatalog: catalog, retainArchive: false },`,
  `{ skipSheetNames: ['Словари'], dictionaryCatalog: catalog, retainArchive: false, selectiveInflate: true },`,
  'Task13 Full UAT refreshed selective inflate',
);
replaceOnce(
  `{ skipSheetNames: ['Словари'], dictionaryCatalog: catalog, retainArchive: false },`,
  `{ skipSheetNames: ['Словари'], dictionaryCatalog: catalog, retainArchive: false, selectiveInflate: true },`,
  'Task13 Full UAT merged selective inflate',
);

assert.match(source, /async function unzipArrayBuffer\(arrayBuffer, options = \{\}\)/);
assert.match(source, /const materializeEntry = \(!hasIncludeFilter \|\| includeEntryNames\.has\(pathInfo\.key\)\) && !skipEntryNames\.has\(pathInfo\.key\);/);
assert.match(source, /includeEntryNames: \['xl\/workbook\.xml', 'xl\/_rels\/workbook\.xml\.rels'\]/);
assert.match(source, /entries = await unzipArrayBuffer\(arrayBuffer, \{ skipEntryNames \}\);/);
assert.match(source, /async function readSelectedWorkbookWithLiveCatalog\s*\(/);
assert.match(source, /skipSheetNames:\s*\['Словари'\][\s\S]{0,300}selectiveInflate:\s*true/);
assert.match(source, /readSelectedWorkbookWithLiveCatalog\(file, \{ needBridge: true \}\)/);
assert.match(source, /source: 'live-tessa'/);

fs.writeFileSync(sourcePath, source, 'utf8');

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (!pkg.scripts.test.includes('node tests/recovery-task13-selective-xlsx.mjs')) {
  const anchor = 'node tests/full-uat-memory-bounded.mjs';
  assert.ok(pkg.scripts.test.includes(anchor), 'Task13 package test anchor missing');
  pkg.scripts.test = pkg.scripts.test.replace(anchor, `${anchor} && node tests/recovery-task13-selective-xlsx.mjs`);
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

console.log('Task13 patch applied: skipped service worksheets are excluded before XLSX inflate and user-file flows use live TESSA catalogs.');
