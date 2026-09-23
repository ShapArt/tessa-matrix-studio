import fs from 'node:fs';

const target = process.argv[2] || 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(target, 'utf8');

function replaceExact(before, after, label, expectedCount = 1) {
  const count = source.split(before).length - 1;
  if (count !== expectedCount) throw new Error(`${label}: expected ${expectedCount} match(es), got ${count}`);
  source = source.split(before).join(after);
}

// Live UAT seed 874674273 had 23 catalogs / 133763 entries but action-value-picker
// reported zero values. pickerColumns accepts a single production-shaped source object;
// the Full UAT was passing structure and catalog as two arguments, silently discarding
// the catalog. Seed 4056656365 then exposed the remaining contract gap: pickerColumns
// also reads source.headers[index] for the visible label. Pass all three workbook inputs
// used by the real picker UI: schemaTokens + headers + dictionaryCatalog.
replaceExact(
  `E.pickerColumns(structure, catalog)`,
  `E.pickerColumns({ schemaTokens: base.book.schemaTokens, headers: base.book.headers, dictionaryCatalog: catalog }) /* FULL_UAT_PICKER_SOURCE_V2 */`,
  'Full UAT production-shaped picker source',
  2,
);

// refreshWorkbookDictionaries used to create a trusted donor XLSX and immediately feed
// that donor back through the untrusted ZIP reader. A legitimate live dictionary sheet
// can exceed the 128 MiB per-entry guard, so the generated donor tripped a security limit
// that is intentionally correct for user-supplied archives. Build the replacement service
// XML and its named ranges directly from the already-normalized live catalog instead.
// The external 128 MiB/512 MiB archive guards remain unchanged.
if (/PERF_DIRECT_DICTIONARY_REFRESH_V[23]/.test(source)) {
  // Newer source already implements the same fix in a more memory-efficient form:
  // direct dictionary XML, cooperative yields and no donor workbook roundtrip.
  if (!source.includes('REFRESH_DICTIONARY_DIRECT_XML_V2')) {
    source = source.replace(
      '// PERF_DIRECT_DICTIONARY_REFRESH_V2',
      '// PERF_DIRECT_DICTIONARY_REFRESH_V2\n  // REFRESH_DICTIONARY_DIRECT_XML_V2',
    );
  }
} else {
  const donorStart = `    const donorBytes = await createRoundtripXlsxBytes(structure, { rows: [] }, {}, catalog);`;
  const namespaceLine = `    const namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';`;
  const donorStartIndex = source.indexOf(donorStart);
  const namespaceIndex = source.indexOf(namespaceLine, donorStartIndex);
  if (donorStartIndex < 0 || namespaceIndex < 0 || namespaceIndex <= donorStartIndex) {
    throw new Error('direct dictionary refresh: donor block boundaries not found');
  }
  const donorBlock = source.slice(donorStartIndex, namespaceIndex);
  if (!donorBlock.includes(`const donor = await unzipArrayBuffer(`)
    || !donorBlock.includes(`const dictionaryXml = decoder.decode(donor.get(donorPath(ROUNDTRIP.DictionarySheet)))`)
    || !donorBlock.includes(`entries.set(structurePath`)) {
    throw new Error('direct dictionary refresh: unexpected donor block shape');
  }
  const directDictionaryBlock = `    // REFRESH_DICTIONARY_DIRECT_XML_V2
    const refreshCatalog = normalizeDictionaryCatalog(catalog);
    const dictionaryRows = [['CatalogID', 'Словарь', 'Выбор в Excel', 'Отображение', 'ID', 'RoleTypeID', 'Источник', 'Доп. данные', 'Прежние названия']];
    const ranges = [];
    const rangeByCatalog = new Map();
    let dictionaryRow = 2;
    let rangeIndex = 1;
    for (const dictionary of Object.values(refreshCatalog.catalogs || {})) {
      const startRow = dictionaryRow;
      let firstCatalogRow = true;
      for (const item of dictionary.entries || []) {
        dictionaryRows.push([
          dictionary.id,
          firstCatalogRow ? (dictionary.label || dictionary.id) : '',
          item.selector,
          item.display,
          item.id,
          item.roleTypeId,
          firstCatalogRow ? (dictionary.sourceView || item.source || '') : '',
          item.details || '',
          item.previousSelectors?.length ? JSON.stringify(item.previousSelectors) : '',
        ]);
        firstCatalogRow = false;
        dictionaryRow += 1;
      }
      if (dictionaryRow > startRow) {
        const name = \`_TMS_DV_\${String(rangeIndex++).padStart(3, '0')}\`;
        const formula = \`'\${ROUNDTRIP.DictionarySheet}'!$C$\${startRow}:$C$\${dictionaryRow - 1}\`;
        ranges.push({ name, formula });
        rangeByCatalog.set(dictionary.id, name);
      }
    }
    const dictionaryXml = genericSheetXml(dictionaryRows, [28, 42, 56, 48, 40, 14, 28, 72]).replace(/\\s+s="\\d+"/g, '');
    entries.set(dictionaryPath, dictionaryXml);
    const structureRows = workbook.parsedSheets.get(ROUNDTRIP.StructureSheet).rows.map(row => [...row]);
    for (const row of structureRows.slice(1)) row[6] = catalog.columnCatalogIds?.[row[0]] || '';
    entries.set(structurePath, genericSheetXml(structureRows, [], { autoFilter: false }).replace(/\\s+s="\\d+"/g, ''));
`;
  source = source.slice(0, donorStartIndex) + directDictionaryBlock + source.slice(namespaceIndex);

  replaceExact(
`    const donorWorkbook = decoder.decode(donor.get('xl/workbook.xml'));
    const ranges = [...donorWorkbook.matchAll(/<definedName\\b([^>]*)>([\\s\\S]*?)<\\/definedName>/g)].map(m => ({ name: attr(m[1], 'name'), formula: m[2] }));
    const ids = Object.values(normalizeDictionaryCatalog(catalog).catalogs).filter(item => item.entries.length).map(item => item.id);
    const rangeByCatalog = new Map(ids.map((id, i) => [id, ranges[i]?.name]));
`,
``,
    'remove donor-derived named ranges',
  );
}

