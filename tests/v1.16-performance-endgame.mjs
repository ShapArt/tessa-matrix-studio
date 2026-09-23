import fs from 'node:fs';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url).pathname;
const source = fs.readFileSync(sourcePath, 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

for (const marker of [
  'compressedStart: dataStart',
  'bytes.subarray(descriptor.compressedStart',
  'uncompressedSize: data.length',
  'SELECTED_FILE_BUFFER_CACHE',
  'selectedFileArrayBuffer(file)',
  'await yieldToMain();',
  'PERF_DIRECT_DICTIONARY_REFRESH_V3',
  'zipTextParts(',
  'deflateRawTextParts(',
  'await buildDictionaryRefreshArtifacts(grid.dictionaryCatalog)',
  'dictionaryArtifacts.dictionaryZipValue',
  'pickerSearchCache: new Map()',
  'PERF_PICKER_SEARCH_CACHE_V1',
  'PERF_ROUNDTRIP_ROW_STREAM_V1',
  'PERF_BASELINE_SHEET_STREAM_V1',
  'buildBaselineSheetZipValue(baselineSourceRows)',
  'zipTextParts([worksheetPrefix, ...matrixRowChunks, worksheetSuffix])',
  'includeRows: false',
  'pickerMatchingRows(catalog, terms, roleType)',
  'APP.selectedFileRef === file',
  'snapshotAge < 5 * 60 * 1000',
  'rawRows = Array.from(result?.rows || [])',
  'criterionResultsPromise = mapConcurrent([...criterionGroups.entries()], 3',
  'if (sameSelector && samePrevious) return entry',
]) assert(source.includes(marker), 'missing performance marker: ' + marker);

assert(!source.includes('compressed: bytes.slice(dataStart, dataStart + compressedSize)'),
  'ZIP reader still copies every compressed entry');
assert(!source.includes('catalog: clonePlain(catalog)'),
  'dictionary cache still performs an avoidable deep clone before IndexedDB');
assert(!source.includes('normalizeDictionaryCatalog(clonePlain(workbook.dictionaryCatalog))'),
  'Preview still deep-clones the live high-cardinality catalog');
assert(!source.includes('const donorBytes = await createRoundtripXlsxBytes(structure, { rows: [] }, {}, catalog)'),
  'dictionary refresh still builds a donor XLSX');
assert(!source.includes("writeDictionaryCache(dictionaryCacheKey(structure), APP.dictionaryCatalog).catch(() => {})"),
  'Preview still writes the same dictionary cache twice');

const makeZipStart = source.indexOf('async function makeZip(entries)');
const makeZipEnd = source.indexOf('// 4. XLSX', makeZipStart);
const makeZip = source.slice(makeZipStart, makeZipEnd);
assert(makeZip.includes('zipConcurrency = estimatedInputBytes >= 64 * 1024 * 1024'),
  'large workbook adaptive ZIP concurrency missing');
assert(!makeZip.includes('entry.data.length'),
  'ZIP writer still retains uncompressed data objects');

const refreshStart = source.indexOf('async function refreshWorkbookDictionaries');
const refreshEnd = source.indexOf('async function readSelectedWorkbookWithLiveCatalog', refreshStart);
const refresh = source.slice(refreshStart, refreshEnd);
assert(refresh.includes('buildDictionaryRefreshArtifacts'), 'direct dictionary refresh helper missing');
assert(!refresh.includes('createRoundtripXlsxBytes('), 'refresh must not create a second workbook');
assert(source.includes('entries.set(dictionaryPath, artifacts.dictionaryZipValue)'), 'refresh must stream dictionary XML into ZIP');

console.log('v1.16 performance endgame static contract: PASS');

assert(!source.includes('const visualRowCount = Math.max(1, grid.rows.length)'), 'roundtrip export must not materialize a second row grid');

assert(!source.includes("const baselineRows = [['MatrixRowID', 'MatrixVersionID', 'BaseFingerprint']];"), 'baseline ledger must not materialize a giant 2D table');
