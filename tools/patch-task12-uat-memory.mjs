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

// Task12-A: let callers avoid materializing very large service sheets when they already
// own the authoritative live dictionary catalog. The normal user import path remains
// unchanged and still parses every sheet and retains the archive for refresh operations.
if (!source.includes("const skipSheetNames = new Set((options.skipSheetNames || []).map(name => String(name)));")) {
  replaceOnce(
    "  async function readXlsxArrayBuffer(arrayBuffer, fileName = 'matrix.xlsx') {\n    const entries = await unzipArrayBuffer(arrayBuffer);",
    "  async function readXlsxArrayBuffer(arrayBuffer, fileName = 'matrix.xlsx', options = {}) {\n    const entries = await unzipArrayBuffer(arrayBuffer);\n    const skipSheetNames = new Set((options.skipSheetNames || []).map(name => String(name)));",
    'Task12 read options',
  );

  replaceOnce(
    `    const parsedSheets = new Map();\n    for (const descriptor of sheetDescriptors) {\n      const raw = entries.get(descriptor.path);\n      if (!raw) continue;\n      parsedSheets.set(descriptor.name, parseSheetXml(decoder.decode(raw), shared, styles));\n    }`,
    `    const parsedSheets = new Map();\n    for (const descriptor of sheetDescriptors) {\n      if (skipSheetNames.has(descriptor.name)) continue;\n      const raw = entries.get(descriptor.path);\n      if (!raw) continue;\n      parsedSheets.set(descriptor.name, parseSheetXml(decoder.decode(raw), shared, styles));\n    }`,
    'Task12 skip service sheet parsing',
  );

  replaceOnce(
    '      dictionaryCatalog: parseEmbeddedDictionaryCatalog(parsedSheets),',
    '      dictionaryCatalog: options.dictionaryCatalog || parseEmbeddedDictionaryCatalog(parsedSheets),',
    'Task12 dictionary override',
  );

  replaceOnce(
    `    WORKBOOK_ARCHIVES.set(workbook, entries);\n    return workbook;\n  }`,
    `    if (options.retainArchive !== false) WORKBOOK_ARCHIVES.set(workbook, entries);\n    return workbook;\n  }\n\n  function releaseWorkbookArchive(workbook) {\n    return Boolean(workbook && WORKBOOK_ARCHIVES.delete(workbook));\n  }`,
    'Task12 archive retention control',
  );
}

if (!source.includes('readXlsxArrayBuffer, releaseWorkbookArchive, parseSheetXml,')) {
  replaceOnce(
    'readXlsxArrayBuffer, parseSheetXml,',
    'readXlsxArrayBuffer, releaseWorkbookArchive, parseSheetXml,',
    'Task12 archive release export',
  );
}

// Task12-B: Full UAT already has the fresh live catalog in memory. Parsing the generated
// «Словари» worksheet again turns a ~100 MiB XML part into hundreds of thousands of JS
// row/cell objects, and doing that repeatedly caused Chromium renderer OOM on real data.
if (!source.includes("'TESSA_UAT_CURRENT.xlsx', {\n      skipSheetNames: ['Словари'],")) {
  replaceOnce(
    "    const book = await E.readXlsxArrayBuffer(buffer, 'TESSA_UAT_CURRENT.xlsx');",
    `    const book = await E.readXlsxArrayBuffer(buffer, 'TESSA_UAT_CURRENT.xlsx', {\n      skipSheetNames: ['Словари'],\n      dictionaryCatalog: catalog,\n    });`,
    'Task12 Full UAT base workbook',
  );
}

if (!source.includes("'TESSA_UAT_REFRESHED.xlsx', { skipSheetNames: ['Словари'], dictionaryCatalog: catalog, retainArchive: false }")) {
  replaceOnce(
    "        const refreshedBytes = await E.refreshWorkbookDictionaries(base.book, structure, catalog); const refreshed = await E.readXlsxArrayBuffer(refreshedBytes.buffer.slice(refreshedBytes.byteOffset, refreshedBytes.byteOffset + refreshedBytes.byteLength), 'TESSA_UAT_REFRESHED.xlsx');",
    `        const refreshedBytes = await E.refreshWorkbookDictionaries(base.book, structure, catalog);\n        E.releaseWorkbookArchive(base.book);\n        const refreshed = await E.readXlsxArrayBuffer(\n          refreshedBytes.buffer.slice(refreshedBytes.byteOffset, refreshedBytes.byteOffset + refreshedBytes.byteLength),\n          'TESSA_UAT_REFRESHED.xlsx',\n          { skipSheetNames: ['Словари'], dictionaryCatalog: catalog, retainArchive: false },\n        );`,
    'Task12 Full UAT refreshed workbook',
  );
}

if (!source.includes("'TESSA_UAT_MERGED.xlsx', { skipSheetNames: ['Словари'], dictionaryCatalog: catalog, retainArchive: false }")) {
  replaceOnce(
    "        const parsed = await E.readXlsxArrayBuffer(mergedBytes.buffer.slice(mergedBytes.byteOffset, mergedBytes.byteOffset + mergedBytes.byteLength), 'TESSA_UAT_MERGED.xlsx'); const plan = E.buildPlan(parsed, structure, baseline, info);",
    `        const parsed = await E.readXlsxArrayBuffer(\n          mergedBytes.buffer.slice(mergedBytes.byteOffset, mergedBytes.byteOffset + mergedBytes.byteLength),\n          'TESSA_UAT_MERGED.xlsx',\n          { skipSheetNames: ['Словари'], dictionaryCatalog: catalog, retainArchive: false },\n        ); const plan = E.buildPlan(parsed, structure, baseline, info);`,
    'Task12 Full UAT merged workbook',
  );
}

// Static invariants: normal production imports still have the old default semantics;
// only explicit UAT calls opt into lean parsing / non-retention.
assert.match(source, /async function readXlsxArrayBuffer\(arrayBuffer, fileName = 'matrix\.xlsx', options = \{\}\)/);
assert.match(source, /if \(skipSheetNames\.has\(descriptor\.name\)\) continue;/);
assert.match(source, /dictionaryCatalog: options\.dictionaryCatalog \|\| parseEmbeddedDictionaryCatalog\(parsedSheets\)/);
assert.match(source, /if \(options\.retainArchive !== false\) WORKBOOK_ARCHIVES\.set\(workbook, entries\);/);
assert.match(source, /function releaseWorkbookArchive\(workbook\)/);
assert.match(source, /E\.releaseWorkbookArchive\(base\.book\);/);

fs.writeFileSync(sourcePath, source, 'utf8');

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (!pkg.scripts.test.includes('node tests/full-uat-memory-bounded.mjs')) {
  const anchor = 'node tests/full-uat-runner-contract.mjs';
  assert.ok(pkg.scripts.test.includes(anchor), 'Task12 package test anchor missing');
  pkg.scripts.test = pkg.scripts.test.replace(anchor, `${anchor} && node tests/full-uat-memory-bounded.mjs`);
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

console.log('Task12 patch applied: Full UAT uses bounded-memory XLSX parsing and releases retained archives.');