// The workbook-facing Boolean vocabulary is Да/Нет, while the native TESSA read-back is
// true/false. The field UAT compared display text to server semantics and produced two
// false FAILs even though both writes and restores were verified. Normalize only the UAT
// expectation; production storage, parsing and user-visible values stay untouched.
if (!source.includes('FULL_UAT_BOOLEAN_SEMANTIC_V2')) {
  replaceExact(
`                  selected = { candidate, plan, expectedAfter: canonicalFieldValues(change.after || []) };`,
`                  const rawExpectedAfter = canonicalFieldValues(change.after || []);
                  // FULL_UAT_BOOLEAN_SEMANTIC_V2
                  const expectedAfter = liveItem.strategy === 'boolean'
                    ? rawExpectedAfter.map(value => ['да', 'true', '1'].includes(value) ? 'true' : ['нет', 'false', '0'].includes(value) ? 'false' : value)
                    : rawExpectedAfter;
                  selected = { candidate, plan, expectedAfter };`,
    'Full UAT Boolean semantic read-back expectation',
  );
}

for (const marker of [
  'FULL_UAT_PICKER_SOURCE_V2',
  'REFRESH_DICTIONARY_DIRECT_XML_V2',
  'FULL_UAT_BOOLEAN_SEMANTIC_V2',
]) {
  if (!source.includes(marker)) throw new Error(`missing final-four marker: ${marker}`);
}
if (source.includes('E.pickerColumns(structure, catalog)')) throw new Error('obsolete Full UAT picker call remains');
if (/const donorBytes = await createRoundtripXlsxBytes\(structure, \{ rows: \[\] \}, \{\}, catalog\);[\s\S]{0,500}await unzipArrayBuffer\(donorBytes/.test(source)) {
  throw new Error('trusted dictionary refresh still inflates its own donor workbook');
}

fs.writeFileSync(target, source, 'utf8');
console.log('TESSA Matrix Studio v1.14 final-four live UAT fixes: complete picker source + direct dictionary XML + Boolean semantics OK');
